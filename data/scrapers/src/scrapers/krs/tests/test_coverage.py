"""Detecting a rejestr.io response fetched before rejestr.io caught up."""

import json
from datetime import date

import pandas as pd
import pytest

from scrapers.krs.censored import KRSCensoredPeople
from scrapers.krs.coverage import (
    RETRY_BACKOFF_DAYS,
    BulletinWindow,
    RejestrIOCoverage,
    days_in,
    parse_current_connections_url,
    retry_delay_days,
)
from scrapers.krs.people_parsing import CensoredPerson
from scrapers.krs.updates import KRSUpdates
from scrapers.stores import Context, ProcessPolicy
from scrapers.test_tree import MockIO, MockNLP, MockRejestrIO, MockUtils, MockWeb

KRS = "0000000110"
OTHER = "0000000111"
BUCKET = "gs://koryta-pl-crawled"


# ─── URL parsing ──────────────────────────────────────────


def test_parses_the_current_layout():
    url = (
        f"{BUCKET}/hostname=rejestr.io/api/v2/org/0000000110"
        "/krs-powiazania/aktualnosc_aktualne/date=2026-07-19"
    )

    assert parse_current_connections_url(url) == ("0000000110", "2026-07-19")


def test_parses_the_layout_with_the_date_after_the_host():
    url = (
        f"{BUCKET}/hostname=rejestr.io/date=2025-09-29/api/v2/org/0000022006"
        "/krs-powiazania/aktualnosc_aktualne"
    )

    assert parse_current_connections_url(url) == ("0000022006", "2025-09-29")


@pytest.mark.parametrize(
    "url",
    [
        # The historic feed lists people who have left; not comparable.
        f"{BUCKET}/hostname=rejestr.io/api/v2/org/0000000110"
        "/krs-powiazania/aktualnosc_historyczne/date=2026-07-19",
        # A person's connections, not a company's.
        f"{BUCKET}/hostname=rejestr.io/api/v2/osoby/808738"
        "/krs-powiazania/aktualnosc_aktualne/date=2026-07-19",
        # The company record itself.
        f"{BUCKET}/hostname=rejestr.io/api/v2/org/0000000110/date=2026-03-18",
    ],
)
def test_ignores_everything_else_under_the_host(url):
    assert parse_current_connections_url(url) is None


# ─── the bulletin window ──────────────────────────────────


def days(first: str, last: str, skip=()) -> set[str]:
    span = {first, *days_in(first, last)}
    return span - set(skip)


def bulletin(rows, crawled=None) -> BulletinWindow:
    return BulletinWindow.build(
        pd.DataFrame(rows, columns=["krs", "date"]),
        crawled if crawled is not None else days("2026-06-01", "2026-07-30"),
    )


def test_a_company_named_in_between_moved():
    window = bulletin([(KRS, "2026-06-01"), (KRS, "2026-06-20")])

    assert window.changed_between(KRS, "2026-06-10", "2026-06-25")
    assert not window.changed_between(KRS, "2026-06-20", "2026-06-25")


def test_the_window_will_not_speak_outside_its_span():
    window = bulletin([(KRS, "2026-06-01"), (OTHER, "2026-06-20")])

    assert window.covers("2026-06-05", "2026-06-15")
    assert not window.covers("2026-05-30", "2026-06-15")
    assert not window.covers("2026-06-05", "2026-08-01")


def test_a_day_missing_from_the_middle_is_not_covered():
    """A change on that day is invisible, so the span proves nothing."""
    window = bulletin([], crawled=days("2026-06-01", "2026-07-30", ["2026-06-10"]))

    assert not window.covers("2026-06-05", "2026-06-15")
    assert window.covers("2026-06-11", "2026-06-15")


def test_two_observations_on_the_same_day_need_no_bulletin():
    """There is no day in that span for the register to have moved on."""
    assert bulletin([], crawled=set()).covers("2026-06-05", "2026-06-05")


def test_an_empty_bulletin_covers_nothing_with_a_day_in_it():
    assert not bulletin([], crawled=set()).covers("2026-06-05", "2026-06-06")


# ─── backoff ──────────────────────────────────────────────


def test_the_first_retry_waits_out_the_propagation_delay():
    assert retry_delay_days(1) == RETRY_BACKOFF_DAYS[0]


def test_each_further_miss_waits_longer():
    delays = [retry_delay_days(n) for n in range(1, len(RETRY_BACKOFF_DAYS) + 1)]

    assert delays == sorted(delays)
    assert delays == list(RETRY_BACKOFF_DAYS)


def test_the_wait_stops_growing():
    assert retry_delay_days(50) == RETRY_BACKOFF_DAYS[-1]


def test_no_miss_means_no_retry_to_schedule():
    with pytest.raises(ValueError):
        retry_delay_days(0)


# ─── the pipeline over a fake bucket ──────────────────────


def person(surname, given, role="nadzor: "):
    return CensoredPerson((surname,), given, "", "7**********", "", role)


def entry(surname, given):
    return {"typ": "osoba", "tozsamosc": {"nazwisko": surname, "imie": given}}


class FakeFile:
    def __init__(self, content: str):
        self.content = content

    def read_string(self) -> str:
        return self.content


class BucketIO(MockIO):
    def __init__(self, blobs: dict[str, list]):
        self.blobs = blobs

    def read_many(self, path):
        for name, body in self.blobs.items():
            yield f"{BUCKET}/{name}", FakeFile(json.dumps(body))


def connections_blob(krs: str, day: str) -> str:
    return (
        f"hostname=rejestr.io/api/v2/org/{krs}/krs-powiazania"
        f"/aktualnosc_aktualne/date={day}"
    )


def build_coverage(blobs, snapshots, updates, crawled=None):
    """A RejestrIOCoverage whose two sources are stubbed out."""
    if crawled is None:
        crawled = days("2026-06-01", "2026-07-30")
    ctx = Context(
        io=BucketIO(blobs),
        rejestr_io=MockRejestrIO(),
        con=None,  # type: ignore[arg-type]
        utils=MockUtils(),
        web=MockWeb(),
        nlp=MockNLP(),
        refresh_policy=ProcessPolicy.with_default(),
    )
    coverage = RejestrIOCoverage()
    censored = KRSCensoredPeople()
    censored.snapshots = lambda _ctx: snapshots  # type: ignore[method-assign]
    krs_updates = KRSUpdates()
    krs_updates.read_or_process = lambda _ctx: pd.DataFrame(  # type: ignore[method-assign]
        updates, columns=["krs", "date"]
    )
    krs_updates.days_crawled = lambda _ctx: crawled  # type: ignore[method-assign]
    coverage.censored_people = censored
    coverage.updates = krs_updates
    result = coverage.process(ctx)
    coverage.read_or_process = lambda _ctx: result  # type: ignore[method-assign]
    return coverage, ctx, result


# "Kowal" and "Nowak" are five letters, "Małgorzata" ten, "Adam" four.
BOARD = [person("K****", "M*********"), person("N****", "A***")]
SPAN = [(KRS, "2026-06-01"), (KRS, "2026-07-30")]


def test_a_response_naming_everybody_is_not_stale():
    _, ctx, df = build_coverage(
        {
            connections_blob(KRS, "2026-07-10"): [
                entry("Kowal", "Małgorzata"),
                entry("Nowak", "Adam"),
            ]
        },
        {KRS: {"2026-07-05": BOARD}},
        SPAN,
    )

    assert df.iloc[0]["n_missing"] == 0
    assert df.iloc[0]["conclusive"]


def test_a_response_missing_a_board_member_is_stale():
    coverage, ctx, df = build_coverage(
        {connections_blob(KRS, "2026-07-10"): [entry("Kowal", "Małgorzata")]},
        {KRS: {"2026-07-05": BOARD}},
        SPAN,
    )

    assert df.iloc[0]["n_missing"] == 1
    assert list(coverage.stale(ctx)["krs"]) == [KRS]


def test_a_register_change_in_between_is_not_evidence():
    """The board can legitimately differ if the register moved after we asked."""
    coverage, ctx, df = build_coverage(
        {connections_blob(KRS, "2026-07-10"): [entry("Kowal", "Małgorzata")]},
        {KRS: {"2026-07-05": BOARD}},
        [*SPAN, (KRS, "2026-07-08")],
    )

    assert df.iloc[0]["n_missing"] == 1
    assert not df.iloc[0]["conclusive"]
    assert coverage.stale(ctx).empty


def test_a_span_the_bulletin_does_not_cover_is_not_evidence():
    coverage, ctx, df = build_coverage(
        {connections_blob(KRS, "2026-09-10"): [entry("Kowal", "Małgorzata")]},
        {KRS: {"2026-09-05": BOARD}},
        SPAN,
    )

    assert not df.iloc[0]["conclusive"]
    assert coverage.stale(ctx).empty


def test_a_response_older_than_the_snapshot_is_not_compared():
    """Only a snapshot taken at or before the scrape says what was true then."""
    _, _, df = build_coverage(
        {connections_blob(KRS, "2026-07-01"): [entry("Kowal", "Małgorzata")]},
        {KRS: {"2026-07-05": BOARD}},
        SPAN,
    )

    assert df.empty


def test_the_newest_snapshot_at_or_before_the_scrape_is_the_one_used():
    _, _, df = build_coverage(
        {
            connections_blob(KRS, "2026-07-10"): [
                entry("Kowal", "Małgorzata"),
                entry("Nowak", "Adam"),
            ]
        },
        {
            KRS: {
                "2026-06-05": [person("Z*****", "K*****")],
                "2026-07-05": BOARD,
            }
        },
        SPAN,
    )

    assert df.iloc[0]["api_date"] == "2026-07-05"
    assert df.iloc[0]["n_missing"] == 0


# ─── the retry queue ──────────────────────────────────────


def stale_twice():
    return build_coverage(
        {
            connections_blob(KRS, "2026-07-01"): [entry("Kowal", "Małgorzata")],
            connections_blob(KRS, "2026-07-10"): [entry("Kowal", "Małgorzata")],
        },
        {KRS: {"2026-06-05": BOARD}},
        SPAN,
    )


def test_a_stale_company_is_held_back_until_the_backoff_runs_out():
    coverage, ctx, _ = stale_twice()

    assert coverage.consecutive_misses(ctx)[KRS] == ("2026-07-10", 2)
    assert coverage.krs_to_rescrape(ctx, date(2026, 7, 20)) == []
    assert coverage.krs_to_rescrape(ctx, date(2026, 7, 24)) == [KRS]


def test_a_company_that_caught_up_is_not_queued_again():
    coverage, ctx, _ = build_coverage(
        {
            connections_blob(KRS, "2026-07-01"): [entry("Kowal", "Małgorzata")],
            connections_blob(KRS, "2026-07-10"): [
                entry("Kowal", "Małgorzata"),
                entry("Nowak", "Adam"),
            ],
        },
        {KRS: {"2026-06-05": BOARD}},
        SPAN,
    )

    assert coverage.consecutive_misses(ctx) == {}
    assert coverage.krs_to_rescrape(ctx, date(2027, 1, 1)) == []
