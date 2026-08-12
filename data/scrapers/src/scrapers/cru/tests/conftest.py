"""Fixtures for the CRU tests.

The fixture dump is checked in uncompressed so it stays diffable, and gzipped
into a tmp_path per test because that is the shape the pipeline reads.
"""

import gzip
from pathlib import Path

import pytest

SAMPLE_SQL = Path(__file__).parent / "data" / "cru_sample.sql"


@pytest.fixture
def sample_dump(tmp_path: Path) -> Path:
    """The checked-in sample dump, gzipped, as `CruDump` would have left it."""
    destination = tmp_path / "rejestrumow_dump.sql.gz"
    with gzip.open(destination, "wb") as out:
        out.write(SAMPLE_SQL.read_bytes())
    return destination
