"""Who sits in an institution whose board is mostly political appointees.

The other three models score a person on their own record: who they know, who
they travel with, what they did after an election. That leaves out the case the
site most wants to hear about - the newcomer with no record at all, appointed
last year to a company where four of the other five board members are former
candidates. Nothing about them is suspicious. Everything about where they are
is.

So this model scores the place and reads the score onto the person. For each
company, what share of its board is either a former candidate or somebody the
site has already confirmed; a person's score is the worst institution they sit
in. The person is left out of their own institution's numerator and
denominator, or an ex-candidate on a two-person board would be scoring
themselves.

Small boards need a brake, because two people of whom one is a candidate is
50% and means nothing, so the denominator carries the same confidence factor
the company scores have used all along.
"""

from analysis.scores.base import PeopleScoreModel, Population
from scrapers.stores import Context

#: Added to the denominator so a tiny board cannot reach a high share. With a
#: factor of 2, a board of two where the other person is a candidate scores
#: 1/(1+2) = 0.33, while a board of ten where six are scores 0.6.
CONFIDENCE_FACTOR = 2.0

#: Boards past this size say nothing about the people on them.
MAX_ROSTER = 200

#: How much a person the site has already confirmed counts for, against 1.0 for
#: somebody who merely stood in an election. Standing for office is public and
#: common; being written up on koryta.pl is neither.
CONFIRMED_WEIGHT = 2.0


def political_weight(population: Population, name: str) -> float:
    """How much this person contributes to their board looking captured."""
    if population.seed_weights.get(name, 0.0) > 0:
        return CONFIRMED_WEIGHT
    return 1.0 if population.has_candidacy(name) else 0.0


class PeopleScoresCapture(PeopleScoreModel):
    filename = "people_scores_capture"
    model_tag = "pipeline-capture"

    def raw_scores(self, ctx: Context, population: Population) -> dict[str, float]:
        rosters = {
            krs: people
            for krs, people in population.roster.items()
            # A board of one has nobody else on it to be captured by.
            if 2 <= len(people) <= MAX_ROSTER
        }

        weights = {
            krs: {name: political_weight(population, name) for name in set(people)}
            for krs, people in rosters.items()
        }
        totals = {krs: sum(w.values()) for krs, w in weights.items()}

        scores: dict[str, float] = {}
        for name in population.shortlist:
            worst = 0.0
            for post in population.employments.get(name, []):
                people = rosters.get(post.krs)
                if not people:
                    continue
                others = len(set(people)) - 1
                captured = totals[post.krs] - weights[post.krs].get(name, 0.0)
                worst = max(worst, captured / (others + CONFIDENCE_FACTOR))
            if worst:
                scores[name] = worst

        print(f"{len(scores)} people sit somewhere with a political board")
        return scores
