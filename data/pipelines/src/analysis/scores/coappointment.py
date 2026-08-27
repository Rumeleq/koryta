"""Who keeps turning up on a board next to the same known faces.

Sharing an employer with somebody the site has confirmed is weak evidence:
public institutions are large and everybody in local government has passed
through a few of them. Sharing *two* employers with the same person is a
different claim. Two people can end up on one board by chance; ending up on the
board of a spolka komunalna and then, years later, on the supervisory board of
a different one is a working relationship somebody arranged.

That is the pattern this model looks for, and it is one PageRank blurs. To a
random walk, two people who share two employers are just two short paths, worth
about as much as two separate acquaintances who share one each. Here only the
repeat counts, and a candidate's score is the weight of the confirmed people
they travel with rather than the number of doors they have been through.
"""

import collections

from analysis.scores.base import PeopleScoreModel, Population, ScoreRange
from scrapers.stores import Context

#: How many separate companies two people have to have shared before the
#: overlap says anything. One is a coincidence and there are a great many of
#: them; two is the whole point of the model.
MIN_SHARED_COMPANIES = 2

#: Companies bigger than this are ignored when looking for overlap. Two people
#: who both appear somewhere with a four-figure roster have not met.
MAX_ROSTER = 200


def shared_company_counts(
    population: Population, name: str, rosters: dict[str, list[str]]
) -> collections.Counter:
    """How many companies this person shares with each other person."""
    shared: collections.Counter = collections.Counter()
    for post in population.employments.get(name, []):
        for colleague in rosters.get(post.krs, []):
            if colleague != name:
                shared[colleague] += 1
    return shared


class PeopleScoresCoappointment(PeopleScoreModel):
    filename = "people_scores_coappointment"
    model_tag = "pipeline-together"

    #: Capped below the queue threshold, so this model can no longer put
    #: anybody in front of a reader by itself. It is the only one measured
    #: whose people did *worse* than the pool they were drawn from: of 51 it
    #: had named, 51 % were called interesting against a base rate of 65 %
    #: (p = 0.009), and 49 % were a wasted click against 35 %. Its bands run
    #: the wrong way too - saying 3-5 scored 41 %, saying 1-2 scored 56 %.
    #:
    #: The likely cause is the one `CompanyScores` already carries a TODO
    #: about: the population is keyed by name, so two people who share one
    #: merge into a person holding both their posts, and "shares two employers
    #: with somebody confirmed" is exactly the claim a merge like that
    #: manufactures. Worth re-measuring against ids, not deleting - the
    #: reasoning is sound and the input may not be.
    score_range = ScoreRange(ceiling=2)

    def raw_scores(self, ctx: Context, population: Population) -> dict[str, float]:
        rosters = {
            krs: people
            for krs, people in population.roster.items()
            if len(people) <= MAX_ROSTER
        }
        print(
            f"Looking for repeat overlap across {len(rosters)} companies "
            f"(dropped {len(population.roster) - len(rosters)} oversized)"
        )

        seeds = population.seeds()
        scores: dict[str, float] = {}
        for name in population.shortlist:
            companions = 0.0
            for colleague, count in shared_company_counts(
                population, name, rosters
            ).items():
                weight = seeds.get(colleague)
                if weight and count >= MIN_SHARED_COMPANIES:
                    # Weighted by how firm the confirmation is, not by how many
                    # companies they shared: the second shared board is what
                    # makes the case, the fourth adds little.
                    companions += weight
            if companions:
                scores[name] = companions

        print(f"{len(scores)} people travel with somebody already confirmed")
        return scores
