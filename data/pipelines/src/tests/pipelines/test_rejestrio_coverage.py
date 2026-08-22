"""The rejestr.io responses we hold must agree with what api-krs served.

`KRSNeedsRefresh` buys a rejestr.io response when the censored people list
changes *after* our last scrape. Nothing there catches the other order: a
scrape run before rejestr.io had picked a change up returns the board as it
was, we store that as current, and because no *further* change follows,
nothing ever asks again. The response carries no as-of date, so the mistake
is invisible from the response alone and permanent in the data.

`RejestrIOCoverage` makes it visible by checking the free source against the
paid one - see that module for how a censored name is matched to a plain one,
and for the bulletin gate that keeps a genuine register change in between from
reading as a rejestr.io gap.

Where the invariant does not hold today the test carries a **budget**: the
number of companies known to be short, with what put them there. The budget
shrinks as `ScrapeRejestrIO` re-queues them; new breakage pushes the count
over it and fails.

Reading the whole crawl bucket needs credentials and a download, so the file
is marked ``e2e`` and deselected by default. Run it with::

    .venv/bin/pytest -m e2e src/tests/pipelines/test_rejestrio_coverage.py
"""

import collections

import pytest

from conductor import setup_context
from scrapers.krs.censored import KRSCensoredPeople
from scrapers.krs.coverage import PersonFeedCoverage, RejestrIOCoverage
from scrapers.krs.names import ROLES_REJESTRIO_OMITS
from scrapers.krs.people_parsing import PERSON_PATHS

pytestmark = pytest.mark.e2e

#: Companies whose most recent conclusive comparison disagreed with api-krs.
#:
#: 114 on 2026-08-18, against 5,381 companies with both sources on file. They
#: are what this check was written to find and had never been re-queried; the
#: backoff in `RejestrIOCoverage.krs_to_rescrape` feeds them back to
#: `ScrapeRejestrIO` a few at a time, so the number should fall. Around 40 of
#: them were scraped within a week of the register change, which is the
#: too-early case exactly; the rest are companies rejestr.io has no record of
#: the person for, and those stay until rejestr.io fixes its own data.
STALE_COMPANY_BUDGET = 130

#: Of every person a conclusive comparison could check, the share the two
#: sources disagree about in either direction. 0.85% on 2026-08-18: 216
#: missing from rejestr.io and 186 it names that the register does not, of
#: 47,102. A rate rather than a count, because the corpus grows.
DISAGREEMENT_BUDGET = 0.012

#: Comparisons the bulletin can vouch for. 76.9% on 2026-08-18. The rest are
#: mostly companies whose register moved between our two observations, which
#: is why the nearer api-krs snapshot was on the far side of the response in
#: the first place. If this collapses, the gate has broken rather than the
#: data.
MIN_CONCLUSIVE_SHARE = 0.65


@pytest.fixture(scope="module")
def ctx():
    return setup_context()[0]


@pytest.fixture(scope="module")
def coverage(ctx):
    pipeline = RejestrIOCoverage()
    return pipeline, pipeline.read_or_process(ctx)


def test_there_is_something_to_check(coverage):
    """A green run on an empty frame would say nothing at all."""
    _, df = coverage

    assert not df.empty, "no rejestr.io response had an api-krs snapshot to check"


def test_most_comparisons_are_conclusive(coverage):
    """The bulletin gate should exclude a fraction, not almost everything."""
    _, df = coverage
    share = df["conclusive"].mean()

    assert share >= MIN_CONCLUSIVE_SHARE, (
        f"only {share:.1%} of {len(df)} comparisons are conclusive; the "
        f"bulletin no longer covers the crawl dates, or KRSUpdates is stale"
    )


def test_the_two_sources_name_the_same_people(coverage):
    """Either direction is a response that does not match the register.

    Somebody the register lists and rejestr.io has not heard of is a response
    bought before it caught up. Somebody rejestr.io still names whom the
    register has removed is the same staleness seen from the other side, and
    the more visible one: it is published as a live connection.
    """
    _, df = coverage
    conclusive = df[df["conclusive"]]
    checked = int(conclusive["n_comparable"].sum())
    missing = int(conclusive["n_missing"].sum())
    phantom = int(conclusive["n_phantom"].sum())

    assert checked > 0
    assert (missing + phantom) / checked <= DISAGREEMENT_BUDGET, (
        f"{missing} people api-krs lists are absent from the rejestr.io "
        f"response we hold and {phantom} more are named by it and not by the "
        f"register, of {checked} checked "
        f"({(missing + phantom) / checked:.2%}), over budget"
    )


def test_a_conclusive_comparison_actually_compared_something(coverage):
    """A company with nobody comparable is not a company that checked out."""
    _, df = coverage
    conclusive = df[df["conclusive"]]

    assert (conclusive["n_comparable"] > 0).all(), (
        "a comparison with nothing left to compare is recorded as conclusive, "
        "so the budget improves the less the check manages to check"
    )


def test_stale_companies_stay_within_budget(ctx, coverage):
    """Each of these has a stored response that will never correct itself."""
    pipeline, _ = coverage
    short = pipeline.consecutive_misses(ctx)

    assert len(short) <= STALE_COMPANY_BUDGET, (
        f"{len(short)} companies hold a rejestr.io response missing somebody "
        f"api-krs listed; budget is {STALE_COMPANY_BUDGET}. Worst offenders: "
        f"{sorted(short.items(), key=lambda kv: -kv[1][1])[:5]}"
    )


def test_the_retry_queue_is_a_queue_and_not_the_whole_corpus(ctx, coverage):
    """The backoff exists so a permanently-missing person is not re-bought nightly."""
    pipeline, df = coverage
    due = pipeline.krs_to_rescrape(ctx)

    assert len(due) <= STALE_COMPANY_BUDGET
    assert len(due) < df["krs"].nunique() / 10, (
        f"{len(due)} companies queued for a paid re-scrape out of "
        f"{df['krs'].nunique()}; the backoff is not holding anything back"
    )


def test_the_register_has_not_grown_a_section_we_do_not_read(ctx):
    """A people-bearing key outside PERSON_PATHS is a change that never shows.

    That is what the `prokurenci` bug was: the section was there, the parser
    looked in the wrong shape, found nobody, and every proxy appointment went
    unnoticed for as long as the crawl has existed. api-krs adds sections; this
    turns the next one into a failing test rather than into silence.
    """
    unread = KRSCensoredPeople().unread_paths(ctx)

    assert unread == {}, (
        f"api-krs holds people in {len(unread)} place(s) PERSON_PATHS does not "
        f"name: {unread}. Add them to scrapers/krs/people_parsing.py, then "
        f"check against rejestr.io whether the new role belongs in "
        f"ROLES_REJESTRIO_OMITS (currently {sorted(ROLES_REJESTRIO_OMITS)})."
    )


def test_every_role_we_compare_is_one_rejestrio_actually_models(ctx, coverage):
    """A role rejestr.io never names would make every holder look missing.

    Measured on 2026-08-18: rejestr.io names 96-100% of the holders of every
    compared role. The two it does not are in ROLES_REJESTRIO_OMITS.
    """
    pipeline, df = coverage
    conclusive = df[df["conclusive"]]
    missing_roles = collections.Counter(
        str(row[-1]).split(":")[0].strip()
        for people in conclusive["missing"]
        for row in (people if isinstance(people, (list, tuple)) else ())
    )
    checked_roles = {path.role for path in PERSON_PATHS}
    unknown = set(missing_roles) - checked_roles

    assert not unknown, f"missing people carry roles nothing declares: {unknown}"
    assert not (set(missing_roles) & ROLES_REJESTRIO_OMITS), (
        "a role in ROLES_REJESTRIO_OMITS reached the comparison"
    )


#: Person feeds whose most recent buy caught rejestr.io behind the register.
#:
#: 9 on 2026-08-19, of 432 people on file. A person's connections are bought
#: once and never refreshed, so a buy made while rejestr.io was catching up is
#: permanent until something notices - which is what this is.
STALE_PERSON_BUDGET = 15

#: Of every company inside a person feed, the share where rejestr.io's count of
#: register entries was behind api-krs's at the moment we bought the feed.
#: 0.8% on 2026-08-19 (139 of 18,069).
PERSON_FEED_LAG_BUDGET = 0.02


@pytest.fixture(scope="module")
def person_coverage(ctx):
    pipeline = PersonFeedCoverage()
    return pipeline, pipeline.read_or_process(ctx)


def test_person_feeds_are_checked_at_all(person_coverage):
    _, df = person_coverage

    assert not df.empty, "no person feed had an api-krs entry number to check"
    assert df["n_companies"].sum() > 0


def test_rejestrio_had_caught_up_when_we_bought_a_person_feed(person_coverage):
    """Two integers describing the same thing: entries written to the register.

    rejestr.io publishes its count as `krs_wpisy.najnowszy_numer` and api-krs
    publishes the register's as `numerOstatniegoWpisu`. Where ours was the
    higher of the two when we paid, we bought the company as it used to be.
    """
    _, df = person_coverage
    checked = int(df["n_companies"].sum())
    behind = int(df["n_behind"].sum())

    assert behind / checked <= PERSON_FEED_LAG_BUDGET, (
        f"{behind} of {checked} companies inside a person feed were behind the "
        f"register when the feed was bought ({behind / checked:.2%}), over budget"
    )


def test_stale_person_feeds_stay_within_budget(ctx, person_coverage):
    pipeline, df = person_coverage
    per_day = df.groupby(["person", "rejestr_date"], as_index=False).agg(
        {"n_behind": "sum"}
    )
    stale = {
        person
        for person, group in per_day.sort_values("rejestr_date").groupby("person")
        if group["n_behind"].tolist()[-1] > 0
    }

    assert len(stale) <= STALE_PERSON_BUDGET, (
        f"{len(stale)} people hold connections bought while rejestr.io was "
        f"behind; budget is {STALE_PERSON_BUDGET}"
    )
    assert len(pipeline.people_to_refetch(ctx)) <= len(stale), (
        "the backoff should hold some of them back, not queue every one"
    )
