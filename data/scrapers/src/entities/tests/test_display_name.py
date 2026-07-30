"""What a company is called, when its name is not its own."""

import pytest

from entities.company import display_name


def test_the_town_tells_two_companies_of_the_same_name_apart():
    """Three separate registrations are all called 'Zakład Utylizacji Odpadów'."""
    assert (
        display_name("ZAKŁAD UTYLIZACJI ODPADÓW", "Gilwa Mała")
        == "ZAKŁAD UTYLIZACJI ODPADÓW (Gilwa Mała)"
    )


def test_a_name_that_already_says_where_it_is_is_left_alone():
    assert (
        display_name("MIEJSKI ZAKŁAD KOMUNIKACJI W OLSZTYNIE", "Olsztyn")
        == "MIEJSKI ZAKŁAD KOMUNIKACJI W OLSZTYNIE"
    )


def test_the_town_is_matched_whatever_the_case():
    assert display_name("Wodociągi Kaliskie", "KALISZ") == "Wodociągi Kaliskie (KALISZ)"
    assert display_name("WODOCIĄGI KALISZ", "Kalisz") == "WODOCIĄGI KALISZ"


@pytest.mark.parametrize("city", [None, ""])
def test_a_company_with_no_recorded_town_keeps_its_name(city):
    assert display_name("ZAKŁAD UTYLIZACJI ODPADÓW", city) == (
        "ZAKŁAD UTYLIZACJI ODPADÓW"
    )


@pytest.mark.parametrize("name", [None, ""])
def test_a_company_with_no_name_gains_nothing(name):
    assert display_name(name, "Kalisz") == name
