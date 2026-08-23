"""Recognising a censored api-krs name in a plain rejestr.io one."""

import pytest

from scrapers.krs.names import (
    censored_surname_signatures,
    is_present,
    missing_from_response,
    people_in_response,
    plain_surname_signatures,
    signature,
)
from scrapers.krs.people_parsing import CensoredPerson


def censored(surname, given, role="nadzor: "):
    return CensoredPerson(
        surname=tuple(surname),
        given=given,
        second_given="",
        pesel="7**********",
        born="",
        role=role,
    )


def entry(surname, given, typ="osoba"):
    return {"typ": typ, "tozsamosc": {"nazwisko": surname, "imie": given}}


# ─── signatures ───────────────────────────────────────────


def test_signature_is_initial_and_length():
    assert signature("K**********") == ("k", 11)
    assert signature("Kaliszewski") == ("k", 11)


def test_signature_folds_case_but_keeps_diacritics():
    assert signature("Ś******") == signature("Śmiglak")
    assert signature("Śmiglak") != signature("Smiglak")


def test_signature_of_nothing():
    assert signature("") is None
    assert signature("   ") is None


def test_two_components_can_stand_for_the_joined_surname():
    # "Kałuża" + "Swoboda" against rejestr.io's "Kałuża Swoboda"
    assert ("k", 14) in censored_surname_signatures(("K*****", "S******"))


def test_two_components_can_stand_for_the_first_alone():
    assert ("k", 6) in censored_surname_signatures(("K*****", "S******"))


def test_plain_surname_offers_every_leading_part():
    # api-krs sometimes keeps only "Kaliszewski" of the whole thing.
    assert plain_surname_signatures("Kaliszewski Vel Kieliszewski") == {
        ("k", 11),
        ("k", 15),
        ("k", 28),
    }


def test_plain_surname_splits_on_a_hyphen_too():
    assert ("m", 9) in plain_surname_signatures("Mancewicz-Kolanek")


# ─── presence ─────────────────────────────────────────────


@pytest.mark.parametrize(
    "surname, given, plain_surname, plain_given",
    [
        # Split across the two components, joined by rejestr.io.
        (["K*****", "S******"], "M*********", "Kałuża Swoboda", "Małgorzata"),
        # Whole in the first component, separator counted.
        (["S*****************"], "W*******", "Spiczak Brzeziński", "Wojciech"),
        # Only the first part in the first component.
        (["K**********"], "I*****", "Kaliszewski Vel Kieliszewski", "Ignacy"),
        # Hyphenated, whole in the first component.
        (["M****************"], "M****", "Mancewicz-Kolanek", "Marta"),
        # The ordinary case.
        (["B******"], "A****", "Bittner", "Alina"),
    ],
)
def test_present_across_the_spellings(surname, given, plain_surname, plain_given):
    people = people_in_response([entry(plain_surname, plain_given)])

    assert is_present(censored(surname, given), people)


def test_a_different_person_is_not_present():
    people = people_in_response([entry("Bittner", "Alina")])

    assert not is_present(censored(["Z*****"], "A****"), people)


def test_the_given_name_has_to_match_too():
    people = people_in_response([entry("Bittner", "Alina")])

    assert not is_present(censored(["B******"], "M*****"), people)


def test_organisations_are_not_people():
    assert people_in_response([{"typ": "organizacja", "nazwa": "GMINA"}]) == []


def test_a_person_without_a_pesel_still_counts():
    people = people_in_response([entry("Bittner", "Alina", typ="osoba-bez-pesel")])

    assert is_present(censored(["B******"], "A****"), people)


def test_a_person_with_no_name_to_match_on_is_never_missing():
    # Only a PESEL survived the masking; there is nothing to compare.
    nameless = CensoredPerson((), "", "", "7**********", "", "nadzor: ")

    assert is_present(nameless, people_in_response([entry("Bittner", "Alina")]))


# ─── missing_from_response ────────────────────────────────


def test_missing_names_who_rejestrio_left_out():
    listed = [censored(["B******"], "A****"), censored(["Z*****"], "K*****")]

    missing = missing_from_response(listed, [entry("Bittner", "Alina")])

    assert [p.surname for p in missing] == [("Z*****",)]


def test_a_role_rejestrio_does_not_model_is_not_counted_missing():
    # rejestr.io's connections feed carries no equivalent of the head of a
    # public healthcare provider, so their absence says nothing.
    listed = [censored(["Z*****"], "K*****", role="kierownik_pzoz")]

    assert missing_from_response(listed, [entry("Bittner", "Alina")]) == []


def test_an_unparseable_response_names_nobody():
    listed = [censored(["B******"], "A****")]

    assert len(missing_from_response(listed, {"error": "nope"})) == 1
