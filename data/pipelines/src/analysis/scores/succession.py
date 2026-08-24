"""Who takes over the seat of somebody already known to be political.

Every other model asks who a person is *near*. `PeopleScoresTurnover` comes
closest to asking what happened to them, but it reads one person's own life -
they stood in an election, then took a post. This one reads a seat: the register
struck one name off a board and entered another, and the question is who the
first name was. A board seat is not created for whoever fills it. Somebody
vacated it, and if the person who vacated it was there for a party, the person
who arrived is worth a look on the same terms.

The pairing is deliberately conservative. A "succession" here is a **one-to-one
match inside one company and one role**: A's spell ends, B's spell begins within
a few months of that, and neither spell is used twice. That matters because the
usual shape in KRS is a whole board changing on one day - seven people struck
off, seven entered. Pairing every leaver with every joiner would turn that into
forty-nine claims about who replaced whom, all but seven of them invented. The
greedy match closest-first turns it into seven, which is as much as the register
actually supports: it says the seven of them swapped, not which chair each took.

What the evidence is worth is layered the way `turnover.py` layers its own,
because each layer is separately incomplete. A predecessor's party comes from
the committee they stood for, and `committee_to_party` maps a coalition to
nothing at all - so standing without a nameable party is worth a quarter of
standing with one rather than nothing. A predecessor the site has already
published a page about is firmer evidence than either, and it is weighted by how
firm that judgement was. And whether the company is public-sector is knowable
for only part of the register, so it adds to a case that already exists rather
than making one.

Measured on the 2026-08-24 production export, over the people who have any
predecessor at all: 13.9 % of them are filed under a party. Of those who
replaced at least one person who is, 33.2 % are. Against the obvious confounder
- political people cluster in political companies - the control is people who
share a company with somebody party-affiliated but did not take over from them:
12.1 %. Succession carries something co-employment does not.
"""

import collections
import datetime

from analysis.scores.base import Employment, PeopleScoreModel, Population
from scrapers.stores import Context

#: How long a seat may stand empty and the next holder still count as having
#: taken over. Long enough for a board to be reconstituted at the next general
#: meeting, short enough that an unrelated appointment two years later is not
#: read as a handover.
MAX_GAP_DAYS = 120

#: How far the other way the two dates may disagree. The leaving date and the
#: arriving date are separate filings, and the register is routinely written up
#: in the wrong order - the successor's entry dated before the predecessor's
#: departure. Tolerating that is not the same as tolerating a real overlap of
#: years, which is two people sitting on the same board rather than one
#: replacing the other.
MAX_OVERLAP_DAYS = 90

#: What replacing somebody who stood for a nameable party is worth.
PARTY_POINTS = 1.0

#: What replacing somebody who stood for election under a committee no party
#: could be read off is worth. Not zero: `committee_to_party` deliberately
#: leaves a coalition unmapped, so the quietest quarter of this layer is
#: Trzecia Droga rather than an absence of politics. Not one either: half the
#: register has stood for something somewhere.
CANDIDACY_POINTS = 0.25

#: Added once a case exists, when the register confirms the seat is at a
#: public-sector company. On its own it says nothing - most of the register is
#: unclassified, and `is_public` being false mostly means nobody could tell.
PUBLIC_POINTS = 1.0

#: Spells in one company and one role past which the pairing is abandoned. The
#: match is quadratic in the size of a group, and a group this large is a data
#: error rather than a board - the largest real one in the export is 42.
MAX_SEAT_GROUP = 300


def as_date(value: str | None) -> datetime.date | None:
    """The day a register date names, or None if it does not name one.

    rejestr.io writes `data_start` and `data_koniec` as ISO days and the
    pipeline carries them through as strings, so this is a parse and not a
    guess. A year on its own is rejected rather than read as its first of
    January: the whole model turns on two dates being within months of each
    other, and inventing eleven of those months would manufacture handovers.
    """
    if not value:
        return None
    try:
        return datetime.date.fromisoformat(str(value).strip())
    except ValueError:
        return None


def seat_groups(
    population: Population,
) -> dict[tuple[str, str], list[tuple[str, Employment]]]:
    """Every spell, filed under the company and role it was served in.

    A spell whose role nobody recorded is left out rather than pooled with the
    other unrecorded ones. Two unknown roles at one company are not evidence of
    the same seat, and pairing them would assert a handover between a proxy and
    a board member.

    Duplicates are dropped here too. The same person, company, role and start
    date arrives more than once often enough to have its own invariant test
    (211 rows in the last run), and each copy would otherwise take part in the
    match on its own account.
    """
    groups: dict[tuple[str, str], list[tuple[str, Employment]]] = (
        collections.defaultdict(list)
    )
    seen: set[tuple[str, str, str, str | None]] = set()
    for name, posts in population.employments.items():
        for post in posts:
            if not post.krs or not post.role:
                continue
            fingerprint = (name, post.krs, post.role, post.start)
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            groups[(post.krs, post.role)].append((name, post))
    return groups


def successions(
    spells: list[tuple[str, Employment]],
) -> list[tuple[str, str, int]]:
    """Who handed which seat to whom, as `(predecessor, successor, gap)`.

    Greedy, closest first, one-to-one. Each *spell* is spent once on each side
    rather than each person, so somebody who left a board and came back to it
    years later takes part in both handovers - which is what the register says
    happened.

    Ties are broken on the register's own facts - when each spell began, then
    when it ended, then the name - so that two runs over the same data pair the
    same people. Within a same-day board change every gap is zero, and the
    tie-break is the whole of what decides who is filed as whose predecessor;
    anything derived from the import order would move the answer every run.
    `shared/succession.ts` orders on the same two dates, and then on the node id
    where this has only the name - `Population` is keyed by name, as its own
    docstring warns.

    It is still an arbitrary assignment inside a batch: the register says the
    seven of them swapped, not which chair each took. For a score that is
    harmless - the seven predecessors are the same seven either way, so the
    weight a successor picks up does not depend on the assignment.
    """
    candidates: list[tuple[int, int, int]] = []
    for i, (leaver, left) in enumerate(spells):
        ended = as_date(left.end)
        if not ended:
            continue
        for j, (joiner, joined) in enumerate(spells):
            if joiner == leaver:
                continue
            started = as_date(joined.start)
            if not started:
                continue
            gap = (started - ended).days
            if -MAX_OVERLAP_DAYS <= gap <= MAX_GAP_DAYS:
                candidates.append((i, j, gap))

    def order(index: int) -> tuple[str, str, str]:
        name, post = spells[index]
        return (post.start or "", post.end or "", name)

    candidates.sort(key=lambda pair: (abs(pair[2]), order(pair[0]), order(pair[1])))

    paired: list[tuple[str, str, int]] = []
    spent_leavers: set[int] = set()
    spent_joiners: set[int] = set()
    for i, j, gap in candidates:
        if i in spent_leavers or j in spent_joiners:
            continue
        spent_leavers.add(i)
        spent_joiners.add(j)
        paired.append((spells[i][0], spells[j][0], gap))
    return paired


class PeopleScoresSuccession(PeopleScoreModel):
    filename = "people_scores_succession"
    model_tag = "pipeline-succession"

    @staticmethod
    def predecessor_weight(
        population: Population, seeds: dict[str, float], name: str
    ) -> float:
        """What it is worth to have taken over from this particular person.

        The layers do not exclude one another. Somebody the site has published
        a page about *and* who stood for PiS is both things, and the point of
        the model is that the two together are a stronger case than either.

        `seeds` is passed in rather than read off the population because
        `Population.seeds` rebuilds its dict on every call, and this runs once
        per handover.
        """
        weight = 0.0

        candidacies = population.candidacies.get(name, [])
        if any(candidacy.party for candidacy in candidacies):
            weight += PARTY_POINTS
        elif candidacies:
            weight += CANDIDACY_POINTS

        # Positive seeds only, which is what `seeds()` returns by default.
        # Somebody a human looked at and voted *down* is not evidence for
        # whoever came after them.
        weight += seeds.get(name, 0.0)

        return weight

    def raw_scores(self, ctx: Context, population: Population) -> dict[str, float]:
        groups = seat_groups(population)
        for krs, role in [
            key for key, spells in groups.items() if len(spells) > MAX_SEAT_GROUP
        ]:
            size = len(groups[(krs, role)])
            print(f"  [WARN] {krs} / {role} has {size} spells, skipped")
            del groups[(krs, role)]

        seeds = population.seeds()
        scores: dict[str, float] = {}
        handovers = 0
        evidenced = 0
        for (krs, _role), spells in groups.items():
            company = population.companies.get(krs)
            for predecessor, successor, _gap in successions(spells):
                handovers += 1
                weight = self.predecessor_weight(population, seeds, predecessor)
                if not weight:
                    continue
                if company and company.is_public:
                    weight += PUBLIC_POINTS
                evidenced += 1
                scores[successor] = scores.get(successor, 0.0) + weight

        print(
            f"{handovers} seats changed hands, {evidenced} of them from somebody "
            f"already known, across {len(scores)} people"
        )
        return scores
