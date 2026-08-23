"""Turning dump rows into `CruUmowa` records.

Pure functions over the parsed COPY rows -- no IO beyond reading the artifact,
so every rule here is testable against a fixture with no database and no
network.

The dump emits `umowa`, then `strona_umowy`, then `wynik_wyszukiwania`, so a
contract's parties arrive *after* the contract and one forward pass cannot
assemble anything. Hence two passes: the first indexes parties by contract
(holding them as raw text, which is several times cheaper than parsed dicts),
the second streams contracts and drains the index as it goes.
"""

import json
import re
import typing
from pathlib import Path

from entities.cru import CruDumpManifest, CruNiejawnosc, CruStrona, CruUmowa, CruZmiana
from scrapers.cru.copy_reader import iter_raw_lines, iter_rows, split_row

#: CRU writes amendment dates as `20.07.2026` while every other date in the
#: schema is ISO. The only format inconsistency in the source, and the easiest
#: one to convert wrongly -- `07.20.2026` would parse as a US date elsewhere.
_DDMMYYYY = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})$")

_UMOWA = "umowa"
_STRONA = "strona_umowy"
_WYNIK = "wynik_wyszukiwania"

#: `CruUmowa.zrodlo`: which table a record was built from, and so how much of
#: it is populated. Not the table names -- these are part of the output's
#: contract with its readers, and should not move if a table is renamed.
ZRODLO_UMOWA = "umowa"
ZRODLO_WYNIK = "wynik"


def to_bool(value: str | None) -> bool | None:
    """Postgres `t`/`f`, with NULL preserved rather than flattened to False.

    `czy_konsorcjum` is NULL on 147894 party rows and False on the rest; the
    difference is "CRU did not say" against "CRU said no".
    """
    if value is None:
        return None
    return value == "t"


def to_float(value: str | None) -> float | None:
    """A `numeric(18,2)` money column.

    float64 represents every value in the register exactly -- the largest is
    ~1.1e9, far inside the 2^53 integer-grade range once scaled by 100 -- and
    Decimal would not survive the JSON round trip anyway.
    """
    if value is None:
        return None
    return float(value)


def to_json(value: str | None) -> typing.Any:
    if value is None:
        return None
    return json.loads(value)


def regon9(regon: str | None) -> str | None:
    """The 9-digit stem that identifies the legal entity.

    A 14-digit REGON identifies a local unit; its first 9 digits are the parent
    entity, which is what other registers key on.
    """
    if regon is None:
        return None
    return regon[:9] if len(regon) == 14 else regon


def to_iso_date(value: str | None) -> tuple[str | None, str | None]:
    """`DD.MM.YYYY` to ISO, returning `(iso, unparsed_original)`.

    Never raises and never drops the value: an amendment with a malformed date
    is still an amendment, so a failure keeps the original text in the second
    slot for whoever looks later.
    """
    if value is None:
        return None, None
    match = _DDMMYYYY.match(value.strip())
    if match is None:
        return None, value
    day, month, year = match.groups()
    return f"{year}-{month}-{day}", None


def build_niejawnosc(raw: typing.Any) -> CruNiejawnosc | None:
    """The redaction object CRU substitutes for a withheld value.

    Always an object in the 3451 non-null rows across all three columns, never
    a list. Anything else is a schema change we should hear about rather than
    quietly land as an unusable blob.
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError(
            f"niejawnosc was {type(raw).__name__}, expected object: {raw!r}"
        )
    return CruNiejawnosc(
        zakres=raw.get("zakres"),
        podstawa=raw.get("podstawa"),
        komentarz=raw.get("komentarz"),
        organ_lub_osoba_wylaczajaca=raw.get("organLubOsobaWylaczajaca"),
    )


def build_zmiany(raw: typing.Any) -> list[CruZmiana]:
    if not raw:
        return []
    zmiany = []
    for item in raw:
        iso, unparsed = to_iso_date(item.get("dataZmiany"))
        zmiany.append(
            CruZmiana(
                rodzaj_zmiany=item.get("rodzajZmiany"),
                data_zmiany=iso,
                data_zmiany_raw=unparsed,
                komentarz=item.get("komentarz"),
            )
        )
    return zmiany


def build_strona(row: dict[str, str | None], kolejnosc: int) -> CruStrona:
    return CruStrona(
        kolejnosc=kolejnosc,
        rodzaj=row.get("rodzaj"),
        nazwa=row.get("nazwa"),
        imie=row.get("imie"),
        nazwisko=row.get("nazwisko"),
        nip=row.get("nip"),
        regon=row.get("regon"),
        regon9=regon9(row.get("regon")),
        kraj=row.get("kraj"),
        czy_konsorcjum=to_bool(row.get("czy_konsorcjum")),
        ulica=row.get("ulica"),
        numer_nieruchomosci=row.get("numer_nieruchomosci"),
        numer_lokalu=row.get("numer_lokalu"),
        kod_pocztowy=row.get("kod_pocztowy"),
        miejscowosc=row.get("miejscowosc"),
        gmina_miasto_dzielnica=row.get("gmina_miasto_dzielnica"),
        powiat=row.get("powiat"),
        wojewodztwo=row.get("wojewodztwo"),
        niejawnosc=build_niejawnosc(to_json(row.get("niejawnosc_strony"))),
    )


def is_osoba_fizyczna(strona: CruStrona) -> bool:
    """A named private individual rather than an organisation.

    CRU gives these a personal name and no identifiers at all. They are
    personal data, they cannot be resolved against a company register, and
    matching them by name alone would be reckless -- so they get flagged once
    here and can be filtered on downstream.
    """
    if strona.imie or strona.nazwisko:
        return True
    return bool(strona.rodzaj and "fizyczn" in strona.rodzaj.lower())


def identyfikatory(strony: typing.Iterable[CruStrona]) -> list[str]:
    """Every distinct NIP/REGON on the contract, sorted for a stable output."""
    found = set()
    for strona in strony:
        for value in (strona.nip, strona.regon, strona.regon9):
            if value:
                found.add(value)
    return sorted(found)


def build_umowa(row: dict[str, str | None], strony: list[CruStrona]) -> CruUmowa:
    """One contract row plus its already-ordered parties."""
    zamawiajacy = strony[0] if strony else None
    id_umowy = row["id_umowy"]
    assert id_umowy is not None, "umowa.id_umowy is NOT NULL in the schema"
    return CruUmowa(
        id_umowy=id_umowy,
        zrodlo=ZRODLO_UMOWA,
        status_umowy=row.get("status_umowy"),
        numer_umowy=row.get("numer_umowy"),
        brak_numeru_umowy=to_bool(row.get("brak_numeru_umowy")),
        data_zawarcia_umowy=row.get("data_zawarcia_umowy"),
        data_zakonczenia_umowy=row.get("data_zakonczenia_umowy"),
        umowa_na_czas_nieoznaczony=to_bool(row.get("umowa_na_czas_nieoznaczony")),
        okres=row.get("okres"),
        przedmiot_umowy=row.get("przedmiot_umowy"),
        wartosc_przedmiotu=to_float(row.get("wartosc_przedmiotu")),
        opis_wartosci_przedmiotu=row.get("opis_wartosci_przedmiotu"),
        finansowana_ze_srodkow=to_bool(row.get("finansowana_ze_srodkow")),
        niejawnosc_przedmiotu=build_niejawnosc(
            to_json(row.get("niejawnosc_przedmiotu"))
        ),
        niejawnosc_wartosci_przedmiotu=build_niejawnosc(
            to_json(row.get("niejawnosc_wartosci_przedmiotu"))
        ),
        zmiany_umowy=build_zmiany(to_json(row.get("zmiany_umowy"))),
        zamawiajacy_nazwa=zamawiajacy.nazwa if zamawiajacy else None,
        zamawiajacy_nip=zamawiajacy.nip if zamawiajacy else None,
        zamawiajacy_regon=zamawiajacy.regon if zamawiajacy else None,
        zamawiajacy_regon9=zamawiajacy.regon9 if zamawiajacy else None,
        liczba_stron=len(strony),
        ma_osobe_fizyczna=any(is_osoba_fizyczna(s) for s in strony),
        identyfikatory=identyfikatory(strony),
        strony=strony,
        data_publikacji=row.get("data_publikacji"),
        data_modyfikacji=row.get("data_modyfikacji"),
        zaimportowano=row.get("zaimportowano"),
    )


def build_stub(row: dict[str, str | None]) -> CruUmowa:
    """A contract CRU indexes but will not serve details for.

    The search index still carries who spent how much on what, so dropping
    these would understate total spend. They are marked `zrodlo="wynik"` and
    have no parties, which makes `strony == []` unambiguous: not "a contract
    with no parties" but "we were never shown them".
    """
    id_umowy = row["id_umowy"]
    assert id_umowy is not None, "wynik_wyszukiwania.id_umowy is NOT NULL"
    regon = row.get("regon")
    return CruUmowa(
        id_umowy=id_umowy,
        zrodlo=ZRODLO_WYNIK,
        status_umowy=row.get("status_umowy"),
        data_zawarcia_umowy=row.get("data_zawarcia_umowy"),
        data_zakonczenia_umowy=row.get("data_zakonczenia_umowy"),
        przedmiot_umowy=row.get("przedmiot_umowy"),
        wartosc_przedmiotu=to_float(row.get("wartosc_przedmiotu_umowy")),
        zamawiajacy_nazwa=row.get("nazwa"),
        zamawiajacy_regon=regon,
        zamawiajacy_regon9=regon9(regon),
        identyfikatory=identyfikatory([CruStrona(regon=regon, regon9=regon9(regon))]),
        zaimportowano=row.get("zaimportowano"),
        detale_blad=row.get("detale_blad"),
        detale_niedostepne_od=row.get("detale_niedostepne_od"),
    )


class PartyIndex(typing.NamedTuple):
    """Pass one's output: parties still held as raw dump text."""

    columns: list[str]
    #: contract id -> its party lines, in dump order
    lines: dict[str, list[str]]
    #: the `wynik_wyszukiwania` rows whose details CRU never served
    stubs: list[dict[str, str | None]]


def build_index(path: Path) -> PartyIndex:
    """Pass one: index every party by contract, and collect the detail-less rows."""
    columns: list[str] = []
    lines: dict[str, list[str]] = {}
    stubs: list[dict[str, str | None]] = []

    for table, cols, line in iter_raw_lines(path, (_STRONA, _WYNIK)):
        if table == _STRONA:
            if not columns:
                columns = cols
            # The contract id is the second column and never contains a tab,
            # so the key can be taken without unescaping the whole row.
            id_umowy = line.split("\t", 2)[1]
            lines.setdefault(id_umowy, []).append(line)
        else:
            row = dict(zip(cols, split_row(line), strict=True))
            if row.get("detale_niedostepne") == "t":
                stubs.append(row)

    return PartyIndex(columns=columns, lines=lines, stubs=stubs)


def _order_parties(index: PartyIndex, raw_lines: list[str]) -> list[CruStrona]:
    """Parse and order one contract's parties.

    Sorted by the `strona_umowy.id` surrogate key, which is the order CRU
    listed them in and therefore semantic: position 0 is the contracting
    public body. The dump does not guarantee that order, so sorting is not
    optional.
    """
    rows = [
        dict(zip(index.columns, split_row(line), strict=True)) for line in raw_lines
    ]
    rows.sort(key=lambda row: int(row["id"] or 0))
    return [build_strona(row, kolejnosc) for kolejnosc, row in enumerate(rows)]


def iter_records(path: Path, index: PartyIndex) -> typing.Iterator[CruUmowa]:
    """Pass two: one `CruUmowa` per contract, then the detail-less stubs.

    Drains `index.lines` as it goes so a contract's parties are freed once
    emitted. Whatever is left over afterwards is a party pointing at a
    contract the dump does not contain, which the caller should treat as a
    corrupt artifact rather than ignore.
    """
    for _, row in iter_rows(path, (_UMOWA,)):
        id_umowy = row["id_umowy"] or ""
        strony = _order_parties(index, index.lines.pop(id_umowy, []))
        yield build_umowa(row, strony)

    for stub in index.stubs:
        yield build_stub(stub)


def scan_artifact(
    path: Path,
    artifact_name: str,
    artifact_filename: str,
    sha256: str,
    size: int,
    source: str,
    dsn: str,
    dumped_utc: str,
    server_version: str | None,
    pg_dump_version: str | None,
) -> CruDumpManifest:
    """One pass over the artifact, describing what is in it.

    Counting rows here rather than trusting the mirror means the manifest
    describes the file we actually hold, so a truncated download is caught
    before the JSONL pipeline reads it.
    """
    counts = dict.fromkeys((_UMOWA, _STRONA, _WYNIK), 0)
    max_id = 0
    max_publikacji = ""
    detale_niedostepne = 0

    for table, columns, line in iter_raw_lines(path, counts.keys()):
        counts[table] += 1
        if table == _STRONA:
            # `id` is the first column; cheaper than splitting the whole row.
            max_id = max(max_id, int(line.split("\t", 1)[0]))
            continue

        row = dict(zip(columns, split_row(line), strict=True))
        if table == _UMOWA:
            max_publikacji = max(max_publikacji, row.get("data_publikacji") or "")
        elif row.get("detale_niedostepne") == "t":
            detale_niedostepne += 1

    return CruDumpManifest(
        artifact_name=artifact_name,
        artifact_filename=artifact_filename,
        bytes=size,
        sha256=sha256,
        source=source,
        dumped_utc=dumped_utc,
        dsn=dsn,
        server_version=server_version,
        pg_dump_version=pg_dump_version,
        rows_umowa=counts[_UMOWA],
        rows_strona_umowy=counts[_STRONA],
        rows_wynik_wyszukiwania=counts[_WYNIK],
        rows_detale_niedostepne=detale_niedostepne,
        strona_umowy_max_id=max_id,
        max_data_publikacji=max_publikacji or None,
    )
