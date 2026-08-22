"""Telling a paid supervisory board from an unpaid one, per dzial2."""

import pytest

from scrapers.krs.organs import (
    ORGAN_KINDS,
    SUPERVISION_KINDS,
    organ_kind,
    supervision_kind,
)


@pytest.mark.parametrize(
    "nazwa",
    [
        "RADA NADZORCZA",
        # The register's own spellings, all of them from the crawl.
        "RADA  NADZORCZA",
        "RADA NADZROCZA",
        "RADA NAZDORCZA",
        "RADA NARDZORCZA",
        "RADA NADORCZA",
        # A digit zero for the letter O.
        "RADA NADZ0RCZA",
        "RADA NADZORCZA SPÓŁKI",
        "RADA NADZORCZA SPÓŁKI TAURON SERWIS SP.Z O.O.",
        "RADA NADZORCZA PEC SOCHACZEW SP Z O.O.",
        "RADA NADZORCZA SPÓŁDZIELNI",
        "rada nadzorcza",
    ],
    ids=lambda nazwa: nazwa,
)
def test_a_rada_nadzorcza_is_recognised_however_it_is_spelled(nazwa):
    assert organ_kind(nazwa) == "rada_nadzorcza"


@pytest.mark.parametrize(
    "nazwa",
    [
        "RADA SPOŁECZNA",
        "RADA  SPOŁECZNA",
        "RADA   SPOŁECZNA",
        "RADA SPOŁECZA",
        "RADA SPOLECZNA",
        "RADA SPOŁECZNA PRZYCHODNI",
        "RADA SPOŁECZNA SZPITALA",
        "RADA SPOŁECZNA - ORGAN OPINIODAWCZY I DORADCZY",
        "RADA SPOŁECZNA PRZY SAMODZIELNYM PUBLICZNYM ZAKŁADZIE "
        "OPIEKI ZDROWOTNEJ W LASKOWEJ",
    ],
    ids=lambda nazwa: nazwa,
)
def test_a_rada_spoleczna_is_recognised_however_it_is_spelled(nazwa):
    """The whole point of the field: these seats are the unpaid ones."""
    assert organ_kind(nazwa) == "rada_spoleczna"


def test_a_suffix_cannot_overrule_the_name():
    """Why only the words next to "RADA" count.

    "SPOŁECZNEJ" is "SPOŁECZNA" declined, two edits away. Matched anywhere in
    the string, a paid board would come out as an unpaid one and drop off a
    page about who pays themselves.
    """
    assert organ_kind("RADA NADZORCZA FUNDACJI EKONOMII SPOŁECZNEJ") == (
        "rada_nadzorcza"
    )


@pytest.mark.parametrize(
    "nazwa",
    [
        "KOMISJA REWIZYJNA",
        "GŁÓWNA KOMISJA REWIZYJNA ZWIĄZKU OSP RP",
        "KOMISJA KONTROLNO-REWIZYJNA",
        "NACZELNA KOMISJA SĄDOWNICZO-REWIZYJNA",
        "KOMSJA REWIZYJNA",
    ],
    ids=lambda nazwa: nazwa,
)
def test_a_komisja_rewizyjna_is_neither(nazwa):
    """Its head word is different every time, so only "rewizyjna" is matched."""
    assert organ_kind(nazwa) == "komisja_rewizyjna"


@pytest.mark.parametrize(
    "nazwa",
    ["RADA FUNDACJI", "RADA IZBY", "RADA", "MINISTER ZDROWIA", "ZGROMADZENIE"],
    ids=lambda nazwa: nazwa,
)
def test_a_body_that_is_neither_is_inny(nazwa):
    """A bare "RADA" included: nothing in it says which kind of rada."""
    assert organ_kind(nazwa) == "inny"


@pytest.mark.parametrize("nazwa", [None, "", "   ", "-", 7, {"nazwa": "RADA"}])
def test_an_organ_the_register_did_not_name_is_nieznany(nazwa):
    """Four organs in the crawl have no ``nazwa``. Unnamed is not "neither"."""
    assert organ_kind(nazwa) == "nieznany"


# ─── the company-level answer ──────────────────────────────


def dzial2(*organy):
    return {"organNadzoru": [{"nazwa": nazwa, "sklad": []} for nazwa in organy]}


def test_a_company_takes_the_kind_of_the_organ_it_registered():
    assert supervision_kind(dzial2("RADA NADZORCZA")) == "rada_nadzorcza"
    assert supervision_kind(dzial2("RADA SPOŁECZNA")) == "rada_spoleczna"


def test_no_organ_registered_is_not_evidence_of_a_paid_one():
    """719 of the 1,192 SPZOZ in the crawl are this case.

    A rada społeczna exists by statute rather than by a wpis, so its absence
    from dzial2 says nothing at all - which is why it gets its own answer
    rather than falling in with the boards that are paid.
    """
    assert supervision_kind({}) == "brak"
    assert supervision_kind({"organNadzoru": []}) == "brak"
    assert supervision_kind({"reprezentacja": {"sklad": []}}) == "brak"
    assert supervision_kind(None) == "brak"


def test_two_organs_collapse_to_the_unpaid_one():
    """No company in the crawl has both, so this is the tie-break for a
    company that one day does: leave the seat out of a page about pay rather
    than count it in wrongly."""
    assert supervision_kind(dzial2("RADA NADZORCZA", "RADA SPOŁECZNA")) == (
        "rada_spoleczna"
    )
    assert supervision_kind(dzial2("KOMISJA REWIZYJNA", "RADA NADZORCZA")) == (
        "rada_nadzorcza"
    )
    assert supervision_kind(dzial2("RADA FUNDACJI", "KOMISJA REWIZYJNA")) == (
        "komisja_rewizyjna"
    )


def test_a_named_organ_beats_an_unnamed_one():
    assert supervision_kind(dzial2(None, "RADA NADZORCZA")) == "rada_nadzorcza"
    assert supervision_kind(dzial2(None)) == "nieznany"


def test_a_single_organ_spelled_as_a_dict_is_still_read():
    """Read as the wrong shape a section finds nothing and says nothing."""
    single = {"organNadzoru": {"nazwa": "RADA NADZORCZA", "sklad": []}}

    assert supervision_kind(single) == "rada_nadzorcza"


def test_the_answer_is_always_one_of_the_declared_values():
    """The site's schema is an enum: an unnormalised name would 400 an ingest.

    Which is the reason the classification ends in "inny" rather than in the
    register's own wording - there is no such thing here as a name it has not
    seen before.
    """
    for nazwa in ["RADA NADZORCZA", "RADA SPOŁECZNA", "COŚ ZUPEŁNIE INNEGO", None]:
        assert organ_kind(nazwa) in ORGAN_KINDS
        assert supervision_kind(dzial2(nazwa)) in SUPERVISION_KINDS
    assert supervision_kind({}) in SUPERVISION_KINDS
