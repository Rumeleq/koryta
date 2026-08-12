"""The pipelines over the crawled Monitor Sądowy i Gospodarczy announcements.

`PeopleMSiG` is the one this source exists for. Every other feed the project
has free access to gives people masked -- `A*** K******`, PESEL `8**********`
-- because the open KRS API is required to. The Monitor published the entries
in full, and went on doing so until the obligation to publish them was
repealed, so this is a complete history to that point and nothing after it.
See `data/scrapers/README.md` for what that means for coverage.

`CompanyMSiG` is the by-product: the same announcements state the company's
name, REGON and seat, which is worth keeping if only to check a KRS number
resolves to the company we think it does.

Both read the bucket, never the network. `msig_scraper.py` does the crawling.
"""

import collections
import dataclasses
import json
import typing

from pandas import DataFrame

from entities.company import Company, Source
from entities.person import MSiG as MSiGPerson
from scrapers.krs.list import get_teryt
from scrapers.map.postal_codes import PostalCodes
from scrapers.msig import api
from scrapers.msig.companies import Identity, clean_name, identity_in
from scrapers.msig.entries import Body, parse_body
from scrapers.msig.people import people_in
from scrapers.stores import CloudStorage, Context, Pipeline


@dataclasses.dataclass(frozen=True)
class Announcement:
    """One crawled ``/Monitor/Detalis`` response."""

    announcement_id: str
    krs: str | None
    entity_name: str | None
    nip: str | None
    monitor_number: str | None
    publication_date: str | None
    chapter: str | None
    body: str | None

    @staticmethod
    def parse(blob_name: str, data: dict) -> "Announcement | None":
        krs = data.get("krs")
        announcement_id = api.announcement_id_of(blob_name) or str(data.get("id") or "")
        if not announcement_id:
            return None
        published = data.get("dateOfPublication")
        return Announcement(
            announcement_id=announcement_id,
            # Zero-padded the way every other KRS number in this project is;
            # the Monitor already pads them, but a stray unpadded one would
            # otherwise be a company of its own downstream.
            krs=str(krs).zfill(10) if krs else None,
            entity_name=clean_name(data.get("entityName")),
            nip=str(data["nip"]) if data.get("nip") else None,
            monitor_number=data.get("monitorNumber"),
            publication_date=str(published)[:10] if published else None,
            chapter=data.get("chapterName"),
            body=data.get("textInBody"),
        )

    @property
    def parsed(self) -> Body:
        return parse_body(self.body)


def read_announcements(ctx: Context) -> typing.Iterator[Announcement]:
    """Every announcement in the bucket, each one once.

    The crawl writes one object per announcement under its own ``date=``, so a
    re-crawl of a company that was swept before leaves two copies of each of
    its announcements. Unlike a KRS snapshot the two cannot disagree -- an
    announcement is a fixed historical document -- so the first copy read
    wins and the rest are skipped without being parsed.
    """
    seen: set[str] = set()
    skipped_empty = 0

    for blob_name, blob in ctx.io.read_many(
        CloudStorage(prefix=f"hostname={api.HOSTNAME}")
    ):
        if not api.is_details_blob(blob_name):
            continue
        announcement_id = api.announcement_id_of(blob_name)
        if announcement_id and announcement_id in seen:
            continue

        content = blob.read_string()
        if not content:
            # A fetch that failed, recorded as an empty object so the crawl
            # does not retry it forever. Nothing to read.
            skipped_empty += 1
            continue
        try:
            data = json.loads(content)
        except json.JSONDecodeError as error:
            print(f"  [ERROR] Could not parse {blob_name}: {error}")
            continue

        announcement = Announcement.parse(blob_name, data)
        if announcement is None:
            continue
        seen.add(announcement.announcement_id)
        yield announcement

    print(f"MSiG: read {len(seen)} announcements, {skipped_empty} empty objects")


class PeopleMSiG(Pipeline[MSiGPerson]):
    """One row per person per KRS entry that named them."""

    filename = "person_msig"
    # Identifiers with significant leading zeros, and a PESEL is 11 digits of
    # them -- read back as a number, "0912..." loses its zero and every one of
    # them gains a ".0".
    dtype = {"krs": str, "pesel": str, "announcement_id": str, "monitor_number": str}

    @property
    def output_class(self) -> type:
        return MSiGPerson

    def process(self, ctx: Context) -> DataFrame:
        unclassified: typing.Counter[str] = collections.Counter()
        rows: list[MSiGPerson] = []
        without_krs = 0

        for announcement in read_announcements(ctx):
            if not announcement.krs:
                without_krs += 1
                continue
            body = announcement.parsed
            for person in people_in(body.entries, unclassified):
                rows.append(
                    MSiGPerson(
                        krs=announcement.krs,
                        last_name=person.last_name,
                        first_names=person.first_names,
                        full_name=person.full_name,
                        pesel=person.pesel,
                        role=person.role,
                        action=person.action.value,
                        entry_date=body.entry_date,
                        publication_date=announcement.publication_date,
                        announcement_id=announcement.announcement_id,
                        monitor_number=announcement.monitor_number,
                        position=person.position,
                        dzial=person.dzial,
                        rubryka=person.rubryka,
                    )
                )

        if without_krs:
            print(f"MSiG: {without_krs} announcements carried no KRS number")
        if unclassified:
            # A rubryka that holds people and that `people.py` does not
            # classify is a kind of post nobody has taught it about. Dropping
            # it is the safe reading; doing so quietly is not.
            print("MSiG: unclassified rubryki holding names:")
            for rubryka, count in unclassified.most_common(20):
                print(f"  {count:6d}  {rubryka}")

        print(f"MSiG: {len(rows)} people rows")
        return DataFrame.from_records([dataclasses.asdict(row) for row in rows])


class CompanyMSiG(Pipeline[Company]):
    """One row per company the crawl covered, as its announcements describe it."""

    filename = "company_msig"
    dtype = {"krs": str, "nip": str, "regon": str}

    postal_codes: PostalCodes

    @property
    def output_class(self) -> type:
        return Company

    def process(self, ctx: Context) -> DataFrame:
        postal_codes = self.postal_codes.read_or_process(ctx)

        # Newest announcement first per company, so `Identity.merge` keeps the
        # newest statement of each field. Held in memory rather than streamed
        # because the announcements arrive in bucket order, not in date order.
        latest: dict[str, tuple[str, str | None, str | None]] = {}
        identities: dict[str, list[tuple[str, Identity]]] = {}

        for announcement in read_announcements(ctx):
            if not announcement.krs:
                continue
            published = announcement.publication_date or ""
            seen = latest.get(announcement.krs)
            if seen is None or published >= seen[0]:
                latest[announcement.krs] = (
                    published,
                    announcement.entity_name,
                    announcement.nip,
                )
            identity = identity_in(announcement.parsed.entries)
            if identity != Identity():
                identities.setdefault(announcement.krs, []).append(
                    (published, identity)
                )

        companies = []
        for krs, (_, entity_name, nip) in latest.items():
            identity = Identity()
            for _, stated in sorted(identities.get(krs, []), reverse=True):
                identity = identity.merge(stated)

            city = (identity.city or "").lower()
            companies.append(
                Company(
                    krs=krs,
                    name=identity.name or entity_name,
                    city=city or None,
                    teryt_code=(
                        get_teryt(postal_codes, city, identity.postal_code)
                        if city
                        else None
                    ),
                    nip=nip,
                    regon=identity.regon,
                    sources=[Source(source="msig", source_krs=krs)],
                )
            )

        print(f"MSiG: {len(companies)} companies")
        return DataFrame.from_records(
            [dataclasses.asdict(company) for company in companies]
        )


@dataclasses.dataclass(frozen=True)
class Crawled:
    """One object the MSiG crawl has already written."""

    kind: typing.Literal["search", "details"]
    krs: str | None
    announcement_id: str | None


class MSiGCrawled(Pipeline[Crawled]):
    """What the sweep has fetched so far, so it can be resumed.

    Read from the bucket rather than from a local ledger: the sweep runs for
    hours and may run on more than one machine, and the bucket is the only
    thing that knows what actually landed.
    """

    filename = "msig_crawled"
    dtype = {"krs": str, "announcement_id": str}
    # One row per fetched object -- hundreds of thousands of them, rebuilt
    # from the bucket in minutes. Not worth a slot in the shared cache.
    backup_to_shared_cache = False

    @property
    def output_class(self) -> type:
        return Crawled

    def process(self, ctx: Context) -> DataFrame:
        rows: list[Crawled] = []
        for blob_name, _ in ctx.io.read_many(
            CloudStorage(prefix=f"hostname={api.HOSTNAME}")
        ):
            if api.is_details_blob(blob_name):
                rows.append(
                    Crawled(
                        kind="details",
                        krs=None,
                        announcement_id=api.announcement_id_of(blob_name),
                    )
                )
            elif api.is_search_blob(blob_name):
                rows.append(
                    Crawled(
                        kind="search",
                        krs=api.searched_krs_of(blob_name),
                        announcement_id=None,
                    )
                )
        print(f"MSiG: {len(rows)} objects already crawled")
        return DataFrame.from_records([dataclasses.asdict(row) for row in rows])

    def already_crawled(self, ctx: Context) -> tuple[set[str], set[str]]:
        """The KRS numbers swept and the announcement ids fetched."""
        frame = self.read_or_process(ctx)
        if frame is None or frame.empty:
            return set(), set()
        searched = frame[frame["kind"] == "search"]["krs"].dropna()
        fetched = frame[frame["kind"] == "details"]["announcement_id"].dropna()
        return set(searched.astype(str)), set(fetched.astype(str))
