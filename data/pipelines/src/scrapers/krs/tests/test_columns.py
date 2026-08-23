"""Reading a KRS pipeline's own jsonl output back without losing the types."""

import io

import pandas as pd

from scrapers.krs.columns import iso_dates, normalise, padded_krs
from stores.file import FromBytesIO


def roundtrip(rows) -> pd.DataFrame:
    """Through the write and read a Pipeline actually performs."""
    buffer = io.BytesIO()
    pd.DataFrame(rows).to_json(buffer, orient="records", lines=True)
    buffer.seek(0)
    return FromBytesIO(buffer, "test").read_dataframe("jsonl", dtype={"krs": str})


ROW = {
    "krs": "0000000110",
    "date": "2026-07-19",
    "update_date": "2026-07-20",
    "method": "rejestrio_org_krs_powiazania_aktualne",
}


def test_a_zero_padded_krs_comes_back_as_a_number_without_a_dtype():
    """The bug this guards: the join in KRSNeedsRefresh then matches nothing."""
    buffer = io.BytesIO()
    pd.DataFrame([ROW]).to_json(buffer, orient="records", lines=True)
    buffer.seek(0)
    raw = FromBytesIO(buffer, "test").read_dataframe("jsonl")

    assert raw.iloc[0]["krs"] != "0000000110"


def test_a_column_named_date_comes_back_as_a_timestamp_whatever_dtype_says():
    """Which is why normalise exists rather than a wider dtype."""
    back = roundtrip([ROW])

    assert pd.api.types.is_datetime64_any_dtype(back["date"])


def test_normalise_puts_both_back():
    back = normalise(roundtrip([ROW]), "date", "update_date")

    assert back.iloc[0]["krs"] == "0000000110"
    assert back.iloc[0]["date"] == "2026-07-19"
    assert back.iloc[0]["update_date"] == "2026-07-20"


def test_normalise_leaves_a_frame_that_never_left_memory_alone():
    """A freshly processed frame and a re-read one have to compare equal."""
    fresh = normalise(pd.DataFrame([ROW]), "date", "update_date")
    reread = normalise(roundtrip([ROW]), "date", "update_date")

    assert fresh.iloc[0].to_dict() == reread.iloc[0].to_dict()


def test_normalise_does_not_mutate_its_argument():
    back = roundtrip([ROW])
    normalise(back, "date")

    assert pd.api.types.is_datetime64_any_dtype(back["date"])


def test_an_empty_frame_keeps_its_columns():
    empty = normalise(pd.DataFrame(columns=["krs", "date"]), "date")

    assert empty.empty
    assert list(empty.columns) == ["krs", "date"]


def test_a_column_that_is_not_there_is_not_invented():
    result = normalise(pd.DataFrame([{"krs": "110"}]), "date")

    assert list(result.columns) == ["krs"]


def test_a_missing_date_does_not_become_the_string_nan():
    """date.fromisoformat("nan") raises; an empty string is at least falsy."""
    back = normalise(pd.DataFrame([{"krs": "110", "date": None}]), "date")

    assert back.iloc[0]["date"] == ""


def test_padded_krs_accepts_whatever_pandas_made_of_it():
    assert (
        list(padded_krs(pd.Series([110, "110", " 0000000110 "]))) == ["0000000110"] * 3
    )


def test_iso_dates_truncates_a_timestamp_to_its_day():
    stamps = pd.Series(pd.to_datetime(["2026-07-19 13:45:00"]))

    assert list(iso_dates(stamps)) == ["2026-07-19"]


def test_a_krs_column_that_read_back_as_a_float_still_pads_to_a_krs():
    """A null anywhere in the column makes pandas read the whole thing as float."""
    assert list(padded_krs(pd.Series([110.0, None]))) == ["0000000110", ""]


def test_every_dtype_a_krs_column_can_come_back_as():
    for values in (
        pd.Series([110, 111]),
        pd.Series(["0000000110", "0000000111"]),
        pd.Series([110, 111], dtype="Int64"),
        pd.Series([110.0, 111.0]),
    ):
        assert list(padded_krs(values)) == ["0000000110", "0000000111"]


def test_a_missing_krs_does_not_pad_to_a_company_that_exists():
    """zfill("") is "0000000000", which is a KRS number the register uses."""
    assert list(padded_krs(pd.Series([None]))) == [""]
