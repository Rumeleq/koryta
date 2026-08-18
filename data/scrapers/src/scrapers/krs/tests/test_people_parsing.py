"""What api-krs's OdpisAktualny JSON says about who runs a company."""

from scrapers.krs.people_parsing import CensoredPerson, extract_censored_people


def masked(surname, given):
    return {
        "nazwisko": {"nazwiskoICzlon": surname},
        "imiona": {"imie": given},
        "identyfikator": {"pesel": "7**********"},
    }


def odpis(dzial1=None, dzial2=None):
    return {
        "odpis": {
            "naglowekA": {"numerKRS": "0000000110"},
            "dane": {"dzial1": dzial1 or {}, "dzial2": dzial2 or {}},
        }
    }


def names(people):
    return {(p.surname, p.given) for p in people}


def test_proxies_are_a_plain_list_and_still_get_read():
    """The bug this guards: prokurenci is a list, not an organ with a sklad.

    Read as an organ it always found nobody, so a company whose only change
    was to its proxies never looked like it had changed at all - and nothing
    re-queried it. 8,020 proxy appointments in the crawl went unseen.
    """
    data = odpis(
        dzial2={
            "prokurenci": [
                {**masked("P********", "M******"), "rodzajProkury": "SAMOISTNA"}
            ]
        }
    )

    people = extract_censored_people(data)

    assert names(people) == {(("P********",), "M******")}
    assert next(iter(people)).role == "prokurent: SAMOISTNA"


def test_the_other_plain_lists_still_come_through():
    data = odpis(
        dzial2={
            "pelnomocnicy": [masked("J****", "M*****")],
            "osobyReprezentujacePZ": [masked("K******", "P****")],
        }
    )

    assert {p.role for p in extract_censored_people(data)} == {
        "pelnomocnik",
        "osoba_pz",
    }


def test_an_organ_with_a_sklad_is_still_read_as_one():
    data = odpis(
        dzial2={
            "reprezentacja": {
                "nazwaOrganu": "ZARZĄD",
                "sklad": [{**masked("F*****", "M******"), "funkcjaWOrganie": "PREZES"}],
            }
        }
    )

    assert {p.role for p in extract_censored_people(data)} == {"reprezentacja: PREZES"}


def test_a_partner_that_is_a_company_is_not_a_person():
    data = odpis(
        dzial1={
            "wspolnicySpzoo": [
                {"nazwa": "GMINA MIASTO RACIĄŻ", "krs": {"krs": "0000000000"}}
            ]
        }
    )

    assert extract_censored_people(data) == set()


# ─── the whole of a name ───────────────────────────────────


def test_a_second_surname_component_is_kept():
    """ "Kałuża Swoboda" is two fields; folding them loses which Kałuża it is."""
    data = odpis(
        dzial2={
            "organNadzoru": [
                {
                    "nazwa": "RADA NADZORCZA",
                    "sklad": [
                        {
                            "nazwisko": {
                                "nazwiskoICzlon": "K*****",
                                "nazwiskoIICzlon": "S******",
                            },
                            "imiona": {"imie": "M*********"},
                            "identyfikator": {"pesel": "7**********"},
                        }
                    ],
                }
            ]
        }
    )

    person = next(iter(extract_censored_people(data)))

    assert person.surname == ("K*****", "S******")


def test_two_people_differing_only_in_the_second_component_are_two_people():
    def member(second):
        return {
            "nazwisko": {"nazwiskoICzlon": "K*****", "nazwiskoIICzlon": second},
            "imiona": {"imie": "M*********"},
            "identyfikator": {},
        }

    both = extract_censored_people(
        odpis(
            dzial2={"organNadzoru": [{"sklad": [member("S******"), member("N****")]}]}
        )
    )

    assert len(both) == 2


def test_a_birth_date_tells_two_masked_namesakes_apart():
    """347 people in the crawl have no PESEL and only this to identify them."""

    def with_birth(day):
        return {
            "nazwisko": {"nazwiskoICzlon": "M*******"},
            "imiona": {"imie": "S******"},
            "identyfikator": {"dataUrodzenia": day},
        }

    one = extract_censored_people(
        odpis(dzial2={"organNadzoru": [{"sklad": [with_birth("22.07.1985")]}]})
    )
    other = extract_censored_people(
        odpis(dzial2={"organNadzoru": [{"sklad": [with_birth("05.11.1967")]}]})
    )

    assert one != other


def test_a_compound_surname_survives_the_pipeline_column():
    person = CensoredPerson(("K*****", "S******"), "M*********", "", "", "", "nadzor: ")

    assert CensoredPerson.from_row(person.as_row()) == person
