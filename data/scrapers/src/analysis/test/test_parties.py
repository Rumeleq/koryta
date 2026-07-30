"""Which party a candidacy puts somebody in."""

import pytest

from analysis.payloads.person import parties_from_committees, unmapped_committees
from entities.composite import Election
from scrapers.pkw.elections import parties_of_committee


def candidacy(committee: str | None) -> Election:
    return Election(election_type="Samorząd", committee=committee)


@pytest.mark.parametrize(
    ("committee", "expected"),
    [
        ("KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ", ["PiS"]),
        ("KOALICYJNY KOMITET WYBORCZY KOALICJA OBYWATELSKA", ["PO"]),
        ("KOALICYJNY KOMITET WYBORCZY KOALICJA OBYWATELSKA PO .N IPL ZIELONI", ["PO"]),
        ("KOMITET WYBORCZY POLSKIE STRONNICTWO LUDOWE", ["PSL"]),
        ("KOMITET WYBORCZY NOWA LEWICA", ["Nowa Lewica"]),
        ("KOMITET WYBORCZY SOJUSZ LEWICY DEMOKRATYCZNEJ", ["SLD"]),
        ("KOMITET WYBORCZY KONFEDERACJA WOLNOŚĆ I NIEPODLEGŁOŚĆ", ["Konfederacja"]),
    ],
)
def test_the_national_committees_are_recognised(committee, expected):
    """These five cover about a third of every candidate in 2024."""
    assert parties_of_committee(committee) == expected


def test_a_joint_list_counts_as_both_parties():
    assert parties_of_committee(
        "KOALICYJNY KOMITET WYBORCZY TRZECIA DROGA POLSKA 2050 SZYMONA HOŁOWNI"
        " - POLSKIE STRONNICTWO LUDOWE"
    ) == ["PSL", "Polska 2050"]


@pytest.mark.parametrize(
    "committee",
    [
        "komitet wyborczy prawo i sprawiedliwość",
        "Komitet Wyborczy Prawo i Sprawiedliwość",
        "KOMITET  WYBORCZY   PRAWO I SPRAWIEDLIWOŚĆ",
        "  KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ  ",
    ],
)
def test_case_and_spacing_do_not_matter(committee):
    """PKW writes it differently in every file, and both columns feed `party`."""
    assert parties_of_committee(committee) == ["PiS"]


@pytest.mark.parametrize(
    "committee",
    [
        # Local committees that borrow a national brand. Matching on a fragment
        # would hand these people a party they never stood for.
        "KOMITET WYBORCZY WYBORCÓW POROZUMIENIE SŁUŻY LUDZIOM - TRZECIA DROGA",
        "KOMITET WYBORCZY WYBORCÓW KONFEDERACI BEZPARTYJNI POLSKA JEST JEDNA"
        " DLA POMORZA",
        "KOMITET WYBORCZY WYBORCÓW RAZEM DLA GMINY OPATÓWEK",
        "KOMITET WYBORCZY WYBORCÓW WSPÓLNY KALISZ",
    ],
)
def test_a_local_committee_borrowing_a_name_gets_no_party(committee):
    assert parties_of_committee(committee) == []


def test_a_candidacy_with_no_committee_gets_no_party():
    assert parties_of_committee(None) == []
    assert parties_of_committee("") == []


def test_a_person_is_every_party_they_stood_for():
    assert parties_from_committees(
        [
            candidacy("KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ"),
            candidacy("KOMITET WYBORCZY WYBORCÓW WSPÓLNY KALISZ"),
            candidacy("KOALICYJNY KOMITET WYBORCZY KOALICJA OBYWATELSKA"),
        ]
    ) == ["PO", "PiS"]


def test_the_unrecognised_committees_are_the_ones_worth_reporting():
    assert unmapped_committees(
        [
            candidacy("KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ"),
            candidacy("KOMITET WYBORCZY WYBORCÓW WSPÓLNY KALISZ"),
            candidacy(None),
        ]
    ) == ["KOMITET WYBORCZY WYBORCÓW WSPÓLNY KALISZ"]
