from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import scrapers.article.pipelines.person_mentions_pipeline as person_mentions_module
from scrapers.article.pipelines.person_mentions_pipeline import (
    ArticlePersonMentions,
    PersonNameIndex,
    _load_name_index,
    _mention_meta,
    _name_tuple,
    _norm_token,
    _tags_from_ld_json,
)


class FakeDumper:
    """Minimal stand-in for stores.duckdb.EntityDumper."""

    def __init__(self) -> None:
        self.records: list[Any] = []

    def insert_into(self, record: Any, sort_by: list[str]) -> None:
        self.records.append(record)


def test_norm_token_strips_diacritics():
    assert _norm_token("Ząbek") == "zabek"
    assert _norm_token("Śląsk") == "slask"
    assert _norm_token("Kłoczko-Wysocka") == "kłoczko-wysocka"


def test_name_tuple_splits_and_normalizes():
    assert _name_tuple("Iwonka Maryca Urbanowska") == (
        "iwonka",
        "maryca",
        "urbanowska",
    )
    assert _name_tuple("") == ()


def test_tags_from_ld_json_list_and_section():
    ld: dict[str, Any] = {
        "@type": "NewsArticle",
        "keywords": ["kolizja", "mandat"],
        "articleSection": "Policja",
        "@graph": [{"keywords": "dodatkowy"}],
    }
    assert _tags_from_ld_json(ld) == ["kolizja", "mandat", "Policja", "dodatkowy"]


def test_tags_from_ld_json_string_keywords_deduped():
    ld: dict[str, Any] = {
        "keywords": "polityka",
        "articleSection": ["Kraj", "Polityka"],
    }
    assert _tags_from_ld_json(ld) == ["polityka", "Kraj"]


def test_finds_bigram_when_person_has_middle_names():
    index = PersonNameIndex()
    index.add(
        "Iwonka Maryca Urbanowska",
        [("iwonka", "urbanowska"), ("iwonka", "maryca", "urbanowska")],
    )
    assert index.find_in_text("Prezydent Iwonka Urbanowska odwiedziła miasto.") == {
        "Iwonka Maryca Urbanowska"
    }


def test_finds_full_name_with_middle_names():
    index = PersonNameIndex()
    index.add("Jan Marek Janik", [("jan", "janik"), ("jan", "marek", "janik")])
    assert index.find_in_text("Jan Marek Janik skomentował sprawę.") == {
        "Jan Marek Janik"
    }


def test_declension_not_matched():
    index = PersonNameIndex()
    index.add("Jan Kowalski", [("jan", "kowalski")])
    assert index.find_in_text("Rozmowa z Janem Kowalskim.") == set()


def test_hyphenated_last_name():
    index = PersonNameIndex()
    index.add("Anna Kłoczko-Wysocka", [("anna", "kłoczko-wysocka")])
    assert index.find_in_text("Anna Kłoczko-Wysocka wygrała.") == {
        "Anna Kłoczko-Wysocka"
    }


def test_diacritics_insensitive():
    index = PersonNameIndex()
    index.add("Rafał Trzaskowski", [("rafał", "trzaskowski")])
    assert index.find_in_text("Rafał Trzaskowski powiedział.") == {
        "Rafał Trzaskowski"
    }


def test_no_match_for_unknown_person():
    index = PersonNameIndex()
    index.add("Jan Kowalski", [("jan", "kowalski")])
    assert index.find_in_text("Adam Nowak przyszedł.") == set()


def test_dedupes_within_article():
    index = PersonNameIndex()
    index.add("Jan Kowalski", [("jan", "kowalski")])
    text = "Jan Kowalski szedł. Potem Jan Kowalski wrócił."
    assert index.find_in_text(text) == {"Jan Kowalski"}


def test_middle_name_disambiguates_longer_person():
    index = PersonNameIndex()
    index.add("Jan Janik", [("jan", "janik")])
    index.add("Jan Marek Janik", [("jan", "janik"), ("jan", "marek", "janik")])
    assert index.find_in_text("Jan Marek Janik złożył wniosek.") == {
        "Jan Marek Janik"
    }


def test_bare_bigram_matches_ambiguous_names():
    index = PersonNameIndex()
    index.add("Jan Janik", [("jan", "janik")])
    index.add("Jan Marek Janik", [("jan", "janik"), ("jan", "marek", "janik")])
    assert index.find_in_text("Jan Janik powiedział.") == {
        "Jan Janik",
        "Jan Marek Janik",
    }


def test_load_name_index(tmp_path):
    path = tmp_path / "people.jsonl"
    path.write_text(
        json.dumps(
            {
                "base_first_name": "iwonka",
                "base_last_name": "urbanowska",
                "base_full_name": ["Iwonka Maryca Urbanowska"],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    index = _load_name_index(path)
    assert index.people == 1
    assert index.find_in_text("Iwonka Urbanowska coś zrobiła.") == {
        "Iwonka Maryca Urbanowska"
    }


def test_mention_meta_prefers_row_fields():
    row = {
        "url": "example.com/a",
        "domain": "example.com",
        "title": "Tytuł",
        "publication_date": "2026-01-02",
        "ld_json": {"headline": "Inny tytuł", "keywords": ["tag"]},
    }
    meta = _mention_meta(row)
    assert meta["url"] == "example.com/a"
    assert meta["title"] == "Tytuł"
    assert meta["date"] == "2026-01-02"
    assert meta["tags"] == ["tag"]


def test_mention_meta_falls_back_to_ld_json():
    row = {
        "url": "example.com/b",
        "domain": "example.com",
        "title": None,
        "publication_date": None,
        "ld_json": {
            "@type": "NewsArticle",
            "headline": "Nagłówek",
            "datePublished": "2025-03-04T10:00:00+01:00",
        },
    }
    meta = _mention_meta(row)
    assert meta["title"] == "Nagłówek"
    assert meta["date"] == "2025-03-04"
    assert meta["tags"] == []


def test_process_emits_mentions(tmp_path, monkeypatch):
    people = tmp_path / "people.jsonl"
    people.write_text(
        json.dumps(
            {
                "base_first_name": "jan",
                "base_last_name": "kowalski",
                "base_full_name": ["Jan Kowalski"],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    parsed = tmp_path / "parsed.jsonl"
    parsed.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "url": "a.pl/1",
                        "domain": "a.pl",
                        "parse_status": "ok",
                        "title": "T1",
                        "publication_date": "2026-01-01",
                        "ld_json": {"keywords": ["k"]},
                        "article_content": "Jan Kowalski napisał.",
                    }
                ),
                json.dumps(
                    {
                        "url": "b.pl/2",
                        "domain": "b.pl",
                        "parse_status": "selector_not_found",
                        "title": "T2",
                        "publication_date": None,
                        "ld_json": None,
                        "article_content": "Jan Kowalski.",
                    }
                ),
                json.dumps(
                    {
                        "url": "c.pl/3",
                        "domain": "c.pl",
                        "parse_status": "ok",
                        "title": "T3",
                        "publication_date": None,
                        "ld_json": None,
                        "article_content": "Brak nazwisk.",
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(person_mentions_module, "_PEOPLE_FILE", people)
    monkeypatch.setattr(person_mentions_module, "_PARSED_FILE", parsed)

    dumper = FakeDumper()
    ctx = SimpleNamespace(io=SimpleNamespace(dumper=dumper))
    pipeline = ArticlePersonMentions()
    df = pipeline.process(ctx)

    assert df is not None
    assert len(dumper.records) == 1
    assert dumper.records[0].name == "Jan Kowalski"
    assert dumper.records[0].url == "a.pl/1"
    assert dumper.records[0].tags == ["k"]
