"""Addressing the search API, and recognising what came back from it."""

from scrapers.msig import api

BUCKET = "gs://koryta-pl-crawled"
DETAILS = (
    f"{BUCKET}/hostname={api.HOSTNAME}/api/Monitor/Detalis/?Id=6313508"
    "/date=2026-08-12"
)
SEARCH = (
    f"{BUCKET}/hostname={api.HOSTNAME}/api/Monitor/Search"
    "/?from=2001-01-01/?krs=0000019193/?page=1/?signatureType=B"
    "/?to=2026-08-12/date=2026-08-12"
)


def test_search_url_carries_both_mandatory_parameters():
    """Without signatureType or the dates the API answers 444."""
    url = api.search_url("0000019193", "2001-01-01", "2026-08-12", 3)
    assert "signatureType=B" in url
    assert "from=2001-01-01" in url and "to=2026-08-12" in url
    assert url.endswith("page=3")


def test_details_url_keeps_the_servers_spelling():
    assert api.details_url(6313508).endswith("/Monitor/Detalis?Id=6313508")


def test_a_details_blob_is_told_from_a_search_one():
    assert api.is_details_blob(DETAILS) and not api.is_search_blob(DETAILS)
    assert api.is_search_blob(SEARCH) and not api.is_details_blob(SEARCH)


def test_the_announcement_id_is_read_back_off_the_blob_path():
    assert api.announcement_id_of(DETAILS) == "6313508"
    assert api.announcement_id_of(SEARCH) is None


def test_the_swept_krs_is_read_back_off_the_blob_path():
    assert api.searched_krs_of(SEARCH) == "0000019193"
    assert api.searched_krs_of(DETAILS) is None


def test_announcement_ids_come_back_as_strings():
    page = {"countPages": 100, "page": 1, "list": [{"id": 1}, {"id": 2}, {}]}
    assert api.announcement_ids(page) == ["1", "2"]
