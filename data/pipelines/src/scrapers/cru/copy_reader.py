"""Reading the COPY blocks out of a plain-SQL pg_dump.

The artifact is a gzipped `pg_dump` in plain SQL, so the table data arrives as
COPY blocks in postgres's TEXT format rather than as anything a SQL parser
would need to look at. That format is small enough to read exactly, and doing
so means the JSONL pipeline needs no database at all -- which is the point:
anyone with the artifact can rebuild the output.

Two rules here are load-bearing and easy to get backwards:

* **Split on tabs first, unescape second.** Field values contain escaped tabs
  and newlines (2894 contract subjects carry a `\\n`, 285 a `\\t`). Unescaping
  first would turn those into real separators and silently shift every
  following column by one.
* **`\\N` is the NULL marker, and it is checked before unescaping.** After
  unescaping it would be indistinguishable from the two-character string
  `\\N` that a real value could contain.
"""

import gzip
import re
import typing
from pathlib import Path

#: `COPY public.umowa (id_umowy, status_umowy, ...) FROM stdin;`
#: The column list is read from here and never hardcoded -- `umowa` calls a
#: column `wartosc_przedmiotu` where `wynik_wyszukiwania` calls it
#: `wartosc_przedmiotu_umowy`, and mixing them up would be silent.
COPY_HEADER = re.compile(
    r"^COPY (?:public\.)?(?P<table>\w+) \((?P<cols>[^)]*)\) FROM stdin;$"
)

#: Ends a COPY block. The line is exactly this, with nothing else on it.
COPY_TERMINATOR = "\\."

_SIMPLE_ESCAPES = {
    "b": "\b",
    "f": "\f",
    "n": "\n",
    "r": "\r",
    "t": "\t",
    "v": "\v",
    "\\": "\\",
}

_OCTAL = re.compile(r"[0-7]{1,3}")
_HEX = re.compile(r"[0-9A-Fa-f]{1,2}")


def unescape(field: str) -> str:
    """Undo postgres's COPY TEXT escaping of one already-split field.

    Postgres emits `\\b \\f \\n \\r \\t \\v \\\\`, octal `\\NNN` and hex
    `\\xNN`. An unrecognised `\\c` means the literal `c` -- that is what the
    backend's own reader does, so a value written by a future postgres with a
    new escape degrades to something readable rather than raising.
    """
    if "\\" not in field:
        return field

    out: list[str] = []
    i = 0
    end = len(field)
    while i < end:
        char = field[i]
        if char != "\\":
            out.append(char)
            i += 1
            continue

        i += 1
        if i >= end:
            # Trailing lone backslash. Not something postgres emits, but
            # dropping it silently would be worse than keeping it.
            out.append("\\")
            break

        char = field[i]
        simple = _SIMPLE_ESCAPES.get(char)
        if simple is not None:
            out.append(simple)
            i += 1
        elif char == "x":
            match = _HEX.match(field, i + 1)
            if match is None:
                out.append("x")
                i += 1
            else:
                out.append(chr(int(match.group(), 16)))
                i = match.end()
        else:
            match = _OCTAL.match(field, i)
            if match is None:
                out.append(char)
                i += 1
            else:
                out.append(chr(int(match.group(), 8)))
                i = match.end()
    return "".join(out)


def split_row(line: str) -> list[str | None]:
    """One COPY data line into its fields, NULLs as None."""
    return [
        None if field == "\\N" else unescape(field)
        for field in line.rstrip("\n").split("\t")
    ]


def open_dump(path: Path) -> typing.TextIO:
    """Open a gzipped plain-SQL dump for line reading.

    `newline="\\n"` rather than the more usual `newline=""`: universal-newline
    handling would also break lines on a bare `\\r`, and an escaped `\\r`
    inside a field is written as a real carriage return by some producers.
    Splitting there would corrupt the row.
    """
    return gzip.open(path, "rt", encoding="utf-8", newline="\n")


def iter_raw_lines(
    path: Path, tables: typing.Collection[str]
) -> typing.Iterator[tuple[str, list[str], str]]:
    """Stream `(table, columns, raw_line)` for the named tables.

    Yields the line still escaped, so a caller that only wants to index rows
    can hold them as-is: parsing 300673 party rows into dicts up front costs
    several times the memory of keeping the text.

    The artifact is two concatenated `pg_dump` runs (schema, then data), so
    `-- PostgreSQL database dump complete` appears twice and means nothing.
    Only the COPY headers and the `\\.` terminators delimit anything.
    """
    with open_dump(path) as handle:
        table: str | None = None
        columns: list[str] = []
        for line in handle:
            if table is None:
                header = COPY_HEADER.match(line.rstrip("\n"))
                if header is not None and header.group("table") in tables:
                    table = header.group("table")
                    columns = [c.strip() for c in header.group("cols").split(",")]
                continue

            if line.rstrip("\n") == COPY_TERMINATOR:
                table = None
                columns = []
                continue

            yield table, columns, line


def iter_rows(
    path: Path, tables: typing.Collection[str]
) -> typing.Iterator[tuple[str, dict[str, str | None]]]:
    """Stream `(table, row)` for the named tables, in the order they appear."""
    for table, columns, line in iter_raw_lines(path, tables):
        yield table, dict(zip(columns, split_row(line), strict=True))


def count_rows(path: Path, tables: typing.Collection[str]) -> dict[str, int]:
    """How many data lines each named table has. One pass, no parsing."""
    counts = dict.fromkeys(tables, 0)
    for table, _, _ in iter_raw_lines(path, tables):
        counts[table] += 1
    return counts
