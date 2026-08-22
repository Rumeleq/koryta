"""What api-krs's OdpisAktualny JSON says about who runs a company."""

from scrapers.krs.people_parsing import (
    PERSON_PATHS,
    CensoredPerson,
    extract_censored_people,
    is_odpis,
    unread_person_paths,
)

NOT_FOUND = {
    "type": "https://tools.ietf.org/html/rfc7231#section-6.5.4",
    "title": "Not Found",
    "status": 404,
}


def masked(surname_parts, given, second_given=""):
    nazwisko = {}
    for key, value in zip(("nazwiskoICzlon", "nazwiskoIICzlon"), surname_parts):
        nazwisko[key] = value
    imiona = {"imie": given}
    if second_given:
        imiona["imieDrugie"] = second_given
    return {
        "nazwisko": nazwisko,
        "imiona": imiona,
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


def test_a_second_surname_component_is_kept():
    """ "Kałuża Swoboda" is two fields; folding them loses which Kałuża it is."""
    data = odpis(
        dzial2={
            "organNadzoru": [
                {
                    "nazwa": "RADA NADZORCZA",
                    "sklad": [masked(["K*****", "S******"], "M*********")],
                }
            ]
        }
    )

    assert names(extract_censored_people(data)) == {
        (("K*****", "S******"), "M*********")
    }


def test_proxies_are_a_plain_list_and_still_get_read():
    """The bug this guards: prokurenci is a list, not an organ with a sklad.

    Read as an organ it always found nobody, so a company whose only change
    was to its proxies never looked like it had changed at all.
    """
    data = odpis(
        dzial2={
            "prokurenci": [
                {**masked(["P********"], "M******"), "rodzajProkury": "SAMOISTNA"}
            ]
        }
    )

    people = extract_censored_people(data)

    assert names(people) == {(("P********",), "M******")}
    assert next(iter(people)).role == "prokurent: SAMOISTNA"


def test_board_supervision_and_partners_all_come_through():
    data = odpis(
        dzial1={"wspolnicySpzoo": [masked(["W******"], "J***")]},
        dzial2={
            "reprezentacja": {
                "nazwaOrganu": "ZARZĄD",
                "sklad": [
                    {
                        **masked(["F*****"], "M******", "A***"),
                        "funkcjaWOrganie": "PREZES ZARZĄDU",
                    }
                ],
            },
            "organNadzoru": [{"sklad": [masked(["L*******"], "W*******")]}],
            "pelnomocnicy": [masked(["J****"], "M*****")],
        },
    )

    assert {p.role.split(":")[0] for p in extract_censored_people(data)} == {
        "wspolnik",
        "reprezentacja",
        "nadzor",
        "pelnomocnik",
    }


# ─── which supervisory organ a seat is on ──────────────────
#
# A rada społeczna seat is unpaid and a rada nadzorcza one is not, and the
# register writes that on the organ rather than on its members. Flattening the
# organs into their people threw it away, so every supervisory member of every
# company read alike.


def organ(nazwa, *surnames, funkcja=None):
    sklad = []
    for surname in surnames:
        person = masked([surname], "J***")
        if funkcja:
            person["funkcjaWOrganie"] = funkcja
        sklad.append(person)
    return {"nazwa": nazwa, "sklad": sklad}


def roles(data):
    return {p.role for p in extract_censored_people(data)}


def test_a_supervisory_seat_says_which_organ_it_is_on():
    paid = odpis(dzial2={"organNadzoru": [organ("RADA NADZORCZA", "N******")]})
    unpaid = odpis(dzial2={"organNadzoru": [organ("RADA SPOŁECZNA", "S******")]})

    assert roles(paid) == {"nadzor: rada_nadzorcza"}
    assert roles(unpaid) == {"nadzor: rada_spoleczna"}


def test_two_organs_do_not_lend_each_other_their_members():
    """What the flattening lost: which of the organs a person sits on."""
    data = odpis(
        dzial2={
            "organNadzoru": [
                organ("RADA NADZORCZA", "N******"),
                organ("KOMISJA REWIZYJNA", "R******"),
            ]
        }
    )

    assert {(p.surname[0], p.role) for p in extract_censored_people(data)} == {
        ("N******", "nadzor: rada_nadzorcza"),
        ("R******", "nadzor: komisja_rewizyjna"),
    }


def test_an_organ_the_register_did_not_name_says_so():
    """Not the same as a company with no supervisory organ registered."""
    data = odpis(dzial2={"organNadzoru": [organ(None, "N******")]})

    assert roles(data) == {"nadzor: nieznany"}


def test_the_organ_comes_before_whatever_the_person_adds():
    """``funkcjaWOrganie`` is empty on all 52,146 supervisory members in the
    crawl, but it is the person's function *within* the organ - a detail - and
    the organ is what decides whether the seat is paid. So the organ leads and
    the register filling the field in later cannot displace it."""
    data = odpis(
        dzial2={
            "organNadzoru": [
                organ("RADA NADZORCZA", "N******", funkcja="PRZEWODNICZĄCY")
            ]
        }
    )

    assert roles(data) == {"nadzor: rada_nadzorcza, PRZEWODNICZĄCY"}


def test_the_organ_kind_does_not_change_what_the_role_is():
    """`names.comparable` and the coverage invariant read the part before the
    colon, so the detail can grow without either noticing."""
    data = odpis(dzial2={"organNadzoru": [organ("RADA SPOŁECZNA", "S******")]})

    assert {p.role.split(":")[0] for p in extract_censored_people(data)} == {"nadzor"}


def test_an_organ_around_a_board_is_not_read_as_a_supervisory_one():
    """Only organNadzoru names its organ; reprezentacja's nazwaOrganu is not
    the same field and dzial2.reprezentacja carries no ``nazwa`` at all."""
    data = odpis(
        dzial2={
            "reprezentacja": {
                "nazwaOrganu": "ZARZĄD",
                "sklad": [
                    {
                        **masked(["F*****"], "M******"),
                        "funkcjaWOrganie": "PREZES ZARZĄDU",
                    }
                ],
            }
        }
    )

    assert roles(data) == {"reprezentacja: PREZES ZARZĄDU"}


def test_a_partner_that_is_a_company_is_not_a_person():
    data = odpis(
        dzial1={
            "wspolnicySpzoo": [
                {
                    "nazwa": "GMINA MIASTO RACIĄŻ",
                    "identyfikator": {},
                    "krs": {"krs": "0000000000"},
                }
            ]
        }
    )

    assert extract_censored_people(data) == set()


def test_a_query_against_the_wrong_register_names_nobody():
    """api-krs answers with a 404 body, which is valid JSON and not an odpis."""
    assert not is_odpis(NOT_FOUND)
    assert extract_censored_people(NOT_FOUND) == set()


# ─── every place the register keeps a person ───────────────
#
# The prokurenci bug was one section read as the wrong shape. These guard the
# other fifteen, and the walker that notices a sixteenth.


def liquidation(surname, given):
    return {
        "odpis": {
            "naglowekA": {"numerKRS": "0000000110"},
            "dane": {
                "dzial6": {
                    "likwidacja": [
                        {"likwidatorzy": [masked([surname], given)]},
                    ]
                }
            },
        }
    }


def test_a_liquidator_is_a_person_the_register_appointed():
    """Nested one level deeper: a list of proceedings, each with its people."""
    people = extract_censored_people(liquidation("K*******", "W*******"))

    assert names(people) == {(("K*******",), "W*******")}
    assert next(iter(people)).role == "likwidator"


def test_the_dzial1_partner_lists_are_all_read():
    data = odpis(
        dzial1={
            "wspolnicyPartnerzy": [masked(["P******"], "A******")],
            "komitetZalozycielski": [masked(["K********"], "M*****")],
            "jedynyAkcjonariusz": [masked(["J*****"], "T*****")],
        }
    )

    assert {p.role for p in extract_censored_people(data)} == {
        "wspolnik_partner",
        "komitet_zalozycielski",
        "jedyny_akcjonariusz",
    }


def test_a_curator_lives_in_dzial5():
    data = odpis()
    data["odpis"]["dane"]["dzial5"] = {"kurator": [masked(["K*****"], "J****")]}

    assert {p.role for p in extract_censored_people(data)} == {"kurator"}


def test_every_role_in_the_table_has_a_distinct_name():
    roles = [path.role for path in PERSON_PATHS]

    assert len(set(roles)) == len(roles) - 1, (
        "only the two restructuring sections share a role name"
    )


# ─── unread_person_paths ───────────────────────────────────


def test_a_response_we_fully_understand_reports_nothing_unread():
    assert unread_person_paths(liquidation("K*******", "W*******")) == set()


def test_a_section_the_register_adds_later_is_reported():
    """What makes a new dzial a failing invariant rather than silence."""
    data = odpis()
    data["odpis"]["dane"]["dzial2"] = {"radaInwestorow": [masked(["N*****"], "A****")]}

    assert unread_person_paths(data) == {"dzial2.radaInwestorow[]"}


def test_a_partner_company_is_not_mistaken_for_an_unread_person():
    data = odpis(
        dzial1={"wspolnicySpzoo": [{"nazwa": "GMINA", "krs": {"krs": "0000000001"}}]}
    )

    assert unread_person_paths(data) == set()


def test_nothing_is_unread_in_something_that_is_not_an_odpis():
    assert unread_person_paths(NOT_FOUND) == set()


# ─── round trip through the pipeline column ────────────────


def test_a_compound_surname_survives_the_pipeline_column():
    person = next(
        iter(
            extract_censored_people(
                odpis(
                    dzial2={
                        "organNadzoru": [
                            {"sklad": [masked(["K*****", "S******"], "M*********")]}
                        ]
                    }
                )
            )
        )
    )

    assert CensoredPerson.from_row(person.as_row()) == person


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


# ─── is_odpis ──────────────────────────────────────────────


def test_an_odpis_with_no_body_is_not_a_snapshot():
    """It would otherwise read as a company everybody just resigned from."""
    assert not is_odpis({"odpis": {}})
    assert not is_odpis({"odpis": {"naglowekA": {"numerKRS": "110"}, "dane": {}}})


def test_a_real_odpis_passes():
    assert is_odpis(odpis(dzial1={"wspolnicySpzoo": []}))
