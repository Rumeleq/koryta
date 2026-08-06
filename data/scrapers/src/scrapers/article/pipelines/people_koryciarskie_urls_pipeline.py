"""Join mentioned articles with their koryciarski scores.

Cross-references the ``ArticlePersonMentions`` output (URLs of articles that
mention a known person, plus the people matched) with the koryciarski scores,
keeping only the URLs whose article scored at least the configured minimum
(default 3). The result is the interesting slice of the mention corpus — one
record per URL carrying the score, the people mentioned and the article
metadata — that downstream passes (e.g. fact extraction) can consume.
"""

import json
import re
import unicodedata
from typing import Any

import pandas as pd
from tqdm import tqdm

from analysis.article_person_mentions import ArticlePersonMentions
from entities.article import PeopleKoryciarskieUrl
from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.article.pipelines.koryciarski_scores_pipeline import (
    ArticleKoryciarskiScores,
)
from scrapers.article.pipelines.pipeline_utils import (
    article_facts_min_koryciarski_score,
)
from scrapers.stores import Context

MIN_SCORE = 3


def _norm_url(url: str) -> str:
    """Normalize a URL for matching across the two files.

    The mentions and scores pipelines key by ``url`` as stored; both go through
    the same parser so they should agree, but strip scheme/host casing defensively.
    """
    decomposed = unicodedata.normalize("NFKD", url)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"^https?://", "", stripped.lower())


def _mention_meta_by_url(path: Any) -> dict[str, dict[str, Any]]:
    """Map normalized URL -> mention record metadata (people, title, date, tags)."""
    by_url: dict[str, dict[str, Any]] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line in tqdm(handle, desc="Reading person mentions", unit="row"):
            raw = line.strip()
            if not raw:
                continue
            try:
                row = json.loads(raw)
            except Exception:
                continue
            url = row.get("url")
            if not isinstance(url, str) or not url:
                continue
            by_url[_norm_url(url)] = {
                "url": url,
                "domain": row.get("domain"),
                "title": row.get("title"),
                "date": row.get("date"),
                "tags": [str(t) for t in (row.get("tags") or [])],
                "people_mentioned": [
                    str(p)
                    for p in (row.get("people_mentioned") or [])
                    if str(p).strip()
                ],
            }
    return by_url


def _score_from_row(row: dict[str, Any]) -> int | None:
    raw_score = row.get("koryciarski_llm_score")
    if isinstance(raw_score, bool):
        return None
    if isinstance(raw_score, int):
        return raw_score
    return None


class PeopleKoryciarskieUrls(IncrementalJsonlPipeline[PeopleKoryciarskieUrl]):
    """Mentioned articles whose koryciarski score clears the gate."""

    filename = "people_koryciarskie_urls"
    backup_to_shared_cache = False  # small derived summary, local-only

    mentions: ArticlePersonMentions
    koryciarski_scores: ArticleKoryciarskiScores

    @property
    def output_class(self):
        return PeopleKoryciarskieUrl

    def process(self, ctx: Context) -> pd.DataFrame:
        mentions_path = self.mentions.final_output_path
        if not mentions_path.exists():
            raise FileNotFoundError(mentions_path)
        scores_path = self.koryciarski_scores.final_output_path
        if not scores_path.exists():
            raise FileNotFoundError(scores_path)

        self.prepare_temp_output()

        mentions = _mention_meta_by_url(mentions_path)
        if not mentions:
            print("No mentions found, nothing to emit")
            return pd.DataFrame()

        min_score = article_facts_min_koryciarski_score() or MIN_SCORE

        emitted = 0
        with scores_path.open("r", encoding="utf-8") as handle:
            for line in tqdm(handle, desc="Reading koryciarski scores", unit="row"):
                raw = line.strip()
                if not raw:
                    continue
                try:
                    row = json.loads(raw)
                except Exception:
                    continue
                if row.get("llm_is_article") is not True:
                    continue
                url = row.get("url")
                if not isinstance(url, str) or not url:
                    continue
                score = _score_from_row(row)
                if score is None or score < min_score:
                    continue
                meta = mentions.get(_norm_url(url))
                if meta is None:
                    continue
                ctx.io.dumper.insert_into(  # type: ignore[attr-defined]
                    PeopleKoryciarskieUrl(
                        url=meta["url"],
                        koryciarski_llm_score=score,
                        people_mentioned=meta["people_mentioned"],
                        domain=meta["domain"],
                        title=meta["title"],
                        date=meta["date"],
                        tags=meta["tags"],
                    ),
                    [],
                )
                emitted += 1

        print(
            f"Emitted {emitted:,} mentioned articles with koryciarski "
            f"score >= {min_score}"
        )
        return pd.DataFrame()
