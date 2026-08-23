"""Data classes for the Centralny Rejestr Umów (CRU).

CRU is the Polish central register of public contracts, published at
https://rejestrumow.gov.pl. We read it from a postgres mirror of its API rather
than from the API itself, so the field names below are the mirror's -- Polish,
and matching the JSON the API returns.

Identifiers here are strings and must stay strings. NIP and REGON both carry
significant leading zeros (``000524832`` is a real REGON), and
``pd.read_json(lines=True)`` without an explicit ``dtype`` turns that into the
integer 524832. ``CruUmowy.dtype`` pins the top-level columns for
``Pipeline.read``; values nested inside ``strony`` survive because pandas does
not look inside a list of dicts. Any hand-rolled read of the output has to pass
``dtype`` itself.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import ClassVar


@dataclass
class CruNiejawnosc:
    """Why a field is withheld from publication.

    CRU may redact a contract's subject, its value, or a party's identity. The
    API then returns an object explaining the legal basis instead of the value.
    """

    zakres: str | None = None
    podstawa: str | None = None
    komentarz: str | None = None
    organ_lub_osoba_wylaczajaca: str | None = None


@dataclass
class CruZmiana:
    """One amendment to a contract, from ``umowa.zmiany_umowy``."""

    rodzaj_zmiany: str | None = None
    #: ISO ``YYYY-MM-DD``. CRU publishes this one date as ``DD.MM.YYYY`` -- the
    #: only non-ISO date in the schema -- so it is converted on the way in.
    data_zmiany: str | None = None
    #: The original string, kept only when it did not parse. Never drop an
    #: amendment just because its date is malformed.
    data_zmiany_raw: str | None = None
    komentarz: str | None = None


@dataclass
class CruStrona:
    """One party to a contract, from ``strona_umowy``.

    A party is either an organisation (``nazwa``, usually with ``nip`` and
    ``regon``) or a named private individual (``imie``/``nazwisko`` and nothing
    else). ``czy_konsorcjum`` is genuinely tri-state: NULL on most rows.
    """

    #: Position within the contract, 0-based, in the order CRU lists them.
    #: Position 0 is the contracting public body.
    kolejnosc: int = 0
    rodzaj: str | None = None
    nazwa: str | None = None
    imie: str | None = None
    nazwisko: str | None = None
    nip: str | None = None
    regon: str | None = None
    #: The 9-digit stem of a 14-digit REGON, which is what identifies the legal
    #: entity; the extra 5 digits identify a local unit of it.
    regon9: str | None = None
    kraj: str | None = None
    czy_konsorcjum: bool | None = None
    ulica: str | None = None
    numer_nieruchomosci: str | None = None
    numer_lokalu: str | None = None
    kod_pocztowy: str | None = None
    miejscowosc: str | None = None
    gmina_miasto_dzielnica: str | None = None
    powiat: str | None = None
    wojewodztwo: str | None = None
    niejawnosc: CruNiejawnosc | None = None


@dataclass
class CruUmowa:
    """One contract: the ``umowa`` row with its parties nested.

    One JSONL line per contract rather than per party. A party is meaningless
    without the contract it belongs to, and flattening would repeat every
    contract field across its parties -- 300673 lines to carry 149641
    contracts' worth of facts.
    """

    __output_path__: ClassVar[Path] = Path("cru_umowy/cru_umowy.jsonl.tmp")

    id_umowy: str
    #: ``umowa`` when the detail fetch succeeded, ``wynik`` for the handful of
    #: contracts CRU indexes but will not serve details for. A ``wynik`` record
    #: carries only what the search index knows and has ``strony == []``.
    zrodlo: str

    status_umowy: str | None = None
    numer_umowy: str | None = None
    brak_numeru_umowy: bool | None = None
    data_zawarcia_umowy: str | None = None
    data_zakonczenia_umowy: str | None = None
    umowa_na_czas_nieoznaczony: bool | None = None
    okres: str | None = None
    przedmiot_umowy: str | None = None
    wartosc_przedmiotu: float | None = None
    opis_wartosci_przedmiotu: str | None = None
    finansowana_ze_srodkow: bool | None = None
    niejawnosc_przedmiotu: CruNiejawnosc | None = None
    niejawnosc_wartosci_przedmiotu: CruNiejawnosc | None = None
    zmiany_umowy: list[CruZmiana] = field(default_factory=list)

    #: Denormalised from ``strony[0]``, which is the contracting public body.
    #: Carried at the top level so the common "who spent this" question does
    #: not need the nested array.
    zamawiajacy_nazwa: str | None = None
    zamawiajacy_nip: str | None = None
    zamawiajacy_regon: str | None = None
    zamawiajacy_regon9: str | None = None

    liczba_stron: int = 0
    #: True when any party is a named private individual. One predicate to
    #: filter on: those rows are personal data and are not resolvable to a
    #: company.
    ma_osobe_fizyczna: bool = False
    #: Every distinct NIP/REGON on the contract, sorted. A join key for
    #: matching CRU against KRS-derived company records.
    identyfikatory: list[str] = field(default_factory=list)

    strony: list[CruStrona] = field(default_factory=list)

    data_publikacji: str | None = None
    data_modyfikacji: str | None = None
    #: When our mirror ingested the row. Postgres renders this with a space
    #: rather than a ``T``; it is kept exactly as the mirror wrote it.
    zaimportowano: str | None = None
    #: Only ever set on ``zrodlo == "wynik"`` records.
    detale_blad: str | None = None
    detale_niedostepne_od: str | None = None


@dataclass
class CruDumpManifest:
    """What ``CruDump`` produced, and where it came from.

    The pipeline's real product is a ~45 MB ``.sql.gz`` in ``downloaded/``,
    which the pipeline framework cannot carry as an output -- it only writes
    jsonl and csv. So the output is this one-row description of the artifact,
    and the artifact itself is a side effect. This row is what makes the
    artifact verifiable (``sha256``, ``bytes``) and what tells a later run
    whether the mirror has moved (``max_data_publikacji``).
    """

    artifact_name: str
    #: Basename only, never a path: this row is uploaded to the shared cache
    #: and restored on machines where ``downloaded/`` lives somewhere else.
    artifact_filename: str
    bytes: int
    sha256: str
    #: How the artifact was obtained: ``pg_dump``, ``local-cache``,
    #: ``shared-cache`` or ``file``.
    source: str
    dumped_utc: str
    dsn: str
    server_version: str | None = None
    pg_dump_version: str | None = None
    rows_umowa: int = 0
    rows_strona_umowy: int = 0
    rows_wynik_wyszukiwania: int = 0
    rows_detale_niedostepne: int = 0
    strona_umowy_max_id: int = 0
    #: The newest ``data_publikacji`` in the dump. The staleness signal that
    #: actually means something -- the file's mtime only says when we last
    #: copied it.
    max_data_publikacji: str | None = None
