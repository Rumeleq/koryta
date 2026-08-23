"""Assertions over a completed CRU run.

Deliberately not part of the generic `baseline.json` checks: those read a whole
output into pandas, and `cru_umowy.jsonl` is ~320 MB of nested records, which
would cost several GB of RAM to no purpose. Everything here streams instead.

Like the rest of `tests/e2e`, these read `versioned/` and never run a pipeline
themselves, so they skip when there is nothing to check.
"""

import json
from pathlib import Path

import pandas as pd
import pytest

from scrapers.cru.artifact import artifact_path, sha256_of
from tests.e2e.conftest import output_path

pytestmark = pytest.mark.e2e

UMOWY = "cru_umowy"
MANIFEST = "cru_dump"


@pytest.fixture(scope="module")
def manifest() -> dict:
    path = output_path(MANIFEST)
    if not path.exists():
        pytest.skip(f"{path} is missing -- CruDump has not run")
    return pd.read_json(path, lines=True, dtype=False).iloc[0].to_dict()


@pytest.fixture(scope="module")
def umowy_path() -> Path:
    path = output_path(UMOWY)
    if not path.exists():
        pytest.skip(f"{path} is missing -- CruUmowy has not run")
    return path


def test_the_artifact_matches_its_manifest(manifest) -> None:
    """The dump we hold is the one the manifest describes."""
    artifact = artifact_path(str(manifest["artifact_filename"]))
    if not artifact.exists():
        pytest.skip(f"{artifact} is missing -- nothing to verify against")

    assert artifact.stat().st_size == int(manifest["bytes"])
    assert sha256_of(artifact) == str(manifest["sha256"])


def test_every_indexed_contract_produced_a_record(manifest, umowy_path) -> None:
    """One line per contract CRU indexes, whether or not details were served.

    `wynik_wyszukiwania` is the register's own index, so its row count is the
    number of contracts that exist. Fewer lines than that means we dropped
    some.
    """
    with umowy_path.open(encoding="utf-8") as handle:
        lines = sum(1 for _ in handle)
    assert lines == int(manifest["rows_wynik_wyszukiwania"])


def test_no_party_was_lost_and_no_contract_duplicated(manifest, umowy_path) -> None:
    seen: set[str] = set()
    parties = 0
    for line in umowy_path.open(encoding="utf-8"):
        record = json.loads(line)
        assert record["id_umowy"] not in seen, f"duplicate {record['id_umowy']}"
        seen.add(record["id_umowy"])
        parties += len(record["strony"])

    assert parties == int(manifest["rows_strona_umowy"])
    assert len(seen) == int(manifest["rows_wynik_wyszukiwania"])


def test_identifiers_survived_as_strings(umowy_path) -> None:
    """A REGON that became a number has lost its leading zeros for good."""
    leading_zero = 0
    for line in umowy_path.open(encoding="utf-8"):
        record = json.loads(line)
        for value in record["identyfikatory"]:
            assert isinstance(value, str), f"{record['id_umowy']}: {value!r}"
        regon = record["zamawiajacy_regon"]
        assert regon is None or isinstance(regon, str)
        if regon and regon.startswith("0"):
            leading_zero += 1

    # Roughly half the register's public bodies have one; zero would mean the
    # whole column had been silently converted to integers somewhere.
    assert leading_zero > 1000


def test_detail_less_contracts_are_marked_not_dropped(manifest, umowy_path) -> None:
    stubs = 0
    for line in umowy_path.open(encoding="utf-8"):
        record = json.loads(line)
        if record["zrodlo"] == "wynik":
            stubs += 1
            assert record["strony"] == []
            assert record["detale_blad"]

    assert stubs == int(manifest["rows_detale_niedostepne"])
