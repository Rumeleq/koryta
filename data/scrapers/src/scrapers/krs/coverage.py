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
from scrapers.krs.names import missing_from_response, people_in_response
from scrapers.krs.updates import KRSUpdates
from scrapers.stores import CloudStorage, Context, Pipeline
from scrapers.stores.file import split_crawl_date

#: The rejestr.io endpoint that answers "who is connected to this company
#: today". The historic one is not comparable: it lists people who have left.
CURRENT_CONNECTIONS_SUFFIX = "krs-powiazania/aktualnosc_aktualne"

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


def days_in(start: str, end: str) -> list[str]:
    """Every day strictly after ``start`` and up to ``end``."""
    first = date.fromisoformat(start) + timedelta(days=1)
    last = date.fromisoformat(end)
    out = []
    while first <= last:
        out.append(first.isoformat())
        first += timedelta(days=1)
    return out


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
            earlier = [d for d in sorted(by_date) if d <= crawl_date]
            if not earlier:
                continue
            api_date = earlier[-1]
            listed = by_date[api_date]
            missing = missing_from_response(listed, body)
            covered = window.covers(api_date, crawl_date)
            moved = window.changed_between(krs, api_date, crawl_date)
            last_change = window.last_change_before(krs, crawl_date)
            rows.append(
                {
                    "krs": krs,
                    "api_date": api_date,
                    "rejestr_date": crawl_date,
                    "n_api_people": len(listed),
                    "n_rejestr_people": len(people_in_response(body)),
                    "n_missing": len(missing),
                    "missing": [p.as_row() for p in missing],
                    "register_moved_between": moved,
                    "bulletin_covers_span": covered,
                    "conclusive": covered and not moved,
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
                    "n_rejestr_people",
                    "n_missing",
                    "missing",
                    "register_moved_between",
                    "bulletin_covers_span",
                    "conclusive",
                    "last_register_change",
                ]
            )
        return pd.DataFrame(rows).sort_values(["krs", "rejestr_date"])

    def stale(self, ctx: Context) -> pd.DataFrame:
        """The comparisons that show a response fetched before rejestr.io knew."""
        df = normalise(self.read_or_process(ctx), "api_date", "rejestr_date")
        if df.empty:
            return df
        return df[df["conclusive"] & (df["n_missing"] > 0)]

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
        conclusive = df[df["conclusive"]].sort_values("rejestr_date")
        for krs, group in conclusive.groupby("krs"):
            misses = group["n_missing"].tolist() if not group.empty else []
            if not misses or misses[-1] == 0:
                continue
            run = 0
            for count in reversed(misses):
                if count == 0:
                    break
                run += 1
            result[str(krs)] = (str(group["rejestr_date"].iloc[-1]), run)
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
