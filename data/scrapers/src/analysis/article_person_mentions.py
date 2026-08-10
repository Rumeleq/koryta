"""Find mentions of known people in parsed articles.

Cross-references the merged people dataset (``people_merged``) with the parsed
article corpus (``article_parsed``). Each article's text is scanned for
capitalized name sequences that match a known person and one record is emitted
per article, carrying the URL, the title, date and tags recovered from the
article's ld+json metadata, and the list of people matched in its text.

Matching is nominative-only and diacritics-insensitive (e.g. "Jana
Kowalskiego" is not caught), so the output is a lower bound on true mentions.

A name match alone is not enough: a common name can be a coincidence, so every
matched person must also be confirmed by independent evidence (``proof``). The
article's region (from its domain, via the domain->region map) is compared to
the person's teryt codes; the person's parties and organizations (KRS) are
looked up in the article text. A person is kept only when at least one signal
matches, and the ``proof`` dict records which ones did.
"""

import asyncio
import json
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import pandas as pd
from tqdm import tqdm

from analysis.people import PeopleMerged
from entities.article import ArticlePersonMentioned
from scrapers.article.parse import date_iso_from_ld_json, title_from_ld_json
from scrapers.article.pipelines.common import ascii_lower, normalize_text, strip_think_blocks
from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.article.pipelines.parsed_pipeline import ArticleParsed
from scrapers.article.pipelines.pipeline_utils import llm_model
from scrapers.stores import (
    LLM,
    LLMResponsePool,
    VERSIONED_DIR,
    Context,
    LLMRequest,
    iterate_pipeline_dict,
)

JUDGE_VERSION = 1
MAX_TOKENS = 2000
TEMPERATURE = 0.0
TEXT_LIMIT = 30000

# A word is capitalized when it starts with an uppercase Polish letter.
_CAP = "A-ZĄĆĘŁŃÓŚŹŻ"
_LOW = "a-ząćęłńóśźż"
_WORD = rf"[{_CAP}][{_LOW}]+(?:['-][{_CAP}{_LOW}]+)*"
# Consecutive capitalized words (2..6) -> a candidate person-name run.
_MAX_RUN_WORDS = 6
_RUN_RE = re.compile(rf"(?:{_WORD}\s+){{1,{_MAX_RUN_WORDS - 1}}}{_WORD}")

# Domain -> region mapping, generated from files/seed.csv + TERYT codes. Each
# entry lists the regions (woj/woj_code/powiat/powiat_code/miasto) the outlet
# covers. Kept next to the verified domain->selector map.
_DOMAIN_REGION_FILE = (
    Path(__file__).resolve().parents[2]
    / "scrapers"
    / "article"
    / "pipelines"
    / "domain_to_region.json"
)


def _name_tuple(name: str) -> tuple[str, ...]:
    return tuple(normalize_text(t) for t in str(name).split())


def _tags_from_ld_json(ld_json: Any) -> list[str]:
    """Keywords and article sections from a stored ld+json blob (incl. @graph)."""
    tags: list[str] = []

    def collect(item: Any) -> None:
        if isinstance(item, dict):
            for key in ("keywords", "articleSection"):
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    tags.append(value.strip())
                elif isinstance(value, list):
                    for v in value:
                        if isinstance(v, str) and v.strip():
                            tags.append(v.strip())
            graph = item.get("@graph")
            if isinstance(graph, list):
                for node in graph:
                    collect(node)
        elif isinstance(item, list):
            for sub in item:
                collect(sub)

    collect(ld_json)
    # Case-insensitive dedupe (e.g. "polityka" vs "Polityka"), keep first casing.
    seen: set[str] = set()
    deduped: list[str] = []
    for tag in tags:
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(tag)
    return deduped


class PersonNameIndex:
    """Lookup from normalized name tuples to the people they refer to."""

    def __init__(self) -> None:
        self._by_tuple: dict[tuple[str, ...], dict[str, str]] = {}
        self.max_len = 0
        self.people = 0
        self.forms = 0
        self._seen_people: set[str] = set()

    def add(self, display: str, name_forms: list[tuple[str, ...]]) -> None:
        """Register every spelling variant of one person's name.

        Display names that normalize to the same string (e.g. "Zieliński" and
        "Zielinski") are treated as one person; people_merged is ordered by
        confidence, so the first spelling seen wins.
        """
        norm_display = normalize_text(display)
        if norm_display not in self._seen_people:
            self._seen_people.add(norm_display)
            self.people += 1
        for form in name_forms:
            if len(form) < 2:
                continue
            self._by_tuple.setdefault(form, {}).setdefault(norm_display, display)
            self.max_len = max(self.max_len, len(form))
            self.forms += 1

    def find_in_text(self, text: str) -> set[str]:
        """Return the display names of people mentioned in ``text``."""
        found: set[str] = set()
        for run in _RUN_RE.findall(text):
            words = run.split()
            n_words = len(words)
            max_n = min(n_words, self.max_len)
            for n in range(2, max_n + 1):
                for i in range(n_words - n + 1):
                    key = tuple(normalize_text(w) for w in words[i : i + n])
                    names = self._by_tuple.get(key)
                    if names:
                        found.update(names.values())
        return found


# National party abbreviations / names an article is likely to use, mapped
# from the long committee names stored in people_merged. The article text is
# searched for these short forms instead of the full committee name. Keys that
# are also ordinary Polish words (po, lewica, wiosna, razem, ko) are left out:
# they would match far too often to count as proof.
_PARTY_KEYS = (
    ("pis", "prawo i sprawiedliwosc"),
    ("psl", "polskie stronnictwo ludowe"),
    ("sld", "sojusz lewicy demokratycznej"),
    ("koalicja obywatelska", "koalicja obywatelska"),
    ("konfederacja", "konfederacja"),
    ("nowoczesna", "nowoczesna"),
    ("trzecia droga", "trzecia droga"),
    ("polska 2050", "polska 2050"),
    ("pl2050", "pl2050"),
    ("samoobrona", "samoobrona"),
    ("liga polskich rodzin", "ligi polskich rodzin"),
    ("zjednoczona prawica", "zjednoczona prawica"),
    ("akcja wyborcza solidarnosc", "akcja wyborcza solidarnosc"),
    ("unia wolnosci", "unia wolnosci"),
)


def _party_match_terms(party_norm: str) -> set[str]:
    """Terms to look for in article text for a stored committee name.

    Returns the short key and the bare party name (e.g. ``pis`` and
    ``prawo i sprawiedliwosc``) so an article saying either ``PiS`` or
    ``Prawo i Sprawiedliwość`` counts as a match.
    """
    terms: set[str] = set()
    for key, needle in _PARTY_KEYS:
        if needle in party_norm:
            terms.add(key)
            terms.add(needle)
    return terms


# Common Polish nominal endings, stripped from the *end* so a company name and
# its declined form ("Przedsiębiorstwo" vs "Przedsiębiorstwa") share a stem.
_NOMINAL_SUFFIXES = (
    "owymi",
    "owego",
    "owej",
    "owym",
    "owych",
    "owie",
    "owego",
    "owemu",
    "ami",
    "ach",
    "om",
    "iem",
    "em",
    "u",
    "ie",
    "ej",
    "ego",
    "e",
    "i",
    "y",
    "a",
)
_STOP_ORG_WORDS = {
    "spolka",
    "spolki",
    "spolce",
    "spolke",
    "spolk",
    "spółka",
    "spółki",
    "spółk",
    "z",
    "ograniczona",
    "odpowiedzialnoscia",
    "odpowiedzialnosci",
    "odpowiedzialnosc",
    "spzoo",
    "sa",
    "s",
    "zaklad",
    "zaklady",
    "fundacja",
    "fundacji",
    "centrum",
    "sp",
    "akcyjna",
    "polska",
    "polskie",
    "polski",
    "polskiej",
    "krajowa",
    "krajowy",
    "powiatowa",
    "powiatowy",
    "miejskie",
    "miejskiego",
    "miejski",
    "miejskiej",
    "miejsca",
}


def _stem(word: str) -> str:
    """Light Polish stem: strip a common nominal ending off ``word``."""
    for suffix in _NOMINAL_SUFFIXES:
        if len(word) - len(suffix) >= 4 and word.endswith(suffix):
            return word[: len(word) - len(suffix)]
    return word


def _org_match_terms(org_norm: str) -> set[str]:
    """Significant word stems of an organization name to search the article for.

    Drops company-form words (``spółka``, ``z o.o.``) and keeps the
    distinguishing stems, so ``Przedsiębiorstwo Gospodarki Komunalnej i
    Mieszkaniowej Sp. z o.o.`` matches an article that declines any of them.
    """
    stems: set[str] = set()
    for word in org_norm.split():
        stripped = normalize_text(word)
        stemmed = _stem(stripped)
        if stripped in _STOP_ORG_WORDS or stemmed in _STOP_ORG_WORDS:
            continue
        if len(stemmed) >= 5:
            stems.add(stemmed)
    return stems


class PersonProfile:
    """Disambiguation evidence for one person: regions, parties, organizations."""

    __slots__ = ("woj", "powiat", "parties", "orgs")

    def __init__(self) -> None:
        self.woj: set[str] = set()
        self.powiat: set[str] = set()
        self.parties: set[str] = set()
        self.orgs: set[str] = set()

    def merge(self, other: "PersonProfile") -> None:
        self.woj.update(other.woj)
        self.powiat.update(other.powiat)
        self.parties.update(other.parties)
        self.orgs.update(other.orgs)

    def has_any(self) -> bool:
        return bool(self.woj or self.powiat or self.parties or self.orgs)


class PersonProfileIndex:
    """Per-display-name disambiguation evidence, merged across name collisions.

    A display name may map to several people (same first+last name). Signals
    from all of them are merged under the display name, so a mention is kept
    when the article agrees with *any* of the candidates. The ambiguity is
    visible in ``proof``: a ``region`` match names the specific region hit, a
    ``party`` or ``organization`` match names what was found.
    """

    def __init__(self) -> None:
        self._by_display: dict[str, PersonProfile] = {}

    def add(self, display: str, profile: PersonProfile) -> None:
        key = normalize_text(display)
        existing = self._by_display.get(key)
        if existing is None:
            self._by_display[key] = profile
        else:
            existing.merge(profile)

    def profile(self, display: str) -> PersonProfile | None:
        return self._by_display.get(normalize_text(display))

    def __len__(self) -> int:
        return len(self._by_display)


class DomainRegionMap:
    """domain -> list of {woj, woj_code, powiat, powiat_code, miasto} regions."""

    def __init__(self, path: str) -> None:
        try:
            with open(path, encoding="utf-8") as handle:
                self._data = json.load(handle)
        except FileNotFoundError:
            self._data = {}

    def powiat_codes(self, domain: str) -> set[str]:
        regions = self._data.get(domain, [])
        return {r["powiat_code"] for r in regions if r.get("powiat_code")}

    def woj_codes(self, domain: str) -> set[str]:
        regions = self._data.get(domain, [])
        return {r["woj_code"] for r in regions if r.get("woj_code")}


def _load_index_and_profiles(
    rows: Iterable[dict[str, Any]], krs_names: dict[str, str]
) -> tuple[PersonNameIndex, PersonProfileIndex]:
    """Build the name index and disambiguation profiles in one pass."""
    index = PersonNameIndex()
    profiles = PersonProfileIndex()
    for row in rows:
        first = _name_tuple(str(row.get("base_first_name") or ""))
        last = _name_tuple(str(row.get("base_last_name") or ""))
        display = _display_name(row)
        if not first or not last or not display:
            continue
        forms: list[tuple[str, ...]] = [(first[0], last[-1])]
        for full in row.get("base_full_name") or []:
            if isinstance(full, str) and full.strip():
                forms.append(_name_tuple(full))
        index.add(display, forms)

        profile = PersonProfile()
        profile.woj = {
            str(t) for t in (row.get("teryt_wojewodztwo") or []) if t not in (None, "")
        }
        profile.powiat = {
            str(t) for t in (row.get("teryt_powiat") or []) if t not in (None, "")
        }
        for election in row.get("elections") or []:
            party = (election or {}).get("party")
            if party:
                profile.parties.update(_party_match_terms(normalize_text(str(party))))
            for t in (election or {}).get("teryt_wojewodztwo") or []:
                if t not in (None, ""):
                    profile.woj.add(str(t))
            for t in (election or {}).get("teryt_powiat") or []:
                if t not in (None, ""):
                    profile.powiat.add(str(t))
        for employment in row.get("employment") or []:
            krs = (employment or {}).get("employed_krs")
            name = krs_names.get(str(krs)) if krs else None
            if name:
                profile.orgs.update(_org_match_terms(ascii_lower(name)))
        profiles.add(display, profile)
    return index, profiles


def _display_name(row: dict[str, Any]) -> str:
    full = row.get("base_full_name")
    if isinstance(full, list) and full and isinstance(full[0], str) and full[0].strip():
        return full[0].strip()
    first = str(row.get("base_first_name") or "").strip()
    last = str(row.get("base_last_name") or "").strip()
    if first and last:
        return f"{first.title()} {last.title()}"
    return str(row.get("krs_name") or "").strip()


def _krs_name_map() -> dict[str, str]:
    """krs -> company name, from the company pipelines' outputs."""
    names: dict[str, str] = {}
    for rel in ("company_krs/company_krs.jsonl", "company_kmgp/company_kmgp.jsonl"):
        path = Path(VERSIONED_DIR) / rel
        try:
            with open(path, encoding="utf-8") as handle:
                for line in handle:
                    raw = line.strip()
                    if not raw:
                        continue
                    try:
                        row = json.loads(raw)
                    except Exception:
                        continue
                    krs = row.get("krs")
                    name = row.get("name")
                    if krs and name and krs not in names:
                        names[str(krs)] = str(name)
        except FileNotFoundError:
            continue
    return names


def _proof_for(
    profile: PersonProfile,
    domain: str,
    norm_content: str,
    domain_map: DomainRegionMap,
) -> list[str]:
    """Signals confirming the person against the article; empty means drop."""
    proof: list[str] = []

    powiat_codes = domain_map.powiat_codes(domain)
    if powiat_codes & profile.powiat:
        proof.append("region:powiat")
    elif not profile.powiat and domain_map.woj_codes(domain) & profile.woj:
        # Woj-level only confirms when the person has no powiat to pin them to;
        # with powiat data, a same-woj but different-powiat match is NOT proof
        # (it is exactly the same-name, same-region coincidence case).
        proof.append("region:wojewodztwo")

    if profile.parties:
        for term in sorted(profile.parties):
            if term and re.search(rf"\b{re.escape(term)}\b", norm_content):
                proof.append(f"party:{term}")
                break

    if profile.orgs:
        ascii_content = ascii_lower(norm_content)
        text_words = {_stem(w) for w in re.findall(r"\w+", ascii_content)}
        matched = [o for o in profile.orgs if o in text_words]
        if len(matched) >= 2:
            proof.append("organization:" + ",".join(sorted(matched)[:3]))

    return proof


def _mention_meta(row: dict[str, Any]) -> dict[str, Any]:
    """Article metadata to keep next to the URL in the output."""
    ld_json = row.get("ld_json")
    return {
        "url": str(row.get("url") or ""),
        "domain": str(row.get("domain") or ""),
        "title": row.get("title") or title_from_ld_json(ld_json),
        "date": row.get("publication_date") or date_iso_from_ld_json(ld_json),
        "tags": _tags_from_ld_json(ld_json),
    }


def _confirm_mentions(
    names: set[str],
    content: str,
    domain: str,
    profiles: PersonProfileIndex,
    domain_map: DomainRegionMap,
) -> dict[str, list[str]]:
    """Keep names with at least one proof signal; map name -> proof list."""
    norm_content = normalize_text(content)
    confirmed: dict[str, list[str]] = {}
    for name in names:
        profile = profiles.profile(name)
        if profile is None or not profile.has_any():
            continue
        proof = _proof_for(profile, domain, norm_content, domain_map)
        if proof:
            confirmed[name] = proof
    return confirmed


_JUDGE_PROMPT = (
    "Jesteś dokładnym weryfikatorem danych. Twoim zadaniem jest ocenić, czy "
    "znana osoba NAPRAWDĘ występuje w danym artykule, czy mamy do czynienia z "
    "przypadkiem, gdy w artykule występuje inna osoba o tym samym lub podobnym "
    "imieniu i nazwisku (tzw. zbieżność nazwisk).\n\n"
    "Poniżej podajemy: fragment artykułu, dane znanej osoby (partie, regiony, "
    "organizacje, w których jest zarejestrowana) oraz sygnały dopasowania, "
    "które zostały wykryte automatycznie.\n\n"
    "Oceń, czy osoba opisana w artykule to ta sama znana osoba. Zwróć uwagę na:\n"
    "- Czy artykuł podaje pełne imię i nazwisko lub jednoznacznie ją identyfikuje.\n"
    "- Czy kontekst (partia, region, organizacja, stanowisko) zgadza się z danymi "
    "znanej osoby. ROZBIEŻNOŚĆ w partii, regionie lub organizacji to mocny sygnał, "
    "że to inna osoba o tym samym nazwisku.\n"
    "- Czy osoba może mieć wiele partii w przeszłości - ale jeśli artykuł opisuje "
    "ją jako działającą w innej partii lub przeciw innej partii, to prawdopodobnie "
    "to NIE jest ta znana osoba.\n"
    "- Czy nazwisko jest popularne (Nowak, Kowalski, Kamiński) - wtedy same "
    "wystąpienia nazwiska NIE wystarczają, potrzebny jest zgodny kontekst.\n\n"
    "Artykuł:\n{article}\n\n"
    "Znana osoba: {name}\n"
    "Partie w danych: {parties}\n"
    "Regiony (kody TERYT) w danych: {regions}\n"
    "Organizacje w danych: {orgs}\n"
    "Wykryte sygnały dopasowania: {proof}\n\n"
    "Odpowiedz zwięźle, w dwóch częściach:\n"
    "1. Uzasadnienie (1-2 zdania): co w artykule potwierdza lub zaprzecza, że to "
    "ta sama osoba.\n"
    "2. Werdykt: TAK lub NIE (wyłącznie jedno słowo).\n\n"
    "Format odpowiedzi:\n"
    "Uzasadnienie: <twoje uzasadnienie>\n"
    "Werdykt: TAK\n"
)


def _judge_request(
    person: str,
    profile: PersonProfile | None,
    proof: list[str],
    content: str,
    model: str,
) -> LLMRequest:
    parties = sorted(profile.parties) if profile else []
    regions = sorted(profile.woj | profile.powiat) if profile else []
    orgs = sorted(profile.orgs) if profile else []
    return LLMRequest(
        prompt=_JUDGE_PROMPT.format(
            article=content[:TEXT_LIMIT],
            name=person,
            parties=", ".join(parties) or "brak",
            regions=", ".join(regions) or "brak",
            orgs=", ".join(orgs) or "brak",
            proof=", ".join(proof) or "brak",
        ),
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        model=model,
        enable_thinking=True,
    )


def _parse_verdict(text: str) -> tuple[str, str]:
    text = strip_think_blocks(text)
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    justification = ""
    verdict = "unknown"
    for line in lines:
        low = line.lower()
        if low.startswith("uzasadnienie") or low.startswith("justification"):
            justification = line.split(":", 1)[1].strip() if ":" in line else line
        elif "werdykt" in low or "verdict" in low:
            val = line.split(":", 1)[1].strip().upper() if ":" in line else ""
            if val in {"TAK", "NIE", "YES", "NO"}:
                verdict = "yes" if val in {"TAK", "YES"} else "no"
    if verdict == "unknown":
        last = lines[-1].strip().upper() if lines else ""
        if last in {"TAK", "NIE", "YES", "NO"}:
            verdict = "yes" if last in {"TAK", "YES"} else "no"
        else:
            m = re.search(r"\b(TAK|NIE|YES|NO)\b\s*$", text.upper())
            if m:
                verdict = "yes" if m.group(1) in {"TAK", "YES"} else "no"
    if not justification and lines:
        justification = lines[0][:300]
    return verdict, justification[:500]


def _emit_person(
    ctx: Context,
    row: dict[str, Any],
    person: str,
    proof: list[str],
    verdict: str,
    justification: str,
) -> None:
    """Emit one ``ArticlePersonMentioned`` row for a judged (article, person) pair."""
    proof_set = set(proof)
    ctx.io.dumper.insert_into(  # type: ignore[attr-defined]
        ArticlePersonMentioned(
            url=row["url"],
            person=person,
            domain=row["domain"],
            title=row["title"],
            date=row["date"],
            tags=row["tags"],
            proof_region=any(s.startswith("region:") for s in proof_set),
            proof_party=any(s.startswith("party:") for s in proof_set),
            proof_organization=any(s.startswith("organization:") for s in proof_set),
            verdict=verdict,
            justification=justification,
        ),
        [],
    )


async def _scan_and_judge(
    ctx: Context,
    parsed_path: Path,
    index: PersonNameIndex,
    profiles: PersonProfileIndex,
    domain_map: DomainRegionMap,
    *,
    model: str,
) -> None:
    """Scan parsed articles and LLM-judge confirmed matches on the fly.

    Reads the corpus line by line; every article whose names pass the proof
    filter has its (article, person) pairs submitted to the LLM response pool
    immediately, so judging overlaps the scan and article text is never kept in
    memory. Each row is emitted as soon as its last request lands.
    """
    await LLM.from_context(ctx).check_health()

    inflight: dict[int, tuple[dict[str, Any], str, list[str]]] = {}
    candidates = 0
    dropped = 0
    rows = 0

    async def drain(pool: LLMResponsePool) -> None:
        request_id, response = await pool.get_response()
        row, person, proof = inflight.pop(request_id)
        if isinstance(response, Exception):
            verdict, justification = "unknown", str(response)[:200]
        else:
            verdict, justification = _parse_verdict(response.content)
        _emit_person(ctx, row, person, proof, verdict, justification)
        bar.update(1)

    with tqdm(total=0, desc="Judging mentions", unit="pair") as bar:
        async with LLM.from_context(ctx).response_pool() as pool:
            with parsed_path.open(encoding="utf-8") as f:
                for line in tqdm(f, desc="Scanning parsed articles", unit="article"):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        raw = json.loads(line)
                    except Exception:
                        continue
                    if raw.get("parse_status") != "ok":
                        continue
                    content = (
                        str(raw.get("title") or "")
                        + " "
                        + str(raw.get("article_content") or "")
                    )
                    if not content.strip():
                        continue
                    names = index.find_in_text(content)
                    if not names:
                        continue
                    confirmed = _confirm_mentions(
                        names, content, raw.get("domain"), profiles, domain_map
                    )
                    dropped += len(names) - len(confirmed)
                    if not confirmed:
                        continue
                    row = _mention_meta(raw)
                    candidates += len(confirmed)
                    rows += 1
                    bar.total += len(confirmed)
                    for person, proof in confirmed.items():
                        profile = profiles.profile(person)
                        while pool.is_full():
                            await drain(pool)
                        request_id = await pool.put_request(
                            _judge_request(person, profile, proof, content, model)
                        )
                        inflight[request_id] = (row, person, proof)
            while inflight:
                await drain(pool)

    print(
        f"Confirmed {candidates:,} candidate people across {rows:,} articles "
        f"({dropped:,} dropped for lack of proof)"
    )


def _print_llm_usage(ctx: Context) -> None:
    llm = LLM.from_context(ctx)
    print(
        "Mention judge LLM usage: "
        f"{int(getattr(llm, 'request_count', 0) or 0)} requests, "
        f"{int(getattr(llm, 'total_tokens', 0) or 0)} total tokens"
    )


class ArticlePersonMentions(IncrementalJsonlPipeline[ArticlePersonMentioned]):
    """Cross-reference people_merged with article_parsed to find mentions."""

    filename = "article_person_mentions"
    backup_to_shared_cache = False  # derived from the ~21GB parse corpus, local-only

    people_merged: PeopleMerged
    parsed: ArticleParsed
    llm: LLM

    @property
    def output_class(self):
        return ArticlePersonMentioned

    def process(self, ctx: Context) -> pd.DataFrame:
        self.prepare_temp_output()

        people_df = self.people_merged.read_or_process(ctx)
        krs_names = _krs_name_map()
        index, profiles = _load_index_and_profiles(
            iterate_pipeline_dict(people_df), krs_names
        )
        self.people_merged._cached_result = None
        if not index.people:
            print("No people found in people_merged, nothing to emit")
            return pd.DataFrame()
        print(
            f"Indexed {index.people:,} people ({index.forms:,} name forms, "
            f"{len(profiles):,} with disambiguation profiles)"
        )

        domain_map = DomainRegionMap(_DOMAIN_REGION_FILE)
        print(f"Loaded region map for {len(domain_map._data):,} domains")

        parsed_path = self.parsed.final_output_path
        if not parsed_path.exists():
            print("No parsed articles found, nothing to emit")
            return pd.DataFrame()

        model = llm_model()
        asyncio.run(
            _scan_and_judge(
                ctx, parsed_path, index, profiles, domain_map, model=model
            )
        )
        _print_llm_usage(ctx)
        return pd.DataFrame()
