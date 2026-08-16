"""Tests for the ArticleFacts / ArticleAnalyzed consumption of mentions."""

import json
from pathlib import Path

import pytest

from scrapers.article.pipelines.article_analyzed_pipeline import _koryta_ids_by_url
from scrapers.article.pipelines.facts_pipeline import _mentioned_people_by_url

_MENTIONS = [
    {
        "url": "a.pl/x",
        "person": "Jan Kowalski",
        "person_id": "k1",
        "verdict": "yes",
    },
    {
        "url": "a.pl/x",
        "person": "Anna Nowak",
        "person_id": "k2",
        "verdict": "no",
    },
    {
        "url": "b.pl/y",
        "person": "Jan Kowalski",
        "person_id": "k1",
        "verdict": "unknown",
    },
    {
        "url": "b.pl/y",
        "person": "Piotr Lis",
        "person_id": "k3",
        "verdict": "yes",
    },
    {
        "url": "b.pl/y",
        "person": "Piotr Lis",
        "person_id": "k3",
        "verdict": "yes",
    },
    {"url": "c.pl/z", "person_id": "k4", "verdict": "yes"},
]


def _write_mentions(tmp_path) -> Path:
    path = tmp_path / "mentions.jsonl"
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in _MENTIONS) + "\n",
        encoding="utf-8",
    )
    return path


def test_mentioned_people_by_url_keeps_only_yes_verdicts(tmp_path):
    by_url = _mentioned_people_by_url(_write_mentions(tmp_path))
    assert by_url["a.pl/x"] == [("Jan Kowalski", "k1")]
    assert by_url["b.pl/y"] == [("Piotr Lis", "k3"), ("Piotr Lis", "k3")]
    # 'c.pl/z' has no person name -> skipped entirely.
    assert "c.pl/z" not in by_url


def test_mentioned_people_by_url_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        _mentioned_people_by_url(tmp_path / "missing.jsonl")


def test_koryta_ids_by_url_yes_only_deduped_in_order(tmp_path):
    by_url = _koryta_ids_by_url(_write_mentions(tmp_path))
    assert by_url["a.pl/x"] == ["k1"]
    assert by_url["b.pl/y"] == ["k3"]
    # A yes row needs only a person_id here (the name is not required).
    assert by_url["c.pl/z"] == ["k4"]


def test_koryta_ids_by_url_missing_file(tmp_path):
    assert _koryta_ids_by_url(tmp_path / "missing.jsonl") == {}
