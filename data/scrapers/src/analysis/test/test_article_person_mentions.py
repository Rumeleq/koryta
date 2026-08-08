"""Tests for the article-person-mentions proof-based confirmation logic."""

import json

import pytest

from analysis.article_person_mentions import (
    PersonProfile,
    PersonProfileIndex,
    _ascii_lower,
    _confirm_mentions,
    _org_match_terms,
    _parse_verdict,
    _party_match_terms,
    _stem,
)
from entities.article import ArticlePeopleMentioned


@pytest.fixture
def profiles_and_map():
    """Small synthetic profile index + region map for unit tests."""
    kmiec_sanok = PersonProfile()
    kmiec_sanok.woj = {"18"}
    kmiec_sanok.powiat = {"1817"}
    kmiec_sanok.parties = {"psl"}
    kmiec_sanok.orgs = {"regionaln", "izb"}

    kmiec_sedziszow = PersonProfile()
    kmiec_sedziszow.woj = {"18"}
    kmiec_sedziszow.powiat = {"1815"}
    kmiec_sedziszow.parties = {"pis"}
    kmiec_sedziszow.orgs = {"gospodark", "komunaln"}

    index = PersonProfileIndex()
    index.add("Bogusław Norbert Kmieć", kmiec_sanok)
    index.add("Bogusław Kmieć", kmiec_sedziszow)

    return index


def test_ascii_lower_maps_l():
    assert _ascii_lower("spółka Łódź") == "spolka lodz"


def test_stem_reduces_declined_forms():
    assert _stem("przedsiebiorstwa") == "przedsiebiorstw"
    assert _stem("gospodarki") == "gospodark"
    assert _stem("gospodarka") == "gospodark"


def test_org_match_terms_skip_company_form_words():
    terms = _org_match_terms(
        _ascii_lower(
            "Przedsiębiorstwo Gospodarki Komunalnej i Mieszkaniowej Sp. z o.o."
        )
    )
    assert "gospodark" in terms
    assert "komunaln" in terms
    assert "spolka" not in terms
    assert "spolk" not in terms


def test_party_match_terms_include_short_and_full():
    terms = _party_match_terms("komitet wyborczy prawo i sprawiedliwosc")
    assert "pis" in terms
    assert "prawo i sprawiedliwosc" in terms


class FakeDomainMap:
    def __init__(self, powiat, woj):
        self._powiat = powiat
        self._woj = woj

    def powiat_codes(self, domain):
        return self._powiat

    def woj_codes(self, domain):
        return self._woj


def test_region_powiat_confirms(profiles_and_map):
    domain_map = FakeDomainMap({"1817"}, {"18"})
    confirmed = _confirm_mentions(
        {"Bogusław Kmieć", "Bogusław Norbert Kmieć"},
        "Burmistrz Sanoka Bogusław Kmieć nie dostał wotum zaufania.",
        "esanok.pl",
        profiles_and_map,
        domain_map,
    )
    assert "Bogusław Norbert Kmieć" in confirmed
    assert "region:powiat" in confirmed["Bogusław Norbert Kmieć"]
    assert "Bogusław Kmieć" not in confirmed


def test_region_woj_fallback_does_not_confirm_with_powiat(profiles_and_map):
    # Same woj (18) but wrong powiat -> woj fallback must NOT confirm
    domain_map = FakeDomainMap(set(), {"18"})
    confirmed = _confirm_mentions(
        {"Bogusław Kmieć"},
        "Bogusław Kmieć w jakimś artykule z województwa podkarpackiego.",
        "rrs24.net",
        profiles_and_map,
        domain_map,
    )
    assert confirmed == {}


def test_party_abbreviation_confirms(profiles_and_map):
    domain_map = FakeDomainMap(set(), set())
    confirmed = _confirm_mentions(
        {"Bogusław Kmieć"},
        "Poseł PiS Bogusław Kmieć skomentował sprawę.",
        "natemat.pl",
        profiles_and_map,
        domain_map,
    )
    assert confirmed["Bogusław Kmieć"] == ["party:pis"]


def test_party_not_confirmed_by_partial_word(profiles_and_map):
    domain_map = FakeDomainMap(set(), set())
    confirmed = _confirm_mentions(
        {"Bogusław Kmieć"},
        "Bogusław Kmieć spisał oświadczenie.",
        "natemat.pl",
        profiles_and_map,
        domain_map,
    )
    assert confirmed == {}


def test_organization_stems_confirm(profiles_and_map):
    domain_map = FakeDomainMap(set(), set())
    confirmed = _confirm_mentions(
        {"Bogusław Kmieć"},
        "Bogusław Kmieć z Przedsiębiorstwa Gospodarki Komunalnej i Mieszkaniowej.",
        "natemat.pl",
        profiles_and_map,
        domain_map,
    )
    assert "Bogusław Kmieć" in confirmed
    assert any(p.startswith("organization:") for p in confirmed["Bogusław Kmieć"])


def test_no_proof_drops(profiles_and_map):
    domain_map = FakeDomainMap(set(), set())
    confirmed = _confirm_mentions(
        {"Bogusław Kmieć"},
        "Bogusław Kmieć był na spotkaniu sąsiedzkim.",
        "natemat.pl",
        profiles_and_map,
        domain_map,
    )
    assert confirmed == {}


def test_entity_has_proof_field():
    record = ArticlePeopleMentioned(
        url="x",
        domain="y",
        title="t",
        date="2020-01-01",
        tags=[],
        people_mentioned=["Jan Kowalski"],
        proof={"Jan Kowalski": ["region:powiat"]},
        judge={
            "Jan Kowalski": {"verdict": "yes", "justification": "kontekst się zgadza"}
        },
    )
    assert record.proof["Jan Kowalski"] == ["region:powiat"]
    assert record.judge["Jan Kowalski"]["verdict"] == "yes"
    assert json.dumps({"proof": record.proof, "judge": record.judge})  # serializable


def test_parse_verdict_justification_then_label():
    text = (
        "<think>Sprawdzam kontekst.</think>\n"
        "Uzasadnienie: Artykuł opisuje Marka Sowę jako krytyka rządzących, "
        "a w danych ma partie PiS - to rozbieżność.\n"
        "Werdykt: NIE\n"
    )
    verdict, justification = _parse_verdict(text)
    assert verdict == "no"
    assert "krytyka rządzących" in justification


def test_parse_verdict_bare_label_fallback():
    verdict, _ = _parse_verdict("Artykuł wyraźnie opisuje posła PiS z Podlasia. TAK")
    assert verdict == "yes"
    verdict, _ = _parse_verdict("Nie mam pewności, czy to ta sama osoba.")
    assert verdict == "unknown"
