import json
from pathlib import Path
from typing import Any

import pandas as pd
from tqdm import tqdm

from entities.article import ArticleAnalyzedRecord
from scrapers.article.parse import date_iso_from_ld_json, title_from_ld_json
from scrapers.article.pipelines.koryciarski_scores_pipeline import (
    ArticleKoryciarskiScores,
)
from scrapers.article.pipelines.parsed_pipeline import ArticleParsed
from scrapers.article.pipelines.pipeline_utils import article_tag
from scrapers.article.pipelines.verified_facts_pipeline import ArticleFactsVerified
from scrapers.stores import VERSIONED_DIR, Context, Pipeline

_PARSED_FILE = Path(VERSIONED_DIR) / "article_parsed" / "article_parsed.jsonl"
_SCORES_FILE = (
    Path(VERSIONED_DIR)
    / "article_koryciarski_scores"
    / "article_koryciarski_scores.jsonl"
)
_FACTS_FILE = (
    Path(VERSIONED_DIR)
    / "article_facts_verified"
    / "article_facts_verified.jsonl"
)
_FINAL_OUTPUT_FILE = (
    Path(VERSIONED_DIR) / "article_analyzed" / "article_analyzed.jsonl"
)
_TEMP_OUTPUT_FILE = _FINAL_OUTPUT_FILE.with_suffix(".jsonl.tmp")

# Verifier bookkeeping fields kept in article_facts_verified but stripped from
# the analyzed output.
_VERIFICATION_FIELDS = {"verified", "verification_verdict", "verification_reason"}


class ArticleAnalyzed(Pipeline[ArticleAnalyzedRecord]):
    filename = "article_analyzed"
    backup_to_shared_cache = False  # large incremental output, keep local-only

    parsed: ArticleParsed
    koryciarski_scores: ArticleKoryciarskiScores
    verified_facts: ArticleFactsVerified

    @property
    def output_class(self):
        return ArticleAnalyzedRecord

    def read_or_process(self, ctx: Context) -> pd.DataFrame:
        if self._cached_result is not None:
            return self._cached_result

        if not ctx.refresh_policy.tree_printed:
            ctx.refresh_policy.build_and_print_tree(self, ctx)

        should_refresh = self.should_refresh_with_logic(ctx)
        if not should_refresh:
            self._cached_result = pd.DataFrame()
            return self._cached_result

        self.preprocess_sources(ctx, ctx.refresh_policy)
        graceful = True
        try:
            self.process(ctx)
            self._refreshed_execution = True
        except Exception:
            graceful = False
            raise
        finally:
            if graceful:
                print("Dumping...")
                ctx.io.dumper.dump_pandas()  # type: ignore[attr-defined]
                _finalize_output()
                print("Done")

        ctx.refresh_policy.add_refreshed_pipeline(self.pipeline_name)
        self._cached_result = pd.DataFrame()
        return self._cached_result

    def process(self, ctx: Context) -> pd.DataFrame:
        tag = article_tag()

        # Load facts first (small) to get the URL set we care about
        print("Loading facts...")
        facts = _load_facts(_FACTS_FILE)
        if not facts:
            print("No facts found, nothing to emit")
            return pd.DataFrame()
        print(f"  {len(facts):,} articles with facts")

        # Load scores (small, ~16MB) filtered to facts URLs
        print("Loading scores...")
        scores = _load_jsonl_filtered(_SCORES_FILE, facts)
        print(f"  {len(scores):,} matching scores")

        # Stream parsed (large) — only keep rows whose URL is in facts
        print("Streaming parsed articles...")
        parsed = _load_jsonl_filtered(_PARSED_FILE, facts)
        print(f"  {len(parsed):,} matching parsed records")

        emitted = 0
        for url, fact_rows in tqdm(facts.items(), desc="Emitting", unit="article"):
            parsed_row = parsed.get(url)
            if parsed_row is None:
                continue
            score_row = scores.get(url)

            # Prefer the parse-time date; fall back to re-deriving it from the
            # stored ld+json blob (older rows / @graph pages missed it at parse).
            publication_date = parsed_row.get("publication_date") or date_iso_from_ld_json(
                parsed_row.get("ld_json")
            )

            # Keep only verified facts and stamp each with the article date.
            # The verifier's bookkeeping fields stay in article_facts_verified;
            # they're redundant here (every kept fact is verified).
            verified_facts = []
            for fact in fact_rows:
                if not isinstance(fact, dict) or fact.get("verified") is False:
                    continue
                fact = {
                    k: v for k, v in fact.items() if k not in _VERIFICATION_FIELDS
                }
                fact["date"] = publication_date
                verified_facts.append(fact)

            # Skip articles whose facts were all filtered out — an analyzed
            # record with no facts carries no signal.
            if not verified_facts:
                continue

            record = ArticleAnalyzedRecord(
                url=url,
                domain=parsed_row.get("domain", ""),
                title=parsed_row.get("title") or title_from_ld_json(
                    parsed_row.get("ld_json")
                ),
                publication_date=publication_date,
                article_content=parsed_row.get("article_content", ""),
                koryciarski_llm_score=(
                    score_row.get("koryciarski_llm_score") if score_row else None
                ),
                koryciarski_llm_reason=(
                    score_row.get("koryciarski_llm_reason", "") if score_row else ""
                ),
                extracted_facts=verified_facts,
                tag=tag,
            )
            ctx.io.dumper.insert_into(record, [])  # type: ignore[attr-defined]
            emitted += 1

        print(f"Emitted {emitted:,} ArticleAnalyzed records")
        return pd.DataFrame()


def _finalize_output() -> None:
    if _TEMP_OUTPUT_FILE.exists():
        _FINAL_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        _TEMP_OUTPUT_FILE.replace(_FINAL_OUTPUT_FILE)


def _load_facts(path: Path) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    if not path.exists():
        return result
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row: dict[str, Any] = json.loads(line)
                url = row.get("url")
                facts = row.get("extracted_facts")
                if isinstance(url, str) and url and isinstance(facts, list) and facts:
                    result[url] = facts
            except Exception:
                continue
    return result


def _load_jsonl_filtered(
    path: Path, url_set: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    """Stream a jsonl file, keeping only rows whose url is in url_set."""
    result: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return result
    total = path.stat().st_size
    with path.open(encoding="utf-8") as f, tqdm(
        total=total, unit="B", unit_scale=True, desc=f"  {path.name}"
    ) as bar:
        for line in f:
            bar.update(len(line.encode("utf-8")))
            line = line.strip()
            if not line:
                continue
            try:
                row: dict[str, Any] = json.loads(line)
                url = row.get("url")
                if isinstance(url, str) and url in url_set:
                    result[url] = row
            except Exception:
                continue
    return result
