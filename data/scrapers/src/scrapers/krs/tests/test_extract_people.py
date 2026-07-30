"""What `extract_people` makes of a company crawled more than once."""

import json

import pytest

from scrapers.krs.list import extract_people
from scrapers.stores import Context, ProcessPolicy
from scrapers.stores.file import DownloadableFile
from scrapers.test_tree import MockIO, MockNLP, MockRejestrIO, MockUtils, MockWeb

BUCKET = "gs://koryta-pl-crawled"


# One person, one supervisory board seat that began in 2007.
def seat(start: str, end: str | None) -> dict:
    return {
        "typ": "osoba",
        "id": 911114,
        "tozsamosc": {
            "imie": "Marek",
            "nazwisko": "Staniszewski",
            "imiona_i_nazwisko": "Marek Staniszewski",
            "data_urodzenia": "1958-04-11",
        },
        "krs_powiazania_kwerendowane": [
            {"typ": "KRS_SUPERVISION", "data_start": start, "data_koniec": end}
        ],
    }


class FakeFile:
    def __init__(self, content: str):
        self.content = content

    def read_string(self) -> str:
        return self.content


class BucketIO(MockIO):
    """Serves a fixed set of blobs, so a listing can be crawl-dated at will."""

    def __init__(self, blobs: dict[str, list]):
        self.blobs = blobs
        self.read: list[str] = []

    def list_files(self, path):
        for name in self.blobs:
            yield DownloadableFile(f"{BUCKET}/{name}")

    def read_data(self, fs):
        name = fs.url.removeprefix(f"{BUCKET}/")
        self.read.append(name)
        return FakeFile(json.dumps(self.blobs[name]))


@pytest.fixture
def context():
    def build(blobs: dict[str, list]) -> tuple[Context, BucketIO]:
        io = BucketIO(blobs)
        return (
            Context(
                io=io,
                rejestr_io=MockRejestrIO(),
                con=None,  # type: ignore[arg-type]
                utils=MockUtils(),
                web=MockWeb(),
                nlp=MockNLP(),
                refresh_policy=ProcessPolicy.with_default(),
            ),
            io,
        )

    return build


def connections(krs: str, aktualnosc: str, date: str) -> str:
    return (
        f"hostname=rejestr.io/api/v2/org/{krs}/krs-powiazania"
        f"/aktualnosc_{aktualnosc}/date={date}"
    )


def test_one_seat_crawled_four_times_is_one_row(context):
    """The bug this guards: four crawls used to mean four spells of employment.

    Each crawl keeps its own blob, and the seat looks different in each - open
    while it was held, closed once it ended - so reading them all reported one
    person as both still on the board and long gone.
    """
    ctx, _ = context(
        {
            connections("0000030563", "aktualne", "2026-02-13"): [
                seat("2007-10-16", None)
            ],
            connections("0000030563", "aktualne", "2026-05-27"): [
                seat("2007-10-16", None)
            ],
            connections("0000030563", "aktualne", "2026-07-19"): [
                seat("2007-10-16", "2026-07-07")
            ],
        }
    )

    people = extract_people(ctx)

    assert len(people) == 1
    assert people.iloc[0]["employed_start"] == "2007-10-16"
    assert people.iloc[0]["employed_end"] == "2026-07-07"


def test_only_the_newest_crawl_is_downloaded(context):
    """Egress is billed per GB, so the superseded crawls are not fetched."""
    ctx, io = context(
        {
            connections("0000030563", "aktualne", "2026-02-13"): [
                seat("2007-10-16", None)
            ],
            connections("0000030563", "aktualne", "2026-07-19"): [
                seat("2007-10-16", "2026-07-07")
            ],
        }
    )

    extract_people(ctx)

    assert io.read == [connections("0000030563", "aktualne", "2026-07-19")]


def test_current_and_historical_seats_are_both_kept(context):
    """A past seat and a present one at the same company are two real spells."""
    ctx, _ = context(
        {
            connections("0000030563", "aktualne", "2026-07-19"): [
                seat("2020-01-01", None)
            ],
            connections("0000030563", "historyczne", "2026-07-19"): [
                seat("2007-10-16", "2011-06-30")
            ],
        }
    )

    people = extract_people(ctx)

    assert sorted(people["employed_start"]) == ["2007-10-16", "2020-01-01"]


def test_blobs_that_are_not_connection_queries_are_never_downloaded(context):
    """The `aktualnosc_` filter used to run after the download, not before."""
    ctx, io = context(
        {
            "hostname=rejestr.io/api/v2/org/0000030563/date=2026-07-19": [],
            connections("0000030563", "aktualne", "2026-07-19"): [
                seat("2007-10-16", None)
            ],
        }
    )

    extract_people(ctx)

    assert io.read == [connections("0000030563", "aktualne", "2026-07-19")]
