"""Which region a candidacy is filed under."""

import duckdb
import pandas as pd
import pytest

from analysis.people_pkw_merged import people_pkw_merged
from analysis.utils.elections import candidacy_teryt
from scrapers.stores import Context, ProcessPolicy
from scrapers.test_tree import MockIO, MockNLP, MockRejestrIO, MockUtils, MockWeb

# Kłobuck, where Mariusz Mandat stood, and Warszawa, where PKW recorded that he
# lived. The note on his page says the PKW match is right and the powiat wrong.
KLOBUCK = "2404"
WARSZAWA = "1465"


def test_the_region_is_where_they_stood():
    assert (
        candidacy_teryt(
            {
                "teryt_candidacy_powiat": KLOBUCK,
                "teryt_living_powiat": WARSZAWA,
                "teryt_powiat": [WARSZAWA, KLOBUCK],
            }
        )
        == KLOBUCK
    )


def test_a_candidacy_with_no_region_of_its_own_falls_back_to_the_old_list():
    """Rows written before the two were told apart still have to render."""
    assert candidacy_teryt({"teryt_powiat": [WARSZAWA]}) == WARSZAWA


def test_the_wojewodztwo_stands_in_when_the_powiat_is_missing():
    assert (
        candidacy_teryt(
            {"teryt_candidacy_powiat": None, "teryt_candidacy_wojewodztwo": "24"}
        )
        == "24"
    )


def test_a_candidacy_with_no_region_at_all_has_none():
    assert candidacy_teryt({"teryt_powiat": []}) is None


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


def candidacy(**overrides) -> pd.DataFrame:
    """One PKW candidacy row, as `PeoplePKW` leaves it."""
    row = {
        "first_name": "Mariusz",
        "last_name": "Mandat",
        "middle_name": None,
        "teryt_candidacy": f"{KLOBUCK}01",
        "teryt_living": f"{WARSZAWA}01",
        "birth_year": 1965,
        "pkw_name": "Mariusz Mandat",
        "party": "KW PSL",
        "election_year": 2024,
        "election_type": "samorządu",
        "candidacy_success": None,
    }
    return pd.DataFrame([row | overrides])


def test_the_merge_keeps_the_two_regions_apart(ctx):
    """The merged table has to carry both, or nothing downstream can choose.

    They used to arrive as `list_distinct([candidacy, living])`, which drops
    NULLs and does not preserve order - so where the two differ, either one
    could come out in front, and every consumer takes the first.
    """
    merged = people_pkw_merged(ctx, candidacy())
    [election] = merged.iloc[0]["elections"]

    assert election["teryt_candidacy_powiat"] == KLOBUCK
    assert election["teryt_living_powiat"] == WARSZAWA
    assert candidacy_teryt(election) == KLOBUCK


def test_the_combined_list_puts_the_candidacy_first(ctx):
    """`people.py` keys its surname-frequency lookup on element one of it."""
    merged = people_pkw_merged(ctx, candidacy())
    [election] = merged.iloc[0]["elections"]

    assert list(election["teryt_powiat"]) == [KLOBUCK, WARSZAWA]


def test_a_candidacy_with_no_recorded_residence_still_has_its_region(ctx):
    merged = people_pkw_merged(ctx, candidacy(teryt_living=None))
    [election] = merged.iloc[0]["elections"]

    assert candidacy_teryt(election) == KLOBUCK
    assert list(election["teryt_powiat"]) == [KLOBUCK]
