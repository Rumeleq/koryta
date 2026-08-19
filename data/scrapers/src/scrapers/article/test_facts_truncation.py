"""A completion that ran out of budget is not an extraction."""

import pytest

from scrapers.article.pipelines.facts_pipeline import (
    MAX_TOKENS,
    PROMPT_VERSION,
    _cache_valid,
    _facts_row,
)
from scrapers.stores import LLMResponse

RECORD = {
    "url": "https://example.pl/a",
    "article_content_hash": "abc123",
    "article_content": "Jan Kowalski został prezesem spółki.",
}

ANSWER = "- Jan Kowalski został prezesem spółki.\n"


def row(finish_reason: str | None, text: str = ANSWER) -> dict:
    return _facts_row(
        RECORD,
        text,
        "some-model",
        LLMResponse(content=text, finish_reason=finish_reason),
    )


def test_a_completion_that_stopped_normally_is_an_extraction():
    assert row("stop")["fact_extraction_status"] == "ok"


def test_a_finish_reason_the_gateway_did_not_send_is_not_treated_as_truncation():
    assert row(None)["fact_extraction_status"] == "ok"


def test_a_completion_truncated_at_max_tokens_is_an_error():
    """The bug this guards: the prefix parses, so it cached as a good answer.

    `_cache_valid` only re-runs rows marked "error", so half an extraction
    would have been this article's answer for ever.
    """
    result = row("length")

    assert result["fact_extraction_status"] == "error"
    assert str(MAX_TOKENS) in result["fact_extraction_error"]
    assert result["extracted_facts"] == []


def test_the_truncated_row_is_not_cache_valid():
    cached = row("length")
    cached["prompt_version"] = PROMPT_VERSION

    assert not _cache_valid(cached, RECORD, "some-model")


@pytest.mark.parametrize("reason", ["stop", None])
def test_a_good_row_is_cache_valid(reason):
    assert _cache_valid(row(reason), RECORD, "some-model")


def test_the_response_still_reports_what_it_cost():
    result = _facts_row(
        RECORD,
        ANSWER,
        "some-model",
        LLMResponse(
            content=ANSWER,
            finish_reason="length",
            prompt_tokens=11,
            completion_tokens=22,
            total_tokens=33,
        ),
    )

    assert (result["prompt_tokens"], result["completion_tokens"]) == (11, 22)
