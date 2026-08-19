"""A list column read two ways has to behave the same both times."""

import numpy as np
import pandas as pd
import pytest

from analysis.utils import as_sequence

EMPLOYMENT = [{"employed_krs": "0000000110", "employed_start": "2020-01-01"}]


def test_a_duckdb_list_column_is_a_sequence():
    """`.df()` makes an ndarray of a LIST column, which is not a `list`."""
    from_duckdb = np.array(EMPLOYMENT, dtype=object)

    assert not isinstance(from_duckdb, list)
    assert as_sequence(from_duckdb) == EMPLOYMENT


def test_the_same_column_read_back_from_jsonl_is_a_sequence():
    """A JSON array parses to a `list`, which is the shape the code assumed."""
    assert as_sequence(EMPLOYMENT) == EMPLOYMENT


def test_both_shapes_agree():
    """The bug this guards: Extract scored everyone 0 on a run that rebuilt.

    `works_in_relevant` tested `isinstance(x, list)`, which is true only of the
    cached shape, so a fresh run of the pipeline graph emitted nobody at all
    and said nothing about it.
    """
    assert as_sequence(np.array(EMPLOYMENT, dtype=object)) == as_sequence(EMPLOYMENT)


@pytest.mark.parametrize("empty", [None, float("nan"), pd.NA, "", 0])
def test_anything_that_is_not_a_sequence_holds_no_items(empty):
    assert as_sequence(empty) == []


def test_a_string_is_not_a_sequence_of_characters():
    """`hasattr(x, "__iter__")`, the workaround this replaces, said it was."""
    assert as_sequence("0000000110") == []


def test_a_pandas_series_is_a_sequence():
    assert as_sequence(pd.Series([1, 2])) == [1, 2]


def test_the_result_is_a_plain_list_whatever_went_in():
    for value in (np.array([1, 2]), (1, 2), [1, 2], pd.Series([1, 2])):
        assert type(as_sequence(value)) is list
