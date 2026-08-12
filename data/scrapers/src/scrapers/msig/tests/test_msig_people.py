"""Which entries name people, and what each person was to the company."""

import collections

from scrapers.msig.entries import Action, parse_body
from scrapers.msig.people import people_in
from scrapers.msig.tests.test_msig_entries import WPIS_KOLEJNY, WPIS_PIERWSZY


def people_of(text, unclassified=None):
    return list(people_in(parse_body(text).entries, unclassified))


def test_a_struck_board_member_is_read_in_full():
    """The point of the source: the name and the PESEL, not their first letters."""
    struck = [
        person
        for person in people_of(WPIS_KOLEJNY)
        if person.action is Action.REMOVE and person.dzial == 2
    ]
    assert len(struck) == 1
    assert struck[0].full_name == "STANISŁAW ANTONI GOSIEWSKI"
    assert struck[0].pesel == "69032811497"
    assert struck[0].role == "Członek Zarządu"


def test_the_function_field_moved_between_vintages():
    """Field 4 in 2003, field 5 in 2024, found by shape rather than position."""
    assert {p.role for p in people_of(WPIS_PIERWSZY) if p.dzial == 2} == {"Wspólnik"}
    assert {p.role for p in people_of(WPIS_KOLEJNY) if p.dzial == 2} == {
        "Członek Zarządu"
    }


def test_shareholders_come_from_dzial_1():
    shareholders = [p for p in people_of(WPIS_PIERWSZY) if p.dzial == 1]
    assert [p.full_name for p in shareholders] == [
        "WENANCJUSZ STANISŁAW SZYSZKA",
        "LUDMIŁA SZPILMAN SZYSZKA",
    ]
    assert {p.role for p in shareholders} == {"Wspólnik"}


def test_a_first_entry_states_rather_than_changes():
    assert {p.action for p in people_of(WPIS_PIERWSZY)} == {Action.STATE}


def test_the_organs_own_line_is_not_a_person():
    """``1. ZARZĄD 2. KAŻDY WSPÓLNIK MA PRAWO ...`` sits where a name would."""
    assert "WSPÓLNICY REPREZENTUJĄCY SPÓŁKĘ" not in {
        p.last_name for p in people_of(WPIS_PIERWSZY)
    }


def test_the_organs_own_line_is_not_counted_as_an_unknown_rubryka():
    unclassified: collections.Counter[str] = collections.Counter()
    people_of(WPIS_PIERWSZY, unclassified)
    people_of(WPIS_KOLEJNY, unclassified)
    assert unclassified == {}


def test_an_address_is_not_a_person():
    body = (
        "Dz. 1 Rub. 2 1. kraj POLSKA województwo ŚLĄSKIE powiat M. KATOWICE "
        "miejscowość KATOWICE 2. ulica CZERWIŃSKIEGO nr domu 6"
    )
    assert people_of(body) == []


def test_a_pkd_code_is_not_a_person():
    body = "Dz. 3 Rub. 1 1. 22 11 Z WYDAWANIE KSIĄŻEK 2 1. 74 20 A DORADZTWO"
    assert people_of(body) == []


def test_a_shareholder_that_is_a_company_is_not_a_person():
    """Same rubryka, same fields, a REGON where a person has a PESEL."""
    body = (
        "Dz. 1 Rub. 7 Dane wspólników wpisać: 1 1. FUNDUSZ INWESTYCYJNY "
        "3. 012100784 4. 0000010681"
    )
    assert people_of(body) == []


def test_a_foreign_board_member_with_no_pesel_is_still_a_person():
    body = (
        "Dz. 2 Rub. 1 Organ uprawniony do reprezentacji podmiotu PRub. Dane "
        "osób wchodzących w skład organu wpisać: 1 1. POWER 2. ANTHONY "
        "5. CZŁONEK ZARZĄDU 6. NIE"
    )
    person = people_of(body)[0]
    assert person.full_name == "ANTHONY POWER"
    assert person.pesel is None


def test_a_pesel_added_to_a_sitting_member_is_attached_to_their_name():
    """Split across two entries, each half on its own says nothing."""
    body = (
        "Dz. 2. Rub. 1. Organ uprawniony do reprezentacji podmiotu PRub. Dane "
        "osób wchodzących w skład organu 1 (dla pozycji: 1. BREAGY 2. DEREK) "
        "wpisać: 3. 69081214630 2 (dla pozycji: 1. WATERS 2. BRENDAN) "
        "3. 84092022517"
    )
    people = people_of(body)
    assert [(p.last_name, p.pesel) for p in people] == [
        ("BREAGY", "69081214630"),
        ("WATERS", "84092022517"),
    ]
    assert {p.action for p in people} == {Action.REFERENCE}


def test_roles_are_taken_from_the_rubryka_where_there_is_no_function_field():
    body = (
        "Dz. 2 Rub. 2 Organ nadzoru PRub. Dane osób wchodzących w skład "
        "organu wpisać: 1 1. ŚMIGIELSKI 2. ROMUALD 3. 50012908593 "
        "Rub. 3 Prokurenci wpisać: 1 1. MIRGOS 2. ALICJA HELENA "
        "3. 59030205666 4. PROKURA SAMOISTNA"
    )
    assert [(p.last_name, p.role) for p in people_of(body)] == [
        ("ŚMIGIELSKI", "Rada Nadzorcza"),
        ("MIRGOS", "Prokurent"),
    ]


def test_a_liquidator_is_recognised_by_its_sub_rubryka():
    body = (
        "Dz. 6 Rub. 1 Likwidacja PRub. Dane likwidatorów wpisać: 1 "
        "1. PAWŁOWSKI 2. WAWRZYNIEC MAURYCY 3. 72053112193"
    )
    assert people_of(body)[0].role == "Likwidator"


def test_an_unknown_rubryka_holding_a_name_is_counted_not_swallowed():
    body = (
        "Dz. 9 Rub. 4 Rada Programowa wpisać: 1 1. KOWALSKI 2. JAN "
        "3. 69032811497"
    )
    unclassified: collections.Counter[str] = collections.Counter()
    assert people_of(body, unclassified) == []
    assert unclassified == {"Dz.9 Rub.4 Rada Programowa": 1}
