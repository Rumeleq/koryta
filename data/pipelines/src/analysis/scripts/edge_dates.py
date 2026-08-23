"""Analyse how well each edge type dates the relation it records.

An edge in koryta carries a period - ``start_date`` and ``end_date`` - but only
some kinds of relation have one. A spell of employment began on a day and may
have ended on another; a ``connection`` between two people asserts no period at
all, and the edit form only offers the two date fields on its ``employed``
branch. So a missing ``start_date`` means opposite things depending on the type,
and the only way to tell them apart is to look at how the whole type behaves:

* a type where **every** edge has a start date has one in its schema;
* a type where **none** does has no notion of a period, and the empty ones that
  do occur are blanks written by a form rather than dates;
* a type in between is the interesting case - the date belongs there and some
  documents are missing it. That is a gap in the record, and it is what
  ``test_a_dated_edge_says_when_it_began`` in ``tests/pipelines/test_invariants``
  budgets.

It matters because nothing raises when the date is absent.
``calculateExperience`` in ``frontend/shared/stats.ts`` skips an interval with no
start, so the person simply shows less experience than they have, and
``EDGE_SEMANTICS`` keys an employment on the role *and* the start, so an undated
spell cannot be told apart from any other spell at that company.

Run from the ``src`` directory (same import root as the tests)::

    python -m analysis.scripts.edge_dates
    python -m analysis.scripts.edge_dates --history 6
    python -m analysis.scripts.edge_dates --export 2026-07-28T14:25:08.897Z

It reads one koryta.pl Firestore export - the most recent complete one unless
``--export`` names another - through ``scrapers.koryta.snapshot``, the same
reader the invariant tests use. ``--history`` reads several, evenly spaced across
the bucket, which is what tells a fixed set of old undated edges apart from a
writer that is still producing them.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

# Allow running as a plain script (python analysis/scripts/edge_dates.py) by
# making sure the ``src`` root is importable, like the test suite expects.
_SRC_ROOT = Path(__file__).resolve().parents[2]
if str(_SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(_SRC_ROOT))

from conductor import setup_context  # noqa: E402
from scrapers.koryta.snapshot import (  # noqa: E402
    Snapshot,
    export_dates,
    load_snapshot,
    read_collection,
)
from scrapers.stores import Context  # noqa: E402

DATE_FIELDS = ("start_date", "end_date")

#: A relation whose type dates it, but which is missing the date, is only worth
#: singling out where the type dates most of its edges - below this the type
#: simply has no period and every edge "missing" one is normal.
PARTIAL_BAND = (0.0, 1.0)


def is_set(value: Any) -> bool:
    """Whether a stored date says anything.

    ``None`` and ``""`` are both "no date": /api/edges/create writes ``null``
    for a field the form left blank while the editor writes an empty string, and
    every reader in the frontend tests the field for truthiness, so the two are
    the same absence seen from two writers.
    """
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def coverage(edges: Iterable[dict]) -> dict[str, Counter]:
    """Per edge type, how many documents set, omit or blank each date field."""
    counts: dict[str, Counter] = defaultdict(Counter)
    for edge in edges:
        stats = counts[str(edge.get("type"))]
        stats["total"] += 1
        for field in DATE_FIELDS:
            if is_set(edge.get(field)):
                stats[f"{field}.set"] += 1
            elif field in edge:
                stats[f"{field}.blank"] += 1
            else:
                stats[f"{field}.absent"] += 1
        if is_set(edge.get("end_date")) and not is_set(edge.get("start_date")):
            stats["ends_without_starting"] += 1
    return counts


def report_coverage(counts: dict[str, Counter], export: str) -> list[str]:
    """Print the per-type table and return the types that date only some edges."""
    print("\n" + "=" * 78)
    print(f"EDGE DATE COVERAGE  (export {export})")
    print("=" * 78)
    print(
        f"\n  {'type':<18}{'edges':>8}{'start':>8}{'rate':>8}"
        f"{'absent':>8}{'blank':>7}{'end':>8}{'end only':>10}"
    )

    partial: list[str] = []
    for edge_type, stats in sorted(
        counts.items(), key=lambda item: item[1]["total"], reverse=True
    ):
        total = stats["total"]
        rate = stats["start_date.set"] / total if total else 0.0
        flag = ""
        if PARTIAL_BAND[0] < rate < PARTIAL_BAND[1]:
            partial.append(edge_type)
            flag = "  <-- dated, but not always"
        print(
            f"  {edge_type:<18}{total:>8}{stats['start_date.set']:>8}{rate:>8.1%}"
            f"{stats['start_date.absent']:>8}{stats['start_date.blank']:>7}"
            f"{stats['end_date.set']:>8}{stats['ends_without_starting']:>10}{flag}"
        )

    print(
        "\n  A type at 100% has the period in its schema; one at 0% has no notion\n"
        "  of a period and its blanks are a form's empty strings, not lost dates.\n"
        "  'end only' counts edges that record an end but no beginning, which is\n"
        "  an interval no reader can place and should be zero everywhere."
    )
    return partial


def report_gaps(snapshot: Snapshot, edge_type: str) -> None:
    """Describe the undated edges of a type that dates most of its edges.

    Which writer left the date out is the whole question, and the edge says so
    indirectly: ``revision_id`` means it went through the editor, where the date
    field is optional and was left empty, while an edge with none was written by
    an ingest.
    """
    nodes = snapshot.by_id("nodes")
    undated = [
        edge
        for edge in snapshot.collection("edges")
        if edge.get("type") == edge_type and not is_set(edge.get("start_date"))
    ]
    if not undated:
        return

    print(f"\n### {edge_type!r}: {len(undated)} edges with no start date")

    def tally(label: str, values: Iterable[Any]) -> None:
        counts = Counter(values)
        rendered = ", ".join(f"{key}: {count}" for key, count in counts.most_common(6))
        print(f"  {label:<22}{rendered}")

    tally(
        "written by",
        (
            "editor (revision)" if edge.get("revision_id") else "ingest"
            for edge in undated
        ),
    )
    tally("published", (str(edge.get("published")) for edge in undated))
    tally("role recorded", ("yes" if edge.get("name") else "no" for edge in undated))
    tally(
        "source node type",
        (nodes.get(edge["source"], {}).get("type") for edge in undated),
    )
    tally(
        "target node type",
        (nodes.get(edge["target"], {}).get("type") for edge in undated),
    )
    tally("role", (edge.get("name") for edge in undated if edge.get("name")))
    print(f"  {'sample ids':<22}{', '.join(edge['id'] for edge in undated[:6])}")


def report_history(ctx: Context, samples: int) -> None:
    """The same count over exports spread across the bucket.

    A backlog of undated edges left by a writer that has since been fixed stands
    still while the collection around it grows; one that is still being written
    climbs with it. The two look identical in a single export.
    """
    dates = export_dates(ctx)
    if not dates:
        return
    step = max(1, len(dates) // max(1, samples - 1))
    picked = sorted({*dates[::step], dates[-1]})

    print("\n" + "=" * 78)
    print(f"HISTORY  ({len(picked)} of {len(dates)} exports)")
    print("=" * 78)

    rows = []
    for date in picked:
        counts = coverage(read_collection(ctx, date, "edges"))
        rows.append((date, counts))

    types = sorted(
        {edge_type for _, counts in rows for edge_type in counts},
        key=lambda edge_type: -rows[-1][1][edge_type]["total"],
    )
    header = "".join(f"{edge_type[:11]:>13}" for edge_type in types)
    print(f"\n  {'export':<22}{header}")
    for date, counts in rows:
        cells = "".join(
            f"{counts[t]['total'] - counts[t]['start_date.set']:>6}"
            f"/{counts[t]['total']:<6}"
            for t in types
        )
        print(f"  {date[:19]:<22}{cells}")
    print("\n  Cells are (edges with no start date)/(edges of that type).")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--export",
        help="Export timestamp to read (default: the most recent complete one).",
    )
    parser.add_argument(
        "--history",
        type=int,
        default=0,
        metavar="N",
        help="Also read N earlier exports, evenly spaced, and show the trend.",
    )
    args = parser.parse_args()

    ctx = setup_context()[0]
    snapshot = load_snapshot(ctx, args.export)
    edges = snapshot.collection("edges")
    print(f"Loaded {len(edges)} edges from {snapshot.date}.")

    counts = coverage(edges)
    for edge_type in report_coverage(counts, snapshot.date):
        report_gaps(snapshot, edge_type)

    if args.history:
        report_history(ctx, args.history)


if __name__ == "__main__":
    main()
