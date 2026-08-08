"""LLM-judge whether a proof-suggested person really appears in an article.

The rule-based mention pipeline (ArticlePersonMentions) confirms a name match
with region/party/org signals, but those heuristics can still let a same-name
coincidence through (e.g. an opposition politician whose profile carries an old
PiS candidacy). This pipeline sends each confirmed (article, person) pair to an
LLM judge: the article text plus the person's profile and the matching signals,
and asks for a free-text justification followed by a binary verdict (yes/no).
The judge output is written one record per (article, person) pair.
"""

import asyncio
import json
import re
from pathlib import Path
from typing import Any

import pandas as pd
from tqdm import tqdm

from analysis.article_person_mentions import (
    _DOMAIN_REGION_FILE,
    DomainRegionMap,
    PersonProfileIndex,
    _krs_name_map,
    _load_index_and_profiles,
)
from analysis.people import PeopleMerged
from entities.article import ArticleMentionJudge
from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.article.pipelines.parsed_pipeline import ArticleParsed
from scrapers.article.pipelines.pipeline_utils import llm_model
from scrapers.stores import (
    LLM,
    VERSIONED_DIR,
    Context,
    LLMRequest,
    iterate_pipeline_dict,
)

JUDGE_VERSION = 1
MAX_TOKENS = 1500
TEMPERATURE = 0.0
TEXT_LIMIT = 30000

_PARSED_FILE = Path(VERSIONED_DIR) / "article_parsed" / "article_parsed.jsonl"
_MENTIONS_FILE = (
    Path(VERSIONED_DIR) / "article_person_mentions" / "article_person_mentions.jsonl"
)

_THINK_RE = re.compile(r"<think>.*?</think>", flags=re.DOTALL)

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


class ArticleMentionJudgePipeline(IncrementalJsonlPipeline[ArticleMentionJudge]):
    """Send proof-confirmed (article, person) pairs to an LLM judge."""

    filename = "article_mention_judge"
    backup_to_shared_cache = False  # large incremental LLM output, local-only

    people_merged: PeopleMerged
    parsed: ArticleParsed
    llm: LLM

    @property
    def output_class(self):
        return ArticleMentionJudge

    def process(self, ctx: Context) -> pd.DataFrame:
        self.prepare_temp_output()

        people_df = self.people_merged.read_or_process(ctx)
        _, profiles = _load_index_and_profiles(
            iterate_pipeline_dict(people_df), _krs_name_map()
        )
        self.people_merged._cached_result = None
        print(f"Loaded {len(profiles):,} person profiles")

        domain_map = DomainRegionMap(_DOMAIN_REGION_FILE)

        mentions_path = _MENTIONS_FILE
        if not mentions_path.exists():
            raise FileNotFoundError(mentions_path)

        # Collect the (url, person, proof, domain) pairs to judge.
        pairs = _load_pairs(mentions_path, profiles, domain_map)
        if not pairs:
            print("No confirmed mentions to judge")
            return pd.DataFrame()

        # Stream parsed articles, keep only the content we need.
        contents = _load_article_contents(_PARSED_FILE, {p["url"] for p in pairs})
        print(f"Loaded content for {len(contents):,} articles")

        model = llm_model()
        asyncio.run(_judge_pairs(ctx, pairs, contents, model=model, profiles=profiles))
        _print_llm_usage(ctx)
        return pd.DataFrame()


def _load_pairs(
    mentions_path: Path,
    profiles: PersonProfileIndex,
    domain_map: DomainRegionMap,
) -> list[dict[str, Any]]:
    """Collect (url, person, proof, domain) pairs from the mentions output."""
    pairs: list[dict[str, Any]] = []
    with mentions_path.open(encoding="utf-8") as handle:
        for line in tqdm(handle, desc="Reading mentions", unit="row"):
            raw = line.strip()
            if not raw:
                continue
            try:
                row = json.loads(raw)
            except Exception:
                continue
            url = row.get("url")
            domain = row.get("domain")
            proof = row.get("proof") or {}
            if not isinstance(url, str) or not url:
                continue
            for person, signals in proof.items():
                profile = profiles.profile(person)
                pairs.append(
                    {
                        "url": url,
                        "domain": domain or "",
                        "person": person,
                        "proof": signals,
                        "profile": profile,
                    }
                )
    return pairs


def _load_article_contents(parsed_path: Path, url_set: set[str]) -> dict[str, str]:
    """Stream parsed articles, keeping only the urls we judge."""
    contents: dict[str, str] = {}
    needed = set(url_set)
    with parsed_path.open(encoding="utf-8") as handle:
        for line in tqdm(handle, desc="Reading parsed articles", unit="row"):
            raw = line.strip()
            if not raw:
                continue
            try:
                row = json.loads(raw)
            except Exception:
                continue
            url = row.get("url")
            if url not in needed:
                continue
            content = (
                str(row.get("title") or "")
                + " "
                + str(row.get("article_content") or "")
            )
            contents[url] = content
            needed.discard(url)
            if not needed:
                break
    return contents


def _judge_prompt(pair: dict[str, Any], content: str) -> str:
    profile = pair["profile"]
    parties = sorted(profile.parties) if profile else []
    regions = sorted(profile.woj | profile.powiat) if profile else []
    orgs = sorted(profile.orgs) if profile else []
    return _JUDGE_PROMPT.format(
        article=content[:TEXT_LIMIT],
        name=pair["person"],
        parties=", ".join(parties) or "brak",
        regions=", ".join(regions) or "brak",
        orgs=", ".join(orgs) or "brak",
        proof=", ".join(pair["proof"]) or "brak",
    )


def _judge_request(pair: dict[str, Any], content: str, model: str) -> LLMRequest:
    return LLMRequest(
        prompt=_judge_prompt(pair, content),
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        model=model,
        enable_thinking=True,
    )


def _parse_verdict(text: str) -> tuple[str, str]:
    text = _THINK_RE.sub("", text or "")
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
        # Fallback: a bare TAK/NIE as the last token of the response.
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


async def _judge_pairs(
    ctx: Context,
    pairs: list[dict[str, Any]],
    contents: dict[str, str],
    *,
    model: str,
    profiles: PersonProfileIndex,
) -> None:
    await LLM.from_context(ctx).check_health()
    inflight: dict[int, dict[str, Any]] = {}

    with tqdm(total=len(pairs), desc="Judging mentions", unit="pair") as bar:
        async with LLM.from_context(ctx).response_pool() as pool:
            for pair in pairs:
                content = contents.get(pair["url"], "")
                while pool.is_full():
                    await _drain_one(ctx, pool, inflight, model, bar)
                request_id = await pool.put_request(
                    _judge_request(pair, content, model)
                )
                inflight[request_id] = pair

            while inflight:
                await _drain_one(ctx, pool, inflight, model, bar)


async def _drain_one(ctx, pool, inflight, model, bar) -> None:
    request_id, response = await pool.get_response()
    pair = inflight.pop(request_id)
    if isinstance(response, Exception):
        verdict, justification = "unknown", str(response)[:200]
        tokens = (0, 0, 0)
    else:
        verdict, justification = _parse_verdict(response.content)
        tokens = (
            int(getattr(response, "prompt_tokens", 0) or 0),
            int(getattr(response, "completion_tokens", 0) or 0),
            int(getattr(response, "total_tokens", 0) or 0),
        )
    profile = pair.get("profile")
    ctx.io.dumper.insert_into(  # type: ignore[attr-defined]
        ArticleMentionJudge(
            url=pair["url"],
            person=pair["person"],
            parties=sorted(profile.parties) if profile else [],
            regions=sorted(profile.woj | profile.powiat) if profile else [],
            organizations=sorted(profile.orgs) if profile else [],
            judge_model=model,
            judge_version=JUDGE_VERSION,
            verdict=verdict,
            justification=justification,
            prompt_tokens=tokens[0],
            completion_tokens=tokens[1],
            total_tokens=tokens[2],
        ),
        [],
    )
    bar.update(1)


def _print_llm_usage(ctx: Context) -> None:
    llm = LLM.from_context(ctx)
    print(
        "Judge LLM usage: "
        f"{int(getattr(llm, 'request_count', 0) or 0)} requests, "
        f"{int(getattr(llm, 'total_tokens', 0) or 0)} total tokens"
    )
