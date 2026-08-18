"""Extract's filters must not care which shape a list column arrived in.

duckdb hands a LIST column back as a `numpy.ndarray` per row, and the jsonl
the pipeline writes reads back as a Python `list`. Both are the same data, and
which one Extract sees depends only on whether its source was recomputed or
read from cache - so a filter that recognises one and not the other drops
everybody on exactly the runs that refreshed something upstream.
"""

import sys
from unittest.mock import patch

import numpy as np
import pytest

from analysis.extract import Extract
from scrapers.stores import Pipeline

EMPLOYMENT = [
    {
        "employed_krs": "0000104622",
        "employed_start": "2026-08-01",
        "employed_end": None,
        "employed_for": "1.00",
        "employed_role": "Zarząd",
    }
]

ELECTIONS = [{"election_year": 2023, "party": "KW", "teryt_candidacy_powiat": ["3061"]}]


def extract(*argv: str) -> Extract:
    with patch.object(sys, "argv", ["koryta", "PeoplePayloads", *argv]):
        pipeline = Pipeline.create(Extract)
        # `args` is a cached_property read off sys.argv - force it here,
        # while the patched argv is still in place.
        _ = pipeline.args
        return pipeline


def both_shapes(value):
    return [value, np.array(value, dtype=object)]


@pytest.mark.parametrize("employment", both_shapes(EMPLOYMENT))
def test_employed_after_counts_arrays_and_lists(employment):
    pipeline = extract("--all", "--employed-after", "2026-07-13")
    assert pipeline.relevant_employment(None)(employment) == 1


@pytest.mark.parametrize("employment", both_shapes(EMPLOYMENT))
def test_employed_after_still_excludes_older_posts(employment):
    pipeline = extract("--all", "--employed-after", "2026-09-01")
    assert pipeline.relevant_employment(None)(employment) == 0


@pytest.mark.parametrize("elections", both_shapes(ELECTIONS))
def test_elections_count_arrays_and_lists(elections):
    pipeline = extract("--region", "3061")
    assert pipeline.relevant_elections()(elections) == 1


def test_missing_column_is_not_relevant():
    pipeline = extract("--all", "--employed-after", "2026-07-13")
    assert pipeline.relevant_employment(None)(float("nan")) == 0
    assert pipeline.relevant_elections()(None) == 0
