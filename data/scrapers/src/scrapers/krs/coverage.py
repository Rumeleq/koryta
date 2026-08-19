"""Which rejestr.io responses we hold were fetched before rejestr.io caught up.

`KRSNeedsRefresh` decides when to spend money on rejestr.io: a company is
re-queried when the censored people list api-krs serves changes *after* our
last rejestr.io scrape. That rule has a hole at the other end. rejestr.io
mirrors the register with a lag of about four business days, so a scrape run
too soon after a change returns the board as it was, we store it as the
current one, and the next run sees no *further* change and never asks again.
The wrong answer is then permanent, and nothing in the stored response says
so - it carries no as-of date.

This pipeline closes the hole by checking the two sources against each other.
api-krs is free and censors names to an initial and a length; `scrapers.krs.names`
reduces a rejestr.io name to the same signature. A person api-krs listed for a
company, whom the rejestr.io response for that company does not name, is a
person rejestr.io did not know about when we asked.

Two things have to hold for that to mean anything, and both are checked here:

* the rejestr.io response must be no older than the api-krs snapshot, so the
  gap cannot just be a change that happened after we asked rejestr.io;
* the register must not have moved in between, which the KRS bulletin
  (`KRSUpdates`) records for every company on every working day. Without this
  gate, roughly one comparison in five looks stale purely because the board
  genuinely changed between our two observations.

Companies that come out stale go back into the scrape queue with a backoff, so
a company rejestr.io simply has no record of is not re-bought every night.
"""

import json
from dataclasses import dataclass
from datetime import date, timedelta

import pandas as pd
from tqdm import tqdm

from scrapers.krs.censored import KRSCensoredPeople
from scrapers.krs.columns import normalise
from scrapers.krs.names import (
    comparable_people,
    missing_from_response,
    people_in_response,
    phantoms_in_response,
)
from scrapers.krs.updates import KRSUpdates
from scrapers.stores import CloudStorage, Context, Pipeline
from scrapers.stores.file import split_crawl_date

#: The rejestr.io endpoint that answers "who is connected to this company
#: today". The historic one is not comparable: it lists people who have left.
CURRENT_CONNECTIONS_SUFFIX = "krs-powiazania/aktualnosc_aktualne"

#: Where a person's own connections live, as opposed to a company's.
PERSON_CONNECTIONS_MARKER = "/osoby/"

#: How long to wait before re-querying a company whose stored response came
#: back short. rejestr.io needs about four business days to pick a change up
#: (see `analysis/update_rate`), so a retry inside a week buys the same answer
#: at the same price. Each further miss doubles the wait: a company still
#: short after several rounds is not lagging, rejestr.io does not hold the
#: person at all, and there is no date at which asking again would help.
RETRY_BACKOFF_DAYS = (7, 14, 28, 56, 90)


def retry_delay_days(consecutive_misses: int) -> int:
    """How long after a stale scrape to try that company again."""
    if consecutive_misses < 1:
        raise ValueError("a retry delay only applies after a miss")
    index = min(consecutive_misses, len(RETRY_BACKOFF_DAYS)) - 1
    return RETRY_BACKOFF_DAYS[index]


def parse_current_connections_url(url: str) -> tuple[str, str] | None:
    """``(krs, crawl date)`` for a rejestr.io current-connections blob.

    Returns None for every other object under the host - the historic feed,
    the per-person feeds, the company record itself.
    """
    path, crawl_date = split_crawl_date(url)
    if not path.endswith(CURRENT_CONNECTIONS_SUFFIX) or "/org/" not in path:
        return None
    krs = path.split("/org/", 1)[1].split("/", 1)[0]
    if not krs.isdigit():
        return None
    return krs.zfill(10), crawl_date


def nearest(api_dates: list[str], crawl_date: str) -> str | None:
    """The api-krs snapshot closest in time to a rejestr.io response.

    Either side: a snapshot taken after the response still says what the
    register held when we asked, provided the bulletin says nothing moved in
    between - which the caller checks. Restricting to earlier snapshots left a
    third of the responses on file with nothing to compare against.
    """
    if not api_dates:
        return None
    return min(
        api_dates,
        key=lambda day: (
            abs((date.fromisoformat(day) - date.fromisoformat(crawl_date)).days),
            day > crawl_date,
        ),
    )


def days_in(start: str, end: str) -> list[str]:
    """Every day strictly after ``start`` and up to ``end``."""
    first = date.fromisoformat(start) + timedelta(days=1)
    last = date.fromisoformat(end)
    out = []
    while first <= last:
        out.append(first.isoformat())
        first += timedelta(days=1)
    return out


def parse_person_connections_url(url: str) -> tuple[str, str] | None:
    """``(rejestr.io person id, crawl date)`` for a person-connections blob."""
    path, crawl_date = split_crawl_date(url)
    if PERSON_CONNECTIONS_MARKER not in path or "krs-powiazania" not in path:
        return None
    person = path.split(PERSON_CONNECTIONS_MARKER, 1)[1].split("/", 1)[0]
    if not person.isdigit():
        return None
    return person, crawl_date


def companies_behind(response, entry_numbers, fetched: str) -> list[dict]:
    """Companies in a person feed whose register entry had moved past it.

    Every organisation in the feed carries ``krs_wpisy.najnowszy_numer`` -
    rejestr.io's view of how many times the register has written to that entry.
    api-krs publishes the same count as ``numerOstatniegoWpisu``, for free. If
    rejestr.io's is the lower of the two at the moment we bought the feed, it
    had not caught up, and what we bought is the company as it used to be.

    Only api-krs snapshots at or before the fetch count: a snapshot taken later
    may have moved on for reasons the feed could not have known about.
    """
    behind = []
    for entry in response if isinstance(response, list) else []:
        if not isinstance(entry, dict) or entry.get("typ") != "organizacja":
            continue
        krs = str((entry.get("numery") or {}).get("krs") or "").zfill(10)
        theirs = (entry.get("krs_wpisy") or {}).get("najnowszy_numer")
        known = entry_numbers.get(krs) or {}
        earlier = [d for d in sorted(known) if d <= fetched]
        if not krs or theirs is None or not earlier:
            continue
        ours = known[earlier[-1]]
        if int(theirs) < ours:
            behind.append(
                {
                    "krs": krs,
                    "rejestrio_entry_no": int(theirs),
                    "register_entry_no": ours,
                    "api_date": earlier[-1],
                }
            )
    return behind


@dataclass(frozen=True)
class BulletinWindow:
    """Which days the KRS bulletin is on file for, and who it names on them.

    Coverage is per day rather than per range. A day inside the range that was
    never fetched holds a register change nothing here can see, and a company
    absent from a bulletin we do not have reads exactly like a company that did
    not change - so a comparison spanning it would be called conclusive on the
    strength of evidence that is not there. Six days in the middle of the crawl
    are missing, five of them working days.
    """

    days: frozenset[str]
    dates_by_krs: dict[str, list[str]]

    @staticmethod
    def build(updates: pd.DataFrame, days) -> "BulletinWindow":
        by_krs: dict[str, list[str]] = {}
        if not updates.empty:
            dates = updates["date"].astype(str)
            krs = updates["krs"].astype(str).str.zfill(10)
            for company, day in zip(krs, dates):
                by_krs.setdefault(company, []).append(day)
        return BulletinWindow(
            days=frozenset(str(d) for d in days),
            dates_by_krs={k: sorted(set(v)) for k, v in by_krs.items()},
        )

    def covers(self, start: str, end: str) -> bool:
        """Whether every day the register could have moved on is on file.

        An empty span - the two observations on the same day - is covered:
        there is no day in it for the register to have moved on.
        """
        return all(day in self.days for day in days_in(start, end))

    def changed_between(self, krs: str, start: str, end: str) -> bool:
        """Whether the register moved for this company in ``(start, end]``."""
        return any(start < day <= end for day in self.dates_by_krs.get(krs, ()))

    def last_change_before(self, krs: str, day: str) -> str | None:
        earlier = [d for d in self.dates_by_krs.get(krs, ()) if d <= day]
        return earlier[-1] if earlier else None


class RejestrIOCoverage(Pipeline):
    """Every rejestr.io connections response we hold, checked against api-krs.

    One row per (company, rejestr.io crawl date) that has an api-krs snapshot
    to check against. ``n_missing`` counts the people api-krs listed and
    rejestr.io did not name; ``conclusive`` says whether the comparison means
    anything, which it does not when the register moved in between or when the
    bulletin does not cover the span.
    """

    filename = "rejestrio_coverage"
    dtype = {"krs": str}

    censored_people: KRSCensoredPeople
    updates: KRSUpdates

    def _responses(self, ctx: Context):
        """(krs, crawl date) → parsed current-connections response."""
        responses: dict[tuple[str, str], list] = {}
        for name, blob in tqdm(
            ctx.io.read_many(CloudStorage(prefix="hostname=rejestr.io")),
            desc="Reading rejestr.io connections",
        ):
            parsed_url = parse_current_connections_url(name)
            if parsed_url is None:
                continue
            try:
                body = json.loads(blob.read_string())
            except Exception:
                continue
            if isinstance(body, list):
                responses[parsed_url] = body
        return responses

    def process(self, ctx: Context) -> pd.DataFrame:
        snapshots = self.censored_people.snapshots(ctx)
        window = BulletinWindow.build(
            normalise(self.updates.read_or_process(ctx), "date"),
            self.updates.days_crawled(ctx),
        )
        responses = self._responses(ctx)

        rows = []
        for (krs, crawl_date), body in responses.items():
            by_date = snapshots.get(krs)
            if not by_date:
                continue
            api_date = nearest(sorted(by_date), crawl_date)
            if api_date is None:
                continue
            listed = by_date[api_date]
            comparable = comparable_people(listed)
            missing = missing_from_response(listed, body)
            phantom = phantoms_in_response(listed, body)
            # Whichever came first bounds the span: an api-krs snapshot taken
            # after the response is just as good a witness to what the register
            # held, as long as the bulletin says it did not move in between.
            span = (min(api_date, crawl_date), max(api_date, crawl_date))
            covered = window.covers(*span)
            moved = window.changed_between(krs, *span)
            last_change = window.last_change_before(krs, crawl_date)
            rows.append(
                {
                    "krs": krs,
                    "api_date": api_date,
                    "rejestr_date": crawl_date,
                    "n_api_people": len(listed),
                    "n_comparable": len(comparable),
                    "n_rejestr_people": len(people_in_response(body)),
                    "n_missing": len(missing),
                    "missing": [p.as_row() for p in missing],
                    "n_phantom": len(phantom),
                    "register_moved_between": moved,
                    "bulletin_covers_span": covered,
                    # Nobody comparable is not a clean bill of health: it is a
                    # company where the check had nothing to say, and counting
                    # it as verified would make the budget look better the less
                    # the check actually did.
                    "conclusive": covered and not moved and bool(comparable),
                    "last_register_change": last_change,
                }
            )

        if not rows:
            return pd.DataFrame(
                columns=[
                    "krs",
                    "api_date",
                    "rejestr_date",
                    "n_api_people",
                    "n_comparable",
                    "n_rejestr_people",
                    "n_missing",
                    "missing",
                    "n_phantom",
                    "register_moved_between",
                    "bulletin_covers_span",
                    "conclusive",
                    "last_register_change",
                ]
            )
        return pd.DataFrame(rows).sort_values(["krs", "rejestr_date"])

    def stale(self, ctx: Context) -> pd.DataFrame:
        """The comparisons where the response and the register disagree.

        Either direction counts: somebody the register lists and rejestr.io
        does not know about yet, or somebody rejestr.io still shows as holding
        a seat the register has already taken away.
        """
        df = normalise(self.read_or_process(ctx), "api_date", "rejestr_date")
        if df.empty:
            return df
        return df[df["conclusive"] & (self._disagreements(df) > 0)]

    @staticmethod
    def _disagreements(df: pd.DataFrame) -> pd.Series:
        phantom = df["n_phantom"] if "n_phantom" in df.columns else 0
        return df["n_missing"] + phantom

    def consecutive_misses(self, ctx: Context) -> dict[str, tuple[str, int]]:
        """KRS → (date of the last conclusive scrape, misses in a row since).

        Only companies whose most recent conclusive comparison came back short
        are listed. The run length is the retry count: every re-query writes a
        new response under its own date, so a company still short after N
        rounds has been paid for N times.
        """
        df = normalise(self.read_or_process(ctx), "api_date", "rejestr_date")
        if df.empty:
            return {}

        result: dict[str, tuple[str, int]] = {}
        df = df.assign(_disagreements=self._disagreements(df))
        for krs, group in df.sort_values("rejestr_date").groupby("krs"):
            conclusive = group[group["conclusive"]]
            counts = conclusive["_disagreements"].tolist()
            if not counts or counts[-1] == 0:
                continue
            since = conclusive["rejestr_date"].iloc[-1]
            for count, day in zip(
                reversed(counts), reversed(conclusive["rejestr_date"].tolist())
            ):
                if count == 0:
                    break
                since = day
            # Every response fetched since the disagreement first showed is one
            # we paid for and did not fix, whether or not its own comparison
            # came out conclusive - and the clock runs from the last of them,
            # not the last conclusive one, or a re-query whose comparison was
            # discarded would leave the company due again the same day.
            attempts = group[group["rejestr_date"] >= since]
            result[str(krs)] = (
                str(attempts["rejestr_date"].iloc[-1]),
                len(attempts),
            )
        return result

    def krs_to_rescrape(self, ctx: Context, today: date | None = None) -> list[str]:
        """Companies whose stored response is stale and whose backoff has run out."""
        today = today or date.today()
        due = []
        for krs, (last_scrape, misses) in self.consecutive_misses(ctx).items():
            delay = retry_delay_days(misses)
            if date.fromisoformat(last_scrape) + timedelta(days=delay) <= today:
                due.append(krs)
        return sorted(due)


class PersonFeedCoverage(Pipeline):
    """Person feeds bought while rejestr.io was behind the register.

    `get_osoby_scraped` fetches a person's connections once and never again,
    on the reasoning that nothing free says when one has gone stale. That is
    not true. Every organisation inside a person feed carries rejestr.io's own
    count of how many times the register has written to that company's entry,
    and api-krs publishes the same count for nothing. Where rejestr.io's was
    the lower of the two when we bought the feed, it had not caught up, and
    the connections we hold for that person are the old ones.

    One row per (person, crawl date). The comparison needs no bulletin gate
    and no name matching: it is two integers describing the same thing, and
    only api-krs snapshots at or before the fetch are used.
    """

    filename = "rejestrio_person_coverage"

    censored_people: KRSCensoredPeople

    def process(self, ctx: Context) -> pd.DataFrame:
        entry_numbers = self.censored_people.entry_numbers(ctx)

        rows = []
        for name, blob in tqdm(
            ctx.io.read_many(CloudStorage(prefix="hostname=rejestr.io")),
            desc="Reading rejestr.io person feeds",
        ):
            parsed_url = parse_person_connections_url(name)
            if parsed_url is None:
                continue
            person, crawl_date = parsed_url
            try:
                body = json.loads(blob.read_string())
            except Exception:
                continue
            behind = companies_behind(body, entry_numbers, crawl_date)
            companies = (
                sum(
                    1
                    for entry in body
                    if isinstance(entry, dict) and entry.get("typ") == "organizacja"
                )
                if isinstance(body, list)
                else 0
            )
            rows.append(
                {
                    "person": person,
                    "rejestr_date": crawl_date,
                    "n_companies": companies,
                    "n_behind": len(behind),
                    "behind": behind,
                    "worst_lag": max(
                        (
                            c["register_entry_no"] - c["rejestrio_entry_no"]
                            for c in behind
                        ),
                        default=0,
                    ),
                }
            )

        if not rows:
            return pd.DataFrame(
                columns=[
                    "person",
                    "rejestr_date",
                    "n_companies",
                    "n_behind",
                    "behind",
                    "worst_lag",
                ]
            )
        return pd.DataFrame(rows).sort_values(["person", "rejestr_date"])

    def stale(self, ctx: Context) -> pd.DataFrame:
        df = normalise(self.read_or_process(ctx), "rejestr_date")
        return df if df.empty else df[df["n_behind"] > 0]

    def people_to_refetch(self, ctx: Context, today: date | None = None) -> list[str]:
        """People whose feed is known stale and whose backoff has run out.

        The same backoff as the company path: a person rejestr.io simply has
        no better answer for should not be re-bought every night.
        """
        today = today or date.today()
        df = normalise(self.read_or_process(ctx), "rejestr_date")
        if df.empty:
            return []

        # Per day, not per blob: the two feeds a person has - current and
        # historic connections - are bought together, so they are one
        # observation of how far behind rejestr.io was, not two.
        per_day = (
            df.groupby(["person", "rejestr_date"], as_index=False)
            .agg({"n_behind": "sum"})
            .sort_values("rejestr_date")
        )

        due = []
        for person, group in per_day.groupby("person"):
            counts = group["n_behind"].tolist()
            if not counts or counts[-1] == 0:
                continue
            attempts = 0
            for count in reversed(counts):
                if count == 0:
                    break
                attempts += 1
            last = str(group["rejestr_date"].iloc[-1])
            if (
                date.fromisoformat(last) + timedelta(days=retry_delay_days(attempts))
                <= today
            ):
                due.append(str(person))
        return sorted(due)
