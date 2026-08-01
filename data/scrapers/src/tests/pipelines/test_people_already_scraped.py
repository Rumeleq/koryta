"""A person already in the bucket must not be queried again.

Each rejestr.io call costs, and a person's krs-powiazania is fetched once and
never refreshed, so anything these tests miss is paid for on every run.
"""

import typing

import pandas as pd
import pytest

from entities.person import RejestrIOKey
from scrapers.krs.scrape import (
    QueryType,
    get_osoby_scraped,
    save_org_connections,
)
from scrapers.stores import CloudStorage, DataRef
from scrapers.stores.file import DownloadableFile
from scrapers.tests.mocks import MockIO, get_test_context

BUCKET = "gs://koryta-pl-crawled"


def person_blob(person_id: str, aktualnosc: str, date: str) -> str:
    return (
        f"{BUCKET}/hostname=rejestr.io/api/v2/osoby/{person_id}"
        f"/krs-powiazania/{aktualnosc}/date={date}"
    )


class ListingMockIO(MockIO):
    """MockIO that lists a fixed set of blobs under any CloudStorage prefix."""

    def __init__(self, urls: list[str]):
        super().__init__()
        self.urls = urls

    def list_files(self, path: DataRef) -> typing.Iterable[DataRef]:
        if isinstance(path, CloudStorage):
            for url in self.urls:
                yield DownloadableFile(url)
            return
        yield from super().list_files(path)


def context_listing(urls: list[str]):
    ctx = get_test_context()
    ctx.io = ListingMockIO(urls)
    return ctx


def empty_krs_frame(columns: list[str]) -> pd.DataFrame:
    return pd.DataFrame({column: pd.Series(dtype=str) for column in columns})


def queries_for_people(
    people: list[RejestrIOKey], already_scraped_people: dict[str, set[QueryType]]
):
    return list(
        save_org_connections(
            already_scraped_krs=empty_krs_frame(["krs", "method", "date"]),
            needs_refresh_krs=empty_krs_frame(["krs", "method", "date", "update_date"]),
            already_scraped_people=already_scraped_people,
            connections=[],
            names=[],
            people=people,
        )
    )


def test_records_the_person_endpoints_not_the_org_ones():
    """The two enums differ by one word, and mixing them up costs money.

    save_org_connections filters person queries against REJESTRIO_OSOBY_*, so
    recording a person's scrape under REJESTRIO_ORG_* matches nothing and the
    person is fetched again on the next run.
    """
    ctx = context_listing(
        [
            person_blob("63271", "aktualnosc_aktualne", "2026-07-19"),
            person_blob("63271", "aktualnosc_historyczne", "2026-07-19"),
        ]
    )

    assert get_osoby_scraped(ctx) == {
        "63271": {
            QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE,
            QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_HISTORYCZNE,
        }
    }


def test_repeated_scrapes_of_one_person_collapse():
    ctx = context_listing(
        [
            person_blob("1029957", "aktualnosc_aktualne", date)
            for date in ["2026-05-27", "2026-07-02", "2026-07-14"]
        ]
    )

    assert get_osoby_scraped(ctx) == {
        "1029957": {QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE}
    }


@pytest.mark.parametrize(
    "url",
    [
        f"{BUCKET}/hostname=rejestr.io/api/v2/org/0000062694/date=2026-07-19",
        f"{BUCKET}/hostname=rejestr.io/api/v2/org/0000062694"
        "/krs-powiazania/aktualnosc_aktualne/date=2026-07-19",
        # The older layout, which puts the date before the path.
        f"{BUCKET}/hostname=rejestr.io/date=2025-09-28/api/v2/org/0000002251",
        # A batch upload, which is a tarball rather than one response.
        f"{BUCKET}/hostname=rejestr.io/date=2025-09-28/uid_068f.tar.gz",
        # A crawled page rather than an API response.
        f"{BUCKET}/hostname=rejestr.io/osoby/63271-jan-kowalski/date=2026-07-19",
    ],
)
def test_ignores_blobs_that_are_not_person_endpoints(url):
    assert get_osoby_scraped(context_listing([url])) == {}


def test_unrecognised_person_endpoint_is_loud():
    """Silently skipping one would mean paying for it again every run."""
    ctx = context_listing(
        [
            f"{BUCKET}/hostname=rejestr.io/api/v2/osoby/63271"
            "/krs-powiazania/aktualnosc_wszystkie/date=2026-07-19"
        ]
    )

    with pytest.raises(ValueError, match="Unknown url"):
        get_osoby_scraped(ctx)


def test_fully_scraped_person_is_not_queried_again():
    queries = queries_for_people(
        [RejestrIOKey(id="63271")],
        {
            "63271": {
                QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE,
                QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_HISTORYCZNE,
            }
        },
    )

    assert queries == []


def test_only_the_missing_endpoint_is_queried():
    queries = queries_for_people(
        [RejestrIOKey(id="63271")],
        {"63271": {QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE}},
    )

    assert [url for query in queries for url in query.urls()] == [
        "https://rejestr.io/api/v2/osoby/63271/krs-powiazania?aktualnosc=historyczne"
    ]


def test_unscraped_person_is_queried_on_both_endpoints():
    queries = queries_for_people([RejestrIOKey(id="63271")], {})

    assert [url for query in queries for url in query.urls()] == [
        "https://rejestr.io/api/v2/osoby/63271/krs-powiazania?aktualnosc=aktualne",
        "https://rejestr.io/api/v2/osoby/63271/krs-powiazania?aktualnosc=historyczne",
    ]


def test_a_person_in_the_bucket_is_dropped_end_to_end():
    """The two halves have to agree on the QueryType, so join them up here.

    Each half on its own looks right; the bug was that get_osoby_scraped
    recorded a vocabulary save_org_connections never asks about.
    """
    ctx = context_listing(
        [
            person_blob("63271", "aktualnosc_aktualne", "2026-07-19"),
            person_blob("63271", "aktualnosc_historyczne", "2026-07-19"),
            person_blob("2018700", "aktualnosc_aktualne", "2026-07-19"),
        ]
    )

    queries = queries_for_people(
        [RejestrIOKey(id="63271"), RejestrIOKey(id="2018700")],
        get_osoby_scraped(ctx),
    )

    assert [url for query in queries for url in query.urls()] == [
        "https://rejestr.io/api/v2/osoby/2018700/krs-powiazania?aktualnosc=historyczne"
    ]


def test_person_ids_match_whatever_pandas_made_of_the_column():
    """people_to_scrape builds keys from pipeline output, the bucket has strings."""
    queries = queries_for_people(
        [RejestrIOKey(id=63271)],  # type: ignore[arg-type]
        {
            "63271": {
                QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE,
                QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_HISTORYCZNE,
            }
        },
    )

    assert queries == []
