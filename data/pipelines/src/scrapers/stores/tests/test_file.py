from scrapers.stores.file import DownloadableFile, latest_crawls, split_crawl_date

BUCKET = "gs://koryta-pl-crawled"


def blob(path: str) -> DownloadableFile:
    return DownloadableFile(f"{BUCKET}/{path}")


def urls(refs: list[DownloadableFile]) -> list[str]:
    return [ref.url.removeprefix(f"{BUCKET}/") for ref in refs]


def keep_newest(paths: list[str]) -> list[str]:
    return urls(latest_crawls([blob(p) for p in paths], lambda ref: ref.url))


def test_the_date_segment_is_found_wherever_it_sits():
    """Both layouts the bucket has used name the same object."""
    trailing, _ = split_crawl_date(
        "hostname=rejestr.io/api/v2/org/0000022006/krs-powiazania"
        "/aktualnosc_aktualne/date=2026-07-02"
    )
    leading, _ = split_crawl_date(
        "hostname=rejestr.io/date=2025-09-29/api/v2/org/0000022006"
        "/krs-powiazania/aktualnosc_aktualne"
    )
    assert trailing == leading


def test_a_path_without_a_date_is_left_alone():
    assert split_crawl_date("hostname=rejestr.io/api/v2/org/0000022006") == (
        "hostname=rejestr.io/api/v2/org/0000022006",
        "",
    )


def test_only_the_last_crawl_of_a_query_is_kept():
    assert keep_newest(
        [
            "hostname=rejestr.io/api/v2/org/0000030563/krs-powiazania"
            "/aktualnosc_aktualne/date=2026-02-13",
            "hostname=rejestr.io/api/v2/org/0000030563/krs-powiazania"
            "/aktualnosc_aktualne/date=2026-07-19",
            "hostname=rejestr.io/api/v2/org/0000030563/krs-powiazania"
            "/aktualnosc_aktualne/date=2026-05-27",
        ]
    ) == [
        "hostname=rejestr.io/api/v2/org/0000030563/krs-powiazania"
        "/aktualnosc_aktualne/date=2026-07-19"
    ]


def test_the_two_layouts_are_one_object_and_the_newer_wins():
    """The move of the `date=` segment must not read as two different objects."""
    assert keep_newest(
        [
            "hostname=rejestr.io/date=2025-09-29/api/v2/org/0000022006"
            "/krs-powiazania/aktualnosc_aktualne",
            "hostname=rejestr.io/api/v2/org/0000022006/krs-powiazania"
            "/aktualnosc_aktualne/date=2026-07-02",
        ]
    ) == [
        "hostname=rejestr.io/api/v2/org/0000022006/krs-powiazania"
        "/aktualnosc_aktualne/date=2026-07-02"
    ]


def test_current_and_historical_connections_are_different_queries():
    """Both are wanted: one says who sits on the board, the other who used to."""
    paths = [
        "hostname=rejestr.io/api/v2/org/0000030563/krs-powiazania"
        "/aktualnosc_aktualne/date=2026-07-19",
        "hostname=rejestr.io/api/v2/org/0000030563/krs-powiazania"
        "/aktualnosc_historyczne/date=2026-07-19",
    ]
    assert keep_newest(paths) == paths


def test_different_companies_are_not_collapsed():
    paths = [
        "hostname=rejestr.io/api/v2/org/0000030563/krs-powiazania"
        "/aktualnosc_aktualne/date=2026-07-19",
        "hostname=rejestr.io/api/v2/org/0000525130/krs-powiazania"
        "/aktualnosc_aktualne/date=2026-02-13",
    ]
    assert keep_newest(paths) == paths


def test_an_undated_blob_loses_to_a_dated_one():
    """An undated crawl is the oldest layout there is, not the newest crawl."""
    assert keep_newest(
        [
            "hostname=rejestr.io/api/v2/org/0000022006/krs-powiazania"
            "/aktualnosc_aktualne/date=2026-07-02",
            "hostname=rejestr.io/api/v2/org/0000022006/krs-powiazania"
            "/aktualnosc_aktualne",
        ]
    ) == [
        "hostname=rejestr.io/api/v2/org/0000022006/krs-powiazania"
        "/aktualnosc_aktualne/date=2026-07-02"
    ]


def test_listing_order_survives():
    """Callers iterate a listing; keep giving them one."""
    assert keep_newest(
        [
            "hostname=rejestr.io/api/v2/org/0000000001/x/date=2026-01-01",
            "hostname=rejestr.io/api/v2/org/0000000002/x/date=2026-01-01",
            "hostname=rejestr.io/api/v2/org/0000000001/x/date=2026-06-01",
            "hostname=rejestr.io/api/v2/org/0000000003/x/date=2026-01-01",
        ]
    ) == [
        "hostname=rejestr.io/api/v2/org/0000000001/x/date=2026-06-01",
        "hostname=rejestr.io/api/v2/org/0000000002/x/date=2026-01-01",
        "hostname=rejestr.io/api/v2/org/0000000003/x/date=2026-01-01",
    ]
