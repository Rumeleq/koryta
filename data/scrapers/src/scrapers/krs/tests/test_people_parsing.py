"""What api-krs's OdpisAktualny JSON says about who runs a company."""

from scrapers.krs.people_parsing import extract_censored_people


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
    return {(p[0], p[1]) for p in people}


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

    assert names(people) == {("P********", "M******")}
    assert next(iter(people))[-1] == "prokurent: SAMOISTNA"


def test_the_other_plain_lists_still_come_through():
    data = odpis(
        dzial2={
            "pelnomocnicy": [masked("J****", "M*****")],
            "osobyReprezentujacePZ": [masked("K******", "P****")],
        }
    )

    assert {p[-1] for p in extract_censored_people(data)} == {
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

    assert {p[-1] for p in extract_censored_people(data)} == {"reprezentacja: PREZES"}


def test_a_partner_that_is_a_company_is_not_a_person():
    data = odpis(
        dzial1={
            "wspolnicySpzoo": [
                {"nazwa": "GMINA MIASTO RACIĄŻ", "krs": {"krs": "0000000000"}}
            ]
        }
    )

    assert extract_censored_people(data) == set()
