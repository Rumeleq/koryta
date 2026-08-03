"""ArticleFactsVerified — LLM-as-judge verification of extracted facts.

Takes the ArticleExtractedFacts output and, for every fact, asks the configured
LLM to judge it against the labeling rulebook (facts_labeling_rules.md). Each
fact keeps all its original fields and gains a binary decision plus context:

    "verified":            true | false        # true iff verdict == "correct"
    "verification_verdict": correct|incorrect|insufficient|unknown
    "verification_reason":  short judge rationale

The file is rewritten with every fact annotated (nothing dropped) — downstream
(ArticleAnalyzed) keeps only the verified ones. Judging is per-fact, cached by
(article_content_hash, verify_model, VERIFY_VERSION), so re-runs are cheap.
"""

import asyncio
import json
import re
from pathlib import Path
from typing import Any

import pandas as pd
from tqdm import tqdm

from entities.article import ArticleFactsVerified as ArticleFactsVerifiedRecord
from scrapers.article.pipelines.facts_pipeline import ArticleExtractedFacts
from scrapers.article.pipelines.pipeline_utils import llm_model
from scrapers.stores import VERSIONED_DIR, Context, LLMRequest, Pipeline

VERIFY_VERSION = 1
MAX_TOKENS = 4000
TEMPERATURE = 0.0

_INPUT_FILE = Path(VERSIONED_DIR) / "article_facts" / "article_facts.jsonl"
_FINAL_OUTPUT_FILE = (
    Path(VERSIONED_DIR) / "article_facts_verified" / "article_facts_verified.jsonl"
)
_TEMP_OUTPUT_FILE = _FINAL_OUTPUT_FILE.with_suffix(".jsonl.tmp")

_THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", flags=re.DOTALL)
_JSON_LABEL_RE = re.compile(r"\{[^{}]*\"label\"[^{}]*\}", flags=re.DOTALL)
_JSON_ANY_RE = re.compile(r"\{.*\}", flags=re.DOTALL)

# The rulebook lives at the scrapers repo root. Fall back to an embedded rubric
# so the pipeline still runs if the file is absent.
_RULES_PATH = Path(__file__).resolve().parents[4] / "facts_labeling_rules.md"
_EMBEDDED_RULES = (
    "Judge an extracted fact ONLY from its justification span. correct: the "
    "subject is a valid full name (Imię Nazwisko or Imię N.) present in the "
    "span, and every populated field (role/organization/party/relation/object) "
    "is in Polish and stated or directly entailed by the span. insufficient: "
    "fields are plausible but the span does not name the subject or is too "
    "fragmentary to verify. incorrect: any concrete defect — non-Polish field, "
    "subject that is a bare initial/role/description, an attribute that is "
    "contradicted, absent (ungrounded) or over-specific, or a swapped/unnamed "
    "relation."
)


def _load_rules() -> str:
    try:
        return _RULES_PATH.read_text(encoding="utf-8")
    except OSError:
        return _EMBEDDED_RULES


_RULES = _load_rules()

_JUDGE_PROMPT = (
    "You label an extracted fact using this rulebook. Judge ONLY from the "
    "justification span; never use world knowledge or text outside it. Reply "
    "with a single compact JSON object and nothing else: "
    '{{"label": "correct|incorrect|insufficient", "reason": "..."}}.\n\n'
    "RULEBOOK:\n{rules}\n\n"
    "FACT (JSON):\n{fact}"
)


class ArticleFactsVerified(Pipeline[ArticleFactsVerifiedRecord]):
    filename = "article_facts_verified"
    backup_to_shared_cache = False

    extracted_facts: ArticleExtractedFacts

    @property
    def output_class(self):
        return ArticleFactsVerifiedRecord

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
            df = self.process(ctx)
            self._refreshed_execution = True
        except (InterruptedError, KeyboardInterrupt):
            print("Caught interrupt signal, will save partial verifications")
            df = pd.DataFrame()
        except Exception:
            graceful = False
            raise
        finally:
            if graceful:
                print("Dumping...")
                ctx.io.dumper.dump_pandas()  # type: ignore[attr-defined]
                if _TEMP_OUTPUT_FILE.exists():
                    _finalize_temp_output()
                print("Done")

        ctx.refresh_policy.add_refreshed_pipeline(self.pipeline_name)
        self._cached_result = df
        return df

    def process(self, ctx: Context) -> pd.DataFrame:
        if ctx.llm is None:
            raise ValueError("ArticleFactsVerified requires Context.llm")
        if not _INPUT_FILE.exists():
            raise FileNotFoundError(_INPUT_FILE)

        model = llm_model(ctx)
        existing = _existing_verified_cache(_FINAL_OUTPUT_FILE, _TEMP_OUTPUT_FILE)
        _prepare_temp_output()
        rows = _load_input_rows(_INPUT_FILE)
        asyncio.run(_verify_rows(ctx, rows, existing, model=model))
        _print_llm_usage(ctx)
        return pd.DataFrame()


# --------------------------------------------------------------------------- #
# IO helpers
# --------------------------------------------------------------------------- #
def _prepare_temp_output() -> None:
    _TEMP_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    if _TEMP_OUTPUT_FILE.exists():
        _TEMP_OUTPUT_FILE.unlink()
    _TEMP_OUTPUT_FILE.write_text("", encoding="utf-8")


def _finalize_temp_output() -> None:
    if _TEMP_OUTPUT_FILE.exists():
        _FINAL_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        _TEMP_OUTPUT_FILE.replace(_FINAL_OUTPUT_FILE)


def _load_input_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in tqdm(handle, desc="Reading facts", unit="row"):
            raw = line.strip()
            if not raw:
                continue
            try:
                rows.append(json.loads(raw))
            except Exception:
                continue
    return rows


def _existing_verified_cache(*paths: Path) -> dict[str, dict[str, Any]]:
    cache: dict[str, dict[str, Any]] = {}
    for path in paths:
        if not path.exists():
            continue
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                raw = line.strip()
                if not raw:
                    continue
                try:
                    row = json.loads(raw)
                except Exception:
                    continue
                url = row.get("url")
                if isinstance(url, str):
                    cache[url] = row
    return cache


def _cache_valid(
    cached: dict[str, Any] | None,
    row: dict[str, Any],
    model: str,
) -> bool:
    if cached is None or cached.get("verify_status") == "error":
        return False
    facts_in = row.get("extracted_facts") or []
    facts_cached = cached.get("extracted_facts") or []
    return (
        cached.get("article_content_hash") == row.get("article_content_hash")
        and cached.get("verify_model") == model
        and cached.get("verify_version") == VERIFY_VERSION
        and len(facts_cached) == len(facts_in)
        and all(isinstance(f, dict) and "verified" in f for f in facts_cached)
    )


# --------------------------------------------------------------------------- #
# Judging
# --------------------------------------------------------------------------- #
def _fact_view(fact: dict[str, Any]) -> dict[str, Any]:
    view = {
        key: fact.get(key)
        for key in (
            "fact_type", "person", "subject", "role", "party",
            "organization", "object", "relation",
        )
        if fact.get(key) is not None
    }
    # Judge against the verbatim span, never the model's justification field.
    view["justification"] = (fact.get("justification_in_text") or "").strip()
    return view


def _judge_request(fact: dict[str, Any], model: str) -> LLMRequest:
    prompt = _JUDGE_PROMPT.format(
        rules=_RULES,
        fact=json.dumps(_fact_view(fact), ensure_ascii=False),
    )
    return LLMRequest(
        prompt=prompt,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        model=model,
        enable_thinking=True,
    )


def _parse_verdict(text: str) -> tuple[str, str]:
    text = _THINK_BLOCK_RE.sub("", text or "")
    match = _JSON_LABEL_RE.search(text) or _JSON_ANY_RE.search(text)
    if not match:
        return "unknown", "judge returned no JSON"
    try:
        obj = json.loads(match.group(0))
    except Exception:
        return "unknown", "judge JSON parse error"
    label = obj.get("label")
    if label not in {"correct", "incorrect", "insufficient"}:
        return "unknown", str(obj.get("reason") or "")[:300]
    return label, str(obj.get("reason") or "")[:300]


def _annotate(fact: dict[str, Any], verdict: str, reason: str) -> dict[str, Any]:
    annotated = dict(fact)
    annotated["verification_verdict"] = verdict
    annotated["verification_reason"] = reason
    annotated["verified"] = verdict == "correct"
    return annotated


def _emit_row(
    ctx: Context,
    row: dict[str, Any],
    facts: list[dict[str, Any]],
    model: str,
    status: str = "ok",
    error: str | None = None,
) -> None:
    ctx.io.dumper.insert_into(  # type: ignore[attr-defined]
        ArticleFactsVerifiedRecord(
            url=str(row.get("url") or ""),
            article_content_hash=str(row.get("article_content_hash") or ""),
            extracted_facts=facts,
            fact_extraction_status=str(row.get("fact_extraction_status") or "ok"),
            verify_status=status,
            verify_error=error,
            verify_model=model,
            verify_version=VERIFY_VERSION,
        ),
        [],
    )


async def _verify_rows(
    ctx: Context,
    rows: list[dict[str, Any]],
    existing: dict[str, dict[str, Any]],
    *,
    model: str,
) -> None:
    assert ctx.llm is not None
    await ctx.llm.check_health()

    # Reuse cache and collect fact-level tasks for the rest.
    to_judge: list[dict[str, Any]] = []
    reused = 0
    for row in rows:
        cached = existing.get(str(row.get("url")))
        if _cache_valid(cached, row, model):
            assert cached is not None
            _emit_row(ctx, row, cached.get("extracted_facts") or [], model)
            reused += 1
            continue
        facts = [f for f in (row.get("extracted_facts") or []) if isinstance(f, dict)]
        if not facts:
            _emit_row(ctx, row, [], model)  # nothing to verify
            continue
        to_judge.append(
            {"row": row, "facts": facts, "results": [None] * len(facts), "pending": len(facts)}
        )
    if reused:
        print(f"Reused cached verifications: {reused}")

    total_facts = sum(state["pending"] for state in to_judge)
    if total_facts == 0:
        return

    # request_id -> (state, fact_index)
    inflight: dict[int, tuple[dict[str, Any], int]] = {}
    tasks = [
        (state, idx)
        for state in to_judge
        for idx in range(len(state["facts"]))
    ]

    with tqdm(total=total_facts, desc="Verifying facts", unit="fact") as bar:
        async with ctx.llm.response_pool() as pool:
            for state, idx in tasks:
                while pool.is_full():
                    await _drain_one(ctx, pool, inflight, model, bar)
                request_id = await pool.put_request(
                    _judge_request(state["facts"][idx], model)
                )
                inflight[request_id] = (state, idx)

            while inflight:
                await _drain_one(ctx, pool, inflight, model, bar)


async def _drain_one(ctx, pool, inflight, model, bar) -> None:
    request_id, response = await pool.get_response()
    state, idx = inflight.pop(request_id)
    if isinstance(response, Exception):
        verdict, reason = "unknown", str(response)[:200]
    else:
        verdict, reason = _parse_verdict(response.content)
    state["results"][idx] = _annotate(state["facts"][idx], verdict, reason)
    state["pending"] -= 1
    bar.update(1)
    if state["pending"] == 0:
        _emit_row(ctx, state["row"], state["results"], model)


def _print_llm_usage(ctx: Context) -> None:
    llm = ctx.llm
    if llm is None:
        return
    print(
        "Verify LLM usage: "
        f"{int(getattr(llm, 'request_count', 0) or 0)} requests, "
        f"{int(getattr(llm, 'total_tokens', 0) or 0)} total tokens"
    )
