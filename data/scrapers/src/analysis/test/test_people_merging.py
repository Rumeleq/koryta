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


def krs_person(
    first: str, last: str, birth_date: str, second: str | None = None
) -> dict:
    return {
        "first_name": first,
        "last_name": last,
        "second_name": second,
        "birth_year": int(birth_date[:4]),
        "birth_date": birth_date,
        "full_name": [f"{first} {last}"],
        "rejestrio_id": ["1"],
        "employment": [],
    }


def pkw_person(
    first: str,
    last: str,
    birth_year: int | None,
    second: str | None = None,
    years: tuple[str, ...] = ("2024",),
) -> dict:
    """One PKW candidate, as `PeoplePKWMerged` leaves them."""
    return {
        "first_name": first,
        "last_name": last,
        "second_name": second,
        "birth_year": birth_year,
        "full_name": [
            " ".join(part for part in [first, second, last] if part),
        ],
        "teryt_wojewodztwo": ["14"],
        "teryt_powiat": ["1465"],
        "elections": [
            {
                "party": "Komitet Wyborczy Prawo i Sprawiedliwość",
                "election_year": year,
                "election_type": "Samorząd",
                "teryt_candidacy_wojewodztwo": "14",
                "teryt_candidacy_powiat": "1465",
                "teryt_living_wojewodztwo": "14",
                "teryt_living_powiat": "1465",
                "teryt_wojewodztwo": ["14"],
                "teryt_powiat": ["1465"],
                "candidacy_success": True,
            }
            for year in years
        ],
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


def match_pkw(ctx, krs: list[dict], pkw: list[dict]) -> pd.DataFrame:
    """Run the merge over nothing but KRS and PKW.

    The mirror of `match`: Wikipedia is left empty because it joins on its own
    terms and would only add noise to a question about candidacies.
    """
    return people_merged(
        ctx,
        pd.DataFrame(krs),
        pd.DataFrame(
            columns=[
                "first_name",
                "last_name",
                "birth_year",
                "birth_date",
                "full_name",
                "source",
                "is_polityk",
                "wiki_score",
            ]
        ),
        pd.DataFrame(pkw),
        pd.DataFrame(columns=["last_name", "teryt", "count"]),
        pd.DataFrame(columns=["first_name", "p"]),
    )


def candidacy_years(result: pd.DataFrame) -> list[str]:
    """The election years the merge hung on the one person it was given.

    A person the join found nobody for keeps the `elections` of the outer join,
    which is `pd.NA` rather than an empty list - the same "no candidacies" the
    caller is asking about, so it reads back as one.
    """
    elections = result["elections"].iloc[0]
    if elections is None or elections is pd.NA:
        return []
    return sorted(str(e["election_year"]) for e in elections)


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


def test_a_middle_name_only_pkw_knows_still_matches(ctx):
    """The bug: silence about a middle name read as disagreement.

    Jarosław Wieszołek is "jarosław maciej" on the PKW candidate list and plain
    "jarosław" in KRS, so requiring the two to agree exactly cost him all three
    candidacies - and the reader who noticed wrote "Brakuje PKW" on his page.
    """
    result = match_pkw(
        ctx,
        [krs_person("jarosław", "wieszołek", "1971-09-21")],
        [pkw_person("jarosław", "wieszołek", 1971, second="maciej")],
    )

    assert candidacy_years(result) == ["2024"]


def test_a_middle_name_only_krs_knows_still_matches(ctx):
    """Silence is symmetric: PKW is as free to omit one as KRS is."""
    result = match_pkw(
        ctx,
        [krs_person("marcin", "marzyński", "1979-02-04", second="tomasz")],
        [pkw_person("marcin", "marzyński", 1979)],
    )

    assert candidacy_years(result) == ["2024"]


def test_middle_names_that_disagree_still_do_not_match(ctx):
    """Relaxing silence must not relax contradiction."""
    result = match_pkw(
        ctx,
        [krs_person("jacek", "guzicki", "1972-10-06", second="piotr")],
        [pkw_person("jacek", "guzicki", 1972, second="andrzej")],
    )

    assert candidacy_years(result) == []


def test_silence_decides_nothing_when_it_leaves_two_candidates(ctx):
    """Four Piotr Mrozińskis stand; KRS names no middle name for its one.

    Any of them could be the person, so none of them is: hanging a stranger's
    candidacies on the page is the harm the whole merge is arranged to avoid.
    """
    result = match_pkw(
        ctx,
        [krs_person("piotr", "mroziński", "1955-04-15")],
        [
            pkw_person("piotr", "mroziński", 1955, second="paweł"),
            pkw_person("piotr", "mroziński", 1956, second="teofil"),
        ],
    )

    assert candidacy_years(result) == []


def test_an_agreeing_middle_name_wins_over_a_silent_one(ctx):
    """A person who already had a match cannot be pulled off it by a looser one.

    4292 people have both kinds of candidate. Whoever agrees on the middle name
    is the answer; the one that merely fails to contradict is not even
    considered, so the count of candidates behind it cannot matter.
    """
    result = match_pkw(
        ctx,
        [krs_person("mariusz", "mandat", "1974-01-04", second="mieczysław")],
        [
            pkw_person("mariusz", "mandat", 1974, second="mieczysław", years=("2014",)),
            pkw_person("mariusz", "mandat", 1974, years=("2002",)),
            pkw_person("mariusz", "mandat", 1975, years=("2010",)),
        ],
    )

    assert candidacy_years(result) == ["2014"]
