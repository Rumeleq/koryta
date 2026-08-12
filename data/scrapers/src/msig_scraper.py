"""The one-time sweep of the Monitor Sądowy i Gospodarczy.

Company by company rather than day by day, which is the difference between a
crawl that finishes and one that does not. A single publication day carries
around 4000 KRS entries -- the whole Monitor is tens of millions of them --
whereas the companies this project follows have a few dozen each, and those
are the only ones whose boards anybody here is going to look up. Sweeping the
~30k companies `CompaniesKRS` already knows is on the order of half a million
requests: long, but a weekend rather than a month.

Nothing here is incremental by design. KRS entries stopped being published in
the Monitor at the turn of 2026, when the obligation to publish them was
repealed, so what this collects is a closed archive: 2001 to late 2025, and
nothing after. Re-run it for companies discovered since, not for new entries.

Storage is one tar.gz per hostname per day in the crawled bucket, via
`--batch_upload` -- half a million 5 KB objects would otherwise be half a
million GCS operations to write and, worse, to read back.

    uv run koryta_scrape_msig --limit 20        # try it on twenty companies
    uv run koryta_scrape_msig                   # the sweep

It resumes: `MSiGCrawled` lists what is already in the bucket, and companies
whose search pages are there are skipped along with announcements already
fetched. Refresh it (`--refresh MSiGCrawled`) when resuming a run that a
previous invocation extended.
"""

import argparse
import concurrent.futures
import datetime
import json
import threading
import typing
from dataclasses import dataclass

import requests
from tqdm import tqdm

from conductor import setup_context
from scrapers.krs.list import CompaniesKRS
from scrapers.msig import api
from scrapers.msig.list import MSiGCrawled
from scrapers.stores import Context, ProcessPolicy

#: Who we are, so the Ministry can see it in their logs and block us by name
#: if this is more traffic than they want.
USER_AGENT = "koryta.pl-pipeline/1.0 (+https://koryta.pl; kontakt@koryta.pl)"

#: The search 444s on a malformed request rather than 4xx-ing usefully, so a
#: retry storm buys nothing. Three attempts, then give up on that request.
ATTEMPTS = 3

#: A page returning fewer than this many rows is the last page.
_FULL_PAGE = api.PAGE_SIZE


@dataclass
class Args:
    krs: list[str]
    date_from: str
    date_to: str
    workers: int
    sleep: float
    limit: int | None
    resume: bool
    dry_run: bool


def parse_args() -> Args:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--krs",
        action="append",
        default=[],
        help="Sweep only this KRS number. Repeatable. Defaults to every "
        "company CompaniesKRS knows.",
    )
    parser.add_argument("--date-from", default=api.EARLIEST_PUBLICATION)
    parser.add_argument(
        "--date-to", default=datetime.date.today().isoformat()
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Companies swept at once. Each one is sequential within itself.",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.25,
        help="Pause after each request, per worker.",
    )
    parser.add_argument("--limit", type=int, help="Stop after this many companies.")
    parser.add_argument(
        "--no-resume",
        dest="resume",
        action="store_false",
        help="Re-fetch companies and announcements already in the bucket.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be swept and fetch nothing.",
    )
    parsed, _ = parser.parse_known_args()
    return Args(
        krs=[str(krs).zfill(10) for krs in parsed.krs],
        date_from=parsed.date_from,
        date_to=parsed.date_to,
        workers=parsed.workers,
        sleep=parsed.sleep,
        limit=parsed.limit,
        resume=parsed.resume,
        dry_run=parsed.dry_run,
    )


class Session:
    """A requests session per thread, with the retry policy in one place."""

    def __init__(self, sleep: float) -> None:
        self._sleep = sleep
        self._local = threading.local()

    @property
    def _session(self) -> requests.Session:
        session = getattr(self._local, "session", None)
        if session is None:
            session = requests.Session()
            session.headers["User-Agent"] = USER_AGENT
            session.headers["Accept"] = "application/json"
            self._local.session = session
        return session

    def get_json(self, url: str) -> typing.Any | None:
        """The JSON at `url`, or None once the attempts are used up."""
        for attempt in range(ATTEMPTS):
            try:
                response = self._session.get(url, timeout=60)
                response.raise_for_status()
                return response.json()
            except (requests.RequestException, json.JSONDecodeError) as error:
                if attempt == ATTEMPTS - 1:
                    print(f"  [ERROR] {url}: {error}")
                    return None
                threading.Event().wait(2**attempt)
            finally:
                threading.Event().wait(self._sleep)
        return None


def companies_to_sweep(ctx: Context, args: Args) -> list[str]:
    """The KRS numbers this run covers, newest-known first."""
    if args.krs:
        return args.krs
    frame = CompaniesKRS().read_or_process(ctx)
    return sorted({str(krs).zfill(10) for krs in frame["krs"].dropna()})


def sweep_company(
    ctx: Context,
    session: Session,
    krs: str,
    args: Args,
    fetched: set[str],
) -> tuple[int, int]:
    """Fetch one company's announcements. Returns (found, newly fetched)."""
    announcement_ids: list[str] = []
    page = 1
    while True:
        url = api.search_url(krs, args.date_from, args.date_to, page)
        results = session.get_json(url)
        if results is None:
            # Paging stops at the first page we could not read: going on would
            # leave a hole in the middle of this company's history and record
            # the company as swept anyway.
            print(f"  [WARN] {krs}: giving up at page {page}")
            return len(announcement_ids), 0
        ctx.io.batch_upload(
            url, json.dumps(results), "application/json",
            include_query=True, verbose=False,
        )
        ids = api.announcement_ids(results)
        announcement_ids.extend(ids)
        if len(ids) < _FULL_PAGE:
            break
        page += 1

    written = 0
    for announcement_id in announcement_ids:
        if announcement_id in fetched:
            continue
        url = api.details_url(announcement_id)
        details = session.get_json(url)
        # An announcement that cannot be read is stored empty rather than
        # skipped, so the next run knows it was tried. The pipelines skip
        # empty objects.
        ctx.io.batch_upload(
            url,
            json.dumps(details) if details is not None else "",
            "application/json",
            include_query=True,
            verbose=False,
        )
        written += 1

    return len(announcement_ids), written


def main() -> None:
    args = parse_args()
    ctx, _ = setup_context(
        policy=ProcessPolicy.with_default(), batch_upload=True
    )

    companies = companies_to_sweep(ctx, args)

    swept: set[str] = set()
    fetched: set[str] = set()
    if args.resume:
        swept, fetched = MSiGCrawled().already_crawled(ctx)
        companies = [krs for krs in companies if krs not in swept]

    if args.limit:
        companies = companies[: args.limit]

    print(
        f"MSiG sweep: {len(companies)} companies, "
        f"{args.date_from} to {args.date_to}, "
        f"{len(swept)} already swept, {len(fetched)} announcements already held"
    )
    if args.dry_run:
        print("Dry run, stopping here. First ten:", companies[:10])
        return

    session = Session(args.sleep)
    found_total, written_total = 0, 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(sweep_company, ctx, session, krs, args, fetched): krs
            for krs in companies
        }
        for future in tqdm(
            concurrent.futures.as_completed(futures),
            total=len(futures),
            desc="Sweeping MSiG",
        ):
            krs = futures[future]
            try:
                found, written = future.result()
            except Exception as error:  # noqa: BLE001 - one company, not the run
                print(f"  [ERROR] {krs}: {error}")
                continue
            found_total += found
            written_total += written

    print(
        f"MSiG sweep done: {found_total} announcements found, "
        f"{written_total} fetched. Flushing batches..."
    )


if __name__ == "__main__":
    main()
