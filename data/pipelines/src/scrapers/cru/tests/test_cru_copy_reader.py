"""The COPY TEXT reader.

Most of these guard against corruption that would be silent: a mis-split row
shifts every following column by one and still produces plausible-looking
output, so the failure would show up as wrong data rather than as an error.
"""

from pathlib import Path

import pytest

from scrapers.cru.copy_reader import (
    COPY_HEADER,
    count_rows,
    iter_rows,
    split_row,
    unescape,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("plain", "plain"),
        ("a\\tb", "a\tb"),
        ("a\\nb", "a\nb"),
        ("a\\\\b", "a\\b"),
        ("a\\rb", "a\rb"),
        ("\\101", "A"),  # octal
        ("\\x41", "A"),  # hex
        ("\\q", "q"),  # unknown escape degrades to the bare character
        ("", ""),
    ],
)
def test_unescape(raw: str, expected: str) -> None:
    assert unescape(raw) == expected


def test_split_row_maps_null_marker_to_none() -> None:
    assert split_row("a\t\\N\tb\n") == ["a", None, "b"]


def test_split_row_keeps_empty_string_distinct_from_null() -> None:
    """`\\N` is NULL; an empty field is the empty string. Not the same value."""
    assert split_row("\t\\N\n") == ["", None]


def test_escaped_separators_do_not_split_the_row() -> None:
    """The reason to split on tabs before unescaping, not after.

    Unescaping first would turn these into real separators and produce five
    fields instead of three, shifting every later column.
    """
    fields = split_row("first\tembedded\\ttab and\\nnewline\tlast\n")
    assert fields == ["first", "embedded\ttab and\nnewline", "last"]


def test_a_literal_backslash_N_in_a_value_is_not_null() -> None:
    """NULL is detected before unescaping, so an escaped backslash survives."""
    assert split_row("\\\\N\n") == ["\\N"]


def test_copy_header_reads_the_column_list() -> None:
    match = COPY_HEADER.match("COPY public.umowa (id_umowy, status_umowy) FROM stdin;")
    assert match is not None
    assert match.group("table") == "umowa"
    assert match.group("cols") == "id_umowy, status_umowy"


def test_reads_every_block_across_both_dump_sections(sample_dump: Path) -> None:
    """The artifact is two concatenated pg_dump runs.

    `-- PostgreSQL database dump complete` therefore appears twice and ends
    nothing; a reader that stopped at the first one would find no data at all,
    since the COPY blocks are all in the second section.
    """
    assert count_rows(sample_dump, ("umowa", "strona_umowy", "wynik_wyszukiwania")) == {
        "umowa": 3,
        "strona_umowy": 4,
        "wynik_wyszukiwania": 4,
    }


def test_rows_are_keyed_by_the_header_column_names(sample_dump: Path) -> None:
    """Columns come from each block's own header.

    `umowa` calls a column `wartosc_przedmiotu` and `wynik_wyszukiwania` calls
    the same thing `wartosc_przedmiotu_umowy`; hardcoding either would read
    the wrong field from the other table.
    """
    umowa = [row for _, row in iter_rows(sample_dump, ("umowa",))]
    wynik = [row for _, row in iter_rows(sample_dump, ("wynik_wyszukiwania",))]

    assert "wartosc_przedmiotu" in umowa[0]
    assert "wartosc_przedmiotu_umowy" in wynik[0]


def test_selects_only_the_requested_tables(sample_dump: Path) -> None:
    tables = {table for table, _ in iter_rows(sample_dump, ("strona_umowy",))}
    assert tables == {"strona_umowy"}


def test_ignores_the_restrict_nonce_lines(sample_dump: Path) -> None:
    """`\\restrict` lines sit between the COPY blocks and are not data."""
    for _, row in iter_rows(sample_dump, ("umowa", "strona_umowy")):
        assert not any((value or "").startswith("\\restrict") for value in row.values())
