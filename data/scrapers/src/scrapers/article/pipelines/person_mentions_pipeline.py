"""Find mentions of known people in parsed articles.

Cross-references the merged people dataset (``people_merged``) with the parsed
article corpus (``article_parsed``). Each article's text is scanned for
capitalized name sequences that match a known person and one record is emitted
per (person, article) pair, carrying the URL plus the title, date and tags
recovered from the article's ld+json metadata so a later pass can summarize the
articles per person.

Matching is nominative-only and diacritics-insensitive (e.g. "Jana
Kowalskiego" is not caught), so the output is a lower bound on true mentions.
"""

import json
import re
import unicodedata
from pathlib import Path
from typing import Any

import pandas as pd
from tqdm import tqdm

from entities.article import PersonArticleMention
from scrapers.article.parse import date_iso_from_ld_json, title_from_ld_json
from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.article.pipelines.parsed_pipeline import ArticleParsed
from scrapers.stores import VERSIONED_DIR, Context

_PEOPLE_FILE = Path(VERSIONED_DIR) / "people_merged" / "people_merged.jsonl"
_PARSED_FILE = Path(VERSIONED_DIR) / "article_parsed" / "article_parsed.jsonl"

# A word is capitalized when it starts with an uppercase Polish letter.
_CAP = "A-ZĄĆĘŁŃÓŚŹŻ"
_LOW = "a-ząćęłńóśźż"
_WORD = rf"[{_CAP}][{_LOW}]+(?:['-][{_CAP}{_LOW}]+)*"
# Consecutive capitalized words (2..6) -> a candidate person-name run.
_MAX_RUN_WORDS = 6
_RUN_RE = re.compile(rf"(?:{_WORD}\s+){{1,{_MAX_RUN_WORDS - 1}}}{_WORD}")


def _norm_token(token: str) -> str:
    """Lowercase a token with diacritics stripped (``Ząbek`` -> ``zabek``)."""
    decomposed = unicodedata.normalize("NFKD", token)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return stripped.lower()


def _name_tuple(name: str) -> tuple[str, ...]:
    return tuple(_norm_token(t) for t in str(name).split())


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
        self._by_tuple: dict[tuple[str, ...], set[str]] = {}
        self.max_len = 0
        self.people = 0
        self.forms = 0

    def add(self, display: str, name_forms: list[tuple[str, ...]]) -> None:
        """Register every spelling variant of one person's name."""
        for form in name_forms:
            if len(form) < 2:
                continue
            self._by_tuple.setdefault(form, set()).add(display)
            self.max_len = max(self.max_len, len(form))
            self.forms += 1
        self.people += 1

    def find_in_text(self, text: str) -> set[str]:
        """Return the display names of people mentioned in ``text``."""
        found: set[str] = set()
        for run in _RUN_RE.findall(text):
            words = run.split()
            n_words = len(words)
            max_n = min(n_words, self.max_len)
            for n in range(2, max_n + 1):
                for i in range(n_words - n + 1):
                    key = tuple(_norm_token(w) for w in words[i : i + n])
                    names = self._by_tuple.get(key)
                    if names:
                        found.update(names)
        return found


def _display_name(row: dict[str, Any]) -> str:
    full = row.get("base_full_name")
    if (
        isinstance(full, list)
        and full
        and isinstance(full[0], str)
        and full[0].strip()
    ):
        return full[0].strip()
    first = str(row.get("base_first_name") or "").strip()
    last = str(row.get("base_last_name") or "").strip()
    if first and last:
        return f"{first.title()} {last.title()}"
    return str(row.get("krs_name") or "").strip()


def _load_name_index(path: Path) -> PersonNameIndex:
    """Build the name index from the people_merged file."""
    index = PersonNameIndex()
    if not path.exists():
        return index
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            first = _name_tuple(str(row.get("base_first_name") or ""))
            last = _name_tuple(str(row.get("base_last_name") or ""))
            if not first or not last:
                continue
            forms: list[tuple[str, ...]] = [(first[0], last[-1])]
            for full in row.get("base_full_name") or []:
                if isinstance(full, str) and full.strip():
                    forms.append(_name_tuple(full))
            index.add(_display_name(row), forms)
    return index


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


class ArticlePersonMentions(IncrementalJsonlPipeline[PersonArticleMention]):
    """Cross-reference people_merged with article_parsed to find mentions."""

    filename = "article_person_mentions"
    backup_to_shared_cache = False  # derived from the ~21GB parse corpus, local-only

    parsed: ArticleParsed

    @property
    def output_class(self):
        return PersonArticleMention

    def process(self, ctx: Context) -> pd.DataFrame:
        self.prepare_temp_output()

        index = _load_name_index(_PEOPLE_FILE)
        if not index.people:
            print("No people found in people_merged, nothing to emit")
            return pd.DataFrame()
        print(f"Indexed {index.people:,} people ({index.forms:,} name forms)")

        if not _PARSED_FILE.exists():
            print("No parsed articles found, nothing to emit")
            return pd.DataFrame()

        emitted = 0
        with _PARSED_FILE.open(encoding="utf-8") as f:
            for line in tqdm(f, desc="Scanning parsed articles", unit="article"):
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except Exception:
                    continue
                if row.get("parse_status") != "ok":
                    continue
                content = str(row.get("title") or "") + " " + str(
                    row.get("article_content") or ""
                )
                if not content.strip():
                    continue
                names = index.find_in_text(content)
                if not names:
                    continue
                meta = _mention_meta(row)
                for name in names:
                    ctx.io.dumper.insert_into(  # type: ignore[attr-defined]
                        PersonArticleMention(name=name, **meta), []
                    )
                    emitted += 1

        print(f"Emitted {emitted:,} mentions")
        return pd.DataFrame()
