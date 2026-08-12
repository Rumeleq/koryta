"""What an announcement says about the company itself."""

from scrapers.msig.companies import Identity, clean_name, identity_in
from scrapers.msig.entries import parse_body
from scrapers.msig.tests.test_msig_entries import WPIS_PIERWSZY


def identity_of(text):
    return identity_in(parse_body(text).entries)


def test_a_first_entry_states_the_whole_identity():
    identity = identity_of(WPIS_PIERWSZY)
    assert identity.name == (
        "AGENCJA GOSPODARCZA COMMERCIUM SZPILMAN SZYSZKA, SPÓŁKA JAWNA"
    )
    assert identity.regon == "270616654"
    assert identity.city == "KATOWICE"
    assert identity.postal_code == "40-123"


def test_an_announcement_that_touches_neither_rubryka_states_nothing():
    body = "Dz. 2. Rub. 3. Prokurenci wykreślić: 1 1. NOWAK 2. JAN 3. 69032811497"
    assert identity_of(body) == Identity()


def test_a_rename_is_read_from_the_entry_that_made_it():
    body = (
        "Dz. 1. Rub. 1. Dane podmiotu wykreślić: 3. STARA NAZWA SPÓŁKA JAWNA "
        "wpisać: 3. NOWA NAZWA SPÓŁKA JAWNA"
    )
    assert identity_of(body).name == "NOWA NAZWA SPÓŁKA JAWNA"


def test_a_newer_statement_wins_field_by_field():
    older = Identity(name="STARA", regon="270616654", city="KATOWICE")
    newer = Identity(name="NOWA")
    assert newer.merge(older) == Identity(
        name="NOWA", regon="270616654", city="KATOWICE"
    )


def test_the_typeset_name_is_tidied():
    assert clean_name("POLSKIE KOLEJE PAŃSTWOWE  SPÓŁKA AKCYJNA.") == (
        "POLSKIE KOLEJE PAŃSTWOWE SPÓŁKA AKCYJNA"
    )
    assert clean_name(None) is None
    assert clean_name("  .  ") is None
