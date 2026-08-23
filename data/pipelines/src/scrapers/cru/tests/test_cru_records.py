"""Building `CruUmowa` records out of dump rows."""

from pathlib import Path

import pytest

from entities.cru import CruStrona, CruUmowa
from scrapers.cru.records import (
    ZRODLO_UMOWA,
    ZRODLO_WYNIK,
    build_index,
    identyfikatory,
    is_osoba_fizyczna,
    iter_records,
    regon9,
    scan_artifact,
    to_bool,
    to_iso_date,
)

A = "aaaaaaaa-0000-4000-8000-000000000001"
B = "bbbbbbbb-0000-4000-8000-000000000002"
C = "cccccccc-0000-4000-8000-000000000003"
D = "dddddddd-0000-4000-8000-000000000004"


@pytest.fixture
def records(sample_dump: Path) -> dict[str, CruUmowa]:
    index = build_index(sample_dump)
    return {r.id_umowy: r for r in iter_records(sample_dump, index)}


def test_every_contract_and_every_detail_less_stub_is_emitted(records) -> None:
    assert set(records) == {A, B, C, D}
    assert records[D].zrodlo == ZRODLO_WYNIK
    assert records[A].zrodlo == ZRODLO_UMOWA


def test_parties_are_ordered_by_id_not_by_dump_order(records) -> None:
    """Party order is semantic -- position 0 is the contracting body.

    The fixture lists contract A's parties as id 20 then id 10, so a reader
    that trusted dump order would report the supplier as the buyer.
    """
    assert [s.kolejnosc for s in records[A].strony] == [0, 1]
    assert records[A].strony[0].rodzaj == "JSFP"
    assert records[A].strony[0].nazwa == "URZĄD MIASTA LEGIONOWO"
    assert records[A].strony[1].nazwa == "FUNDACJA TESTOWA"


def test_zamawiajacy_is_denormalised_from_the_first_party(records) -> None:
    assert records[A].zamawiajacy_nazwa == "URZĄD MIASTA LEGIONOWO"
    assert records[A].zamawiajacy_nip == "5360015621"
    assert records[A].zamawiajacy_regon == "000524832"


def test_leading_zero_regon_stays_a_string(records) -> None:
    """The single most likely silent corruption in this dataset."""
    assert records[A].zamawiajacy_regon == "000524832"
    assert records[A].strony[0].regon == "000524832"


def test_regon9_takes_the_stem_of_a_14_digit_regon(records) -> None:
    supplier = records[A].strony[1]
    assert supplier.regon == "52964557500011"
    assert supplier.regon9 == "529645575"


def test_regon9_leaves_a_9_digit_regon_alone() -> None:
    assert regon9("000524832") == "000524832"
    assert regon9(None) is None


def test_escaped_separators_survive_into_the_record(records) -> None:
    assert records[A].przedmiot_umowy == "Zakup\tsprzętu\ndrugi wiersz A"


def test_czy_konsorcjum_is_tri_state(records) -> None:
    """NULL means "CRU did not say", which is not the same as False."""
    assert records[A].strony[0].czy_konsorcjum is False
    assert records[B].strony[1].czy_konsorcjum is None


def test_to_bool_preserves_null() -> None:
    assert to_bool("t") is True
    assert to_bool("f") is False
    assert to_bool(None) is None


def test_money_keeps_full_precision(records) -> None:
    assert records[B].wartosc_przedmiotu == 1105491461.90


def test_amendment_date_is_converted_from_the_polish_format(records) -> None:
    """`20.07.2026` is the only non-ISO date in the schema."""
    zmiana = records[A].zmiany_umowy[0]
    assert zmiana.data_zmiany == "2026-07-20"
    assert zmiana.data_zmiany_raw is None
    assert zmiana.rodzaj_zmiany == "Wygaśniecie umowy"


def test_an_unparseable_amendment_date_keeps_the_amendment(records) -> None:
    """Never drop a change just because its date is malformed."""
    zmiana = records[B].zmiany_umowy[0]
    assert zmiana.data_zmiany is None
    assert zmiana.data_zmiany_raw == "2026/07/20"
    assert zmiana.komentarz == "bez daty"


def test_to_iso_date_round_trip() -> None:
    assert to_iso_date("01.02.2026") == ("2026-02-01", None)
    assert to_iso_date("nonsense") == (None, "nonsense")
    assert to_iso_date(None) == (None, None)


def test_redaction_object_is_camel_case_mapped(records) -> None:
    niejawnosc = records[B].niejawnosc_wartosci_przedmiotu
    assert niejawnosc is not None
    assert niejawnosc.organ_lub_osoba_wylaczajaca == "Dyrektor"
    assert niejawnosc.zakres == "Wartość umowy"


def test_a_party_redaction_is_read_too(records) -> None:
    osoba = records[B].strony[1]
    assert osoba.niejawnosc is not None
    assert osoba.niejawnosc.podstawa == "INNA"


def test_named_individuals_are_flagged(records) -> None:
    """One predicate for the rows that are personal data."""
    assert records[B].ma_osobe_fizyczna is True
    assert records[A].ma_osobe_fizyczna is False


def test_is_osoba_fizyczna_detects_both_shapes() -> None:
    assert is_osoba_fizyczna(CruStrona(imie="Jan", nazwisko="Kowalski"))
    assert is_osoba_fizyczna(CruStrona(rodzaj="Osoba fizyczna"))
    assert not is_osoba_fizyczna(CruStrona(rodzaj="JSFP", nazwa="GMINA"))


def test_identyfikatory_are_deduplicated_and_sorted(records) -> None:
    """Every NIP and REGON on the contract, including both REGON forms.

    Sorted as strings, so a leading zero sorts first and the 9-digit stem
    sorts next to the 14-digit REGON it came from.
    """
    assert records[A].identyfikatory == [
        "000524832",  # buyer REGON
        "529645575",  # supplier REGON, 9-digit stem
        "52964557500011",  # supplier REGON as published
        "5360015621",  # buyer NIP
        "5361982599",  # supplier NIP
    ]


def test_identyfikatory_skips_missing_values() -> None:
    assert identyfikatory([CruStrona(nip=None, regon=None)]) == []


def test_a_contract_with_no_parties_is_still_a_contract(records) -> None:
    """`strony == []` on a `zrodlo="umowa"` record means CRU published none."""
    assert records[C].strony == []
    assert records[C].zrodlo == ZRODLO_UMOWA
    assert records[C].liczba_stron == 0
    assert records[C].zamawiajacy_nazwa is None


def test_stub_carries_what_the_search_index_knew(records) -> None:
    """Details were never served, but the spend still counts."""
    stub = records[D]
    assert stub.strony == []
    assert stub.zamawiajacy_nazwa == "GMINA WILKÓW"
    assert stub.zamawiajacy_regon == "531412770"
    assert stub.wartosc_przedmiotu == 149.0
    assert stub.detale_blad is not None
    assert stub.detale_niedostepne_od == "2026-08-04 14:40:28.911388+00"


def test_import_timestamp_is_kept_exactly_as_postgres_wrote_it(records) -> None:
    """A space, not a `T`. Reformatting it would be inventing a value."""
    assert records[A].zaimportowano == "2026-07-24 15:16:35.886057+00"


def test_the_index_is_fully_drained(sample_dump: Path) -> None:
    """Every party must belong to a contract that the dump also carries."""
    index = build_index(sample_dump)
    list(iter_records(sample_dump, index))
    assert index.lines == {}


def test_scan_artifact_describes_the_file(sample_dump: Path) -> None:
    manifest = scan_artifact(
        sample_dump,
        artifact_name="rejestrumow_dump",
        artifact_filename="rejestrumow_dump.sql.gz",
        sha256="deadbeef",
        size=123,
        source="pg_dump",
        dsn="postgresql://user@host/db",
        dumped_utc="2026-08-12T00:00:00+00:00",
        server_version="15.10",
        pg_dump_version="16.14",
    )
    assert manifest.rows_umowa == 3
    assert manifest.rows_strona_umowy == 4
    assert manifest.rows_wynik_wyszukiwania == 4
    assert manifest.rows_detale_niedostepne == 1
    assert manifest.strona_umowy_max_id == 20
    assert manifest.max_data_publikacji == "2026-07-24"
