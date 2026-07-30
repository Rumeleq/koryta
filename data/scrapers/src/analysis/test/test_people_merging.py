"""Which Wikipedia biography, if any, the KRS↔PKW join attaches to a person."""

import duckdb
import pandas as pd
import pytest

from analysis.people import people_merged
from analysis.people_wiki_merged import people_wiki_merged
from scrapers.stores import Context, ProcessPolicy
from scrapers.test_tree import MockIO, MockNLP, MockRejestrIO, MockUtils, MockWeb


@pytest.fixture
def ctx():
    return Context(
        io=MockIO(),
        rejestr_io=MockRejestrIO(),
        con=duckdb.connect(),
        utils=MockUtils(),
        web=MockWeb(),
        nlp=MockNLP(),
        refresh_policy=ProcessPolicy.with_default(),
    )


def krs_person(first: str, last: str, birth_date: str) -> dict:
    return {
        "first_name": first,
        "last_name": last,
        "second_name": None,
        "birth_year": int(birth_date[:4]),
        "birth_date": birth_date,
        "full_name": [f"{first} {last}"],
        "rejestrio_id": ["1"],
        "employment": [],
    }


def article(name: str, birth_iso8601: str) -> dict:
    """One Wikipedia biography, as `ProcessWiki` leaves it.

    `birth_iso8601` is whatever `parse_date` made of the infobox: a full date
    where the article gave one, `1959-00-00` where it gave only a year.
    """
    return {
        "source": f"https://pl.wikipedia.org/wiki/{name.replace(' ', '_')}",
        "full_name": name,
        "party": "",
        "birth_iso8601": birth_iso8601,
        "birth_year": int(birth_iso8601[:4]),
        "infoboxes": ["Polityk"],
        "content_score": 1,
        "links": [],
    }


def match(ctx, krs: list[dict], articles: list[dict]) -> pd.DataFrame:
    """Run the merge over nothing but KRS and Wikipedia, and hand back the rows.

    The wiki side goes through its own merge first, so the test sees the same
    `birth_date` the pipeline would produce rather than one written by hand.
    PKW is left empty on purpose: it joins in its own right and would only add
    noise to a question about Wikipedia. The two frequency tables are the
    smallest shape `unique_probability` accepts.
    """
    wiki = people_wiki_merged(ctx, pd.DataFrame(articles))
    return people_merged(
        ctx,
        pd.DataFrame(krs),
        wiki,
        pd.DataFrame(
            columns=[
                "first_name",
                "last_name",
                "second_name",
                "birth_year",
                "full_name",
                "teryt_wojewodztwo",
                "teryt_powiat",
                "elections",
            ]
        ),
        pd.DataFrame(columns=["last_name", "teryt", "count"]),
        pd.DataFrame(columns=["first_name", "p"]),
    )


def test_a_year_only_biography_matches_somebody_born_that_year(ctx):
    """The bug: `1959-00-00` is neither a date nor NULL, so it matched nobody.

    Polish biographies of local officials routinely give the year alone, and
    KRS knows everybody's full date of birth, so equality can never hold. Only
    297 of 6077 people carried a Wikipedia link, against reviewers repeatedly
    noting "brakuje wikipedii" on people who plainly have an article.
    """
    result = match(
        ctx,
        [krs_person("piotr", "uszok", "1959-03-02")],
        [article("Piotr Uszok", "1959-00-00")],
    )

    assert list(result["wiki_name"]) == ["Piotr Uszok"]


def test_a_year_only_biography_does_not_match_a_different_year(ctx):
    """Dropping the day must not amount to dropping the year with it."""
    result = match(
        ctx,
        [krs_person("piotr", "uszok", "1984-03-02")],
        [article("Piotr Uszok", "1959-00-00")],
    )

    assert result["wiki_name"].isna().all()


def test_a_dated_biography_still_has_to_agree_on_the_day(ctx):
    """Where the article is precise, so is the match."""
    result = match(
        ctx,
        [krs_person("piotr", "uszok", "1959-03-02")],
        [article("Piotr Uszok", "1959-11-30")],
    )

    assert result["wiki_name"].isna().all()


def test_a_dated_biography_matches_the_day_it_names(ctx):
    result = match(
        ctx,
        [krs_person("piotr", "uszok", "1959-03-02")],
        [article("Piotr Uszok", "1959-03-02")],
    )

    assert list(result["wiki_name"]) == ["Piotr Uszok"]
