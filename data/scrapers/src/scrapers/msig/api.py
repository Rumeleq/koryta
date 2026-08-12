"""Addressing the Monitor Sądowy i Gospodarczy search API.

`wyszukiwarka-msig.ms.gov.pl` is an Angular app over a REST API the Ministry
never documented and never announced: no key, no captcha, no rate limit. It is
the only free source that still spells out who sits on a company's board --
`api-krs.ms.gov.pl` masks every name down to its first letter, and the
unmasked "Full API" needs a decision from the Minister of Justice.

What the app calls, and what this module builds URLs for:

* ``/api/Monitor/Search`` -- one page of announcements, 50 per page. Paging
  runs until a page comes back empty; ``countPages`` is always 100 and means
  nothing.
* ``/api/Monitor/Detalis`` -- one announcement in full. Spelled with that typo
  server-side, so it is spelled with that typo here.

Two of its parameters are load-bearing:

``signatureType``
    Mandatory. Omitting it is a 444 with the body ``"Typ syng./sprawy -
    Wartość domyślna: A i B"``, which reads like a default and is not one.
    ``B`` is the KRS-signature index -- the entries this scraper is after.
    ``A`` is case signatures, a few a day, and mostly not KRS entries.

``from``/``to``
    Also mandatory, also a 444 without them. There is no "all dates" spelling,
    hence :data:`EARLIEST_PUBLICATION`.

Do not reach for ``SearchCount``: it disagrees with ``Search``. For
2024-02-05 it answers 81 where paging returns 4000 distinct announcements, all
published that day. Page until empty instead.
"""

import typing

#: The hostname everything crawled from here is filed under in the bucket.
HOSTNAME = "wyszukiwarka-msig.ms.gov.pl"

#: Discovered at runtime by the app from ``/home/getapiurl``, which has
#: answered with this constant since the search went up.
API_ROOT = f"https://{HOSTNAME}/api"

#: Fixed server-side. A page carrying fewer means the results ran out.
PAGE_SIZE = 50

#: ``B`` is the KRS-signature index. See the module docstring.
SIGNATURE_TYPE_KRS = "B"

#: MSiG's own archive starts here; the first KRS entry it holds is from 2001.
EARLIEST_PUBLICATION = "2001-01-01"


def search_url(krs: str, date_from: str, date_to: str, page: int) -> str:
    """One page of the KRS entries published for `krs` between two dates."""
    return (
        f"{API_ROOT}/Monitor/Search"
        f"?krs={krs}"
        f"&signatureType={SIGNATURE_TYPE_KRS}"
        f"&from={date_from}&to={date_to}&page={page}"
    )


def details_url(announcement_id: int | str) -> str:
    """One announcement in full, text included."""
    return f"{API_ROOT}/Monitor/Detalis?Id={announcement_id}"


#: How `Storage.upload`/`batch_upload` spell a query parameter once it has
#: folded it into the object path: one ``/?key=value`` segment per parameter,
#: sorted by key. Recognising a blob means looking for these, not for the URL.
_QUERY_SEGMENT = "/?"


def _query_of(blob_name: str) -> dict[str, str]:
    """The query parameters folded into a crawled object's path."""
    query = {}
    for segment in blob_name.split(_QUERY_SEGMENT)[1:]:
        pair = segment.split("/")[0]
        key, _, value = pair.partition("=")
        query[key] = value
    return query


def is_details_blob(blob_name: str) -> bool:
    """Whether a crawled object holds one announcement's full text."""
    return "/Monitor/Detalis" in blob_name


def is_search_blob(blob_name: str) -> bool:
    """Whether a crawled object holds one page of search results."""
    return "/Monitor/Search" in blob_name


def announcement_id_of(blob_name: str) -> str | None:
    """The announcement id a details object was fetched for."""
    if not is_details_blob(blob_name):
        return None
    return _query_of(blob_name).get("Id")


def searched_krs_of(blob_name: str) -> str | None:
    """The KRS number a search page was fetched for."""
    if not is_search_blob(blob_name):
        return None
    return _query_of(blob_name).get("krs")


class SearchPage(typing.TypedDict):
    """What ``/Monitor/Search`` answers with."""

    countPages: int
    page: int
    list: list[dict]


def announcement_ids(page: SearchPage | dict) -> list[str]:
    """The announcement ids on one search page, in the order given."""
    return [str(row["id"]) for row in page.get("list", []) if row.get("id")]
