"""Tests for the article-person-mentions proof-based confirmation logic."""

import json
from dataclasses import asdict

import pytest

from analysis.article_person_mentions import (
    PersonProfile,
    PersonProfileIndex,
    _confirm_mentions,
    _employed_krs,
    _org_match_terms,
    _parse_verdict,
    _party_match_terms,
    _rejestr_io_id,
    _stem,
)
from entities.article import ArticlePersonMentioned, ProofSignal
from scrapers.article.pipelines.common import ascii_lower


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
    index.add("Bogusław Norbert Kmieć", "p1", kmiec_sanok)
    index.add("Bogusław Kmieć", "p2", kmiec_sedziszow)

    return index


def test_ascii_lower_maps_l():
    assert ascii_lower("spółka Łódź") == "spolka lodz"


def test_teryt_from_edges_splits_woj_powiat_gmina():
    from scrapers.koryta.download import _teryt_from_edges

    data = {
        "stats": {
            "edges": {
                "all": {
                    "targetNodeIds": [
                        "teryt3062",
                        "teryt06",
                        "teryt1465078",
                        "00Oyv1Uum4rBpIH6AlXV",
                    ]
                }
            }
        }
    }
    woj, powiat = _teryt_from_edges(data)
    assert woj == ["06", "14", "30"]
    assert powiat == ["1465", "3062"]


def test_teryt_from_edges_missing_edges():
    from scrapers.koryta.download import _teryt_from_edges

    assert _teryt_from_edges({}) == ([], [])
    assert _teryt_from_edges({"stats": {}}) == ([], [])
    assert _teryt_from_edges({"stats": {"edges": {}}}) == ([], [])


def test_stem_reduces_declined_forms():
    assert _stem("przedsiebiorstwa") == "przedsiebiorstw"
    assert _stem("gospodarki") == "gospodark"
    assert _stem("gospodarka") == "gospodark"


def test_org_match_terms_skip_company_form_words():
    terms = _org_match_terms(
        ascii_lower(
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


def test_party_match_terms_koryta_short_labels():
    assert _party_match_terms("pis") == {"pis", "prawo i sprawiedliwosc"}
    assert _party_match_terms("psl") == {"psl", "polskie stronnictwo ludowe"}
    # PO is an ordinary Polish word, so only the coalition name is searched.
    assert _party_match_terms("po") == {"koalicja obywatelska"}
    assert _party_match_terms("polska 2050") == {"polska 2050", "pl2050"}
    assert _party_match_terms("nowa lewica") == {"nowa lewica"}
    assert _party_match_terms("konfederacja") == {"konfederacja"}


def test_rejestr_io_id_extraction():
    assert _rejestr_io_id("https://rejestr.io/osoby/2786228") == "2786228"
    assert _rejestr_io_id("https://rejestr.io/osoby/2786228/") == "2786228"
    assert _rejestr_io_id(None) == ""
    assert _rejestr_io_id("") == ""


def test_employed_krs_resolves_via_rejestrio():
    person_krs = {"2786228": {"0000084967", "0000123456"}}
    assert _employed_krs(
        {"rejestrIo": "https://rejestr.io/osoby/2786228"}, person_krs
    ) == {"0000084967", "0000123456"}
    assert _employed_krs({"rejestrIo": None}, person_krs) == set()
    assert _employed_krs({"rejestrIo": "https://rejestr.io/osoby/999"}, person_krs) == set()


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
    assert "p1" in confirmed["Bogusław Norbert Kmieć"]
    assert any(
        s.type == "region" and s.value == "powiat"
        for s in confirmed["Bogusław Norbert Kmieć"]["p1"]
    )
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
    assert confirmed["Bogusław Kmieć"]["p2"] == [
        ProofSignal(type="party", value="pis")
    ]


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
    assert any(
        s.type == "organization" for s in confirmed["Bogusław Kmieć"]["p2"]
    )


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


def test_entity_has_structured_proof_and_verdict_fields():
    record = ArticlePersonMentioned(
        url="x",
        person="Jan Kowalski",
        person_id="123",
        domain="y",
        title="t",
        date="2020-01-01",
        tags=[],
        proof=[ProofSignal(type="region", value="powiat"), ProofSignal(type="party", value="pis")],
        verdict="yes",
        justification="kontekst się zgadza",
    )
    assert record.proof[0].type == "region"
    assert record.proof[0].value == "powiat"
    assert record.proof[0].matched is True
    assert record.proof[1].type == "party"
    assert record.verdict == "yes"
    assert json.dumps(asdict(record))  # serializable


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


def test_parse_verdict_unclosed_think_block():
    # A response truncated while still inside <think> has no usable verdict.
    verdict, justification = _parse_verdict(
        "<think>Porównuję kontekst, sprawdzam partie, regiony, organizacje, "
        "analizuję szczegółowo wszystko co można przeanalizować w tym artykule"
    )
    assert verdict == "unknown"
    assert "<think>" not in justification


def test_context_window_centers_on_name():
    from analysis.article_person_mentions import _context_window

    content = "początek " + ("x " * 5000) + " Jan Kowalski " + ("y " * 5000) + " koniec"
    window = _context_window(content, "Jan Kowalski")
    assert "Jan Kowalski" in window
    assert "początek" not in window
    assert "koniec" not in window

    # short content returns whole text
    short = "Krótki artykuł o Janie Kowalskim."
    assert _context_window(short, "Jan Kowalski") == short


def test_parse_verdict_bare_label_fallback():
    verdict, _ = _parse_verdict("Artykuł wyraźnie opisuje posła PiS z Podlasia. TAK")
    assert verdict == "yes"
    verdict, _ = _parse_verdict("Nie mam pewności, czy to ta sama osoba.")
    assert verdict == "unknown"


def test_parse_multi_verdict_picks_candidate():
    from analysis.article_person_mentions import _parse_multi_verdict

    text = (
        "<think>Porównuję kandydatów.</think>\n"
        "Uzasadnienie: Artykuł opisuje posła PiS, pasuje K2.\n"
        "Werdykt: K2\n"
    )
    matched, verdict, just = _parse_multi_verdict(text, 3)
    assert verdict == "yes"
    assert matched == "K2"
    assert "K2" in just or "piS" in just

    matched, verdict, _ = _parse_multi_verdict(
        "Uzasadnienie: Żadna osoba nie pasuje.\nWerdykt: NIE\n", 3
    )
    assert verdict == "no"
    assert matched == ""
