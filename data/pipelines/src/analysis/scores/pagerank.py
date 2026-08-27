"""Who sits close, in the employment graph, to people we already found.

The model the site started with spreads a person's rating to their companies
and back out to everybody else on those boards - one hop, then stop. That finds
the colleagues of a known face and nothing beyond them, and it treats a seat on
a 400-person supervisory body as the same evidence as a seat on a board of
three.

Personalised PageRank is the same idea without the one-hop cut-off. A random
walker starts at somebody the site has already confirmed, walks person ->
company -> person -> company for as long as it likes, and teleports back to a
confirmed person with probability 1 - alpha. The score is how much of its time
it spends on each candidate: high for someone two or three well-chosen steps
from several known faces, low for someone whose only tie runs through an
institution that employs half the voivodeship, because a walker leaving a
400-person board is unlikely to pick you.

Downvotes are used too. A second walk seeded on the people humans rated
negative measures the same proximity to the known-uninteresting, and it is
subtracted: whole categories of company (a big employer everyone in town has
passed through) attract both walks, and the difference is what is left after
that cancels out.
"""

import networkx as nx

from analysis.scores.base import (
    QUEUE_THRESHOLD,
    PeopleScoreModel,
    Population,
    ScoreRange,
)
from scrapers.stores import Context

#: Teleport probability is 1 - alpha. The usual 0.85 lets a walk run about six
#: hops, which is two or three person-to-person steps.
ALPHA = 0.85

#: How much a shared employer counts for. The unit the other weights are in.
EMPLOYMENT_EDGE_WEIGHT = 1.0

#: How much having stood for the same committee counts for. Well below an
#: employer on purpose: two people on the same board of five have something to
#: explain, two people on the same party's list in different towns have not.
POLITICAL_EDGE_WEIGHT = 0.25

#: How much of the proximity-to-downvoted walk to subtract. Below 1 because
#: there are far fewer downvotes than confirmations, so its scores are noisier.
NEGATIVE_WEIGHT = 0.5

#: Boards past this size are dropped rather than down-weighted. PageRank
#: already discounts a hub, but a register entry listing thousands of people is
#: a scraping artefact rather than a board, and it makes the graph much denser
#: for nothing.
MAX_ROSTER = 500


def person_node(name: str) -> str:
    return f"p:{name}"


def company_node(krs: str) -> str:
    return f"c:{krs}"


def political_node(group: str) -> str:
    return f"g:{group}"


def build_graph(population: Population) -> nx.DiGraph:
    """The graph the walk runs on: people joined by employers and committees.

    Directed with both directions present rather than undirected, because
    `nx.pagerank` needs to be able to walk back out of a company and the two
    directions do not have to carry the same weight if that ever changes.
    """
    graph: nx.DiGraph = nx.DiGraph()

    oversized = {
        krs for krs, people in population.roster.items() if len(people) > MAX_ROSTER
    }
    if oversized:
        print(f"Skipping {len(oversized)} companies with more than {MAX_ROSTER} people")

    for name, posts in population.employments.items():
        person = person_node(name)
        for post in posts:
            if post.krs in oversized:
                continue
            company = company_node(post.krs)
            graph.add_edge(person, company, weight=EMPLOYMENT_EDGE_WEIGHT)
            graph.add_edge(company, person, weight=EMPLOYMENT_EDGE_WEIGHT)

    for name, candidacies in population.candidacies.items():
        person = person_node(name)
        for candidacy in candidacies:
            group = candidacy.committee or candidacy.party
            if not group:
                continue
            node = political_node(group)
            graph.add_edge(person, node, weight=POLITICAL_EDGE_WEIGHT)
            graph.add_edge(node, person, weight=POLITICAL_EDGE_WEIGHT)

    return graph


def walk_from(graph: nx.DiGraph, seeds: dict[str, float]) -> dict[str, float]:
    """Personalised PageRank teleporting back to `seeds`, or nothing if none.

    Seeds the graph does not contain are dropped: the payload run this model
    sees may not cover everybody the site has published.
    """
    personalization = {
        person_node(name): weight
        for name, weight in seeds.items()
        if graph.has_node(person_node(name))
    }
    if not personalization:
        return {}

    return nx.pagerank(
        graph,
        alpha=ALPHA,
        personalization=personalization,
        nstart=personalization,
        weight="weight",
    )


class PeopleScoresPageRank(PeopleScoreModel):
    filename = "people_scores_pagerank"
    model_tag = "pipeline-pagerank"

    #: Capped at the queue threshold: this model may still nominate somebody,
    #: but it can no longer outrank one whose bands mean something. Of 120
    #: people it had named, 66 % were called interesting - the base rate, so
    #: being on its list says nothing either way (p = 0.75). Nor does the band:
    #: 1-2 scored 64 % and 3-5 scored 68 % (p = 0.70), which is about what a
    #: random walk over a graph everybody in local government is connected in
    #: should be expected to produce. Its 490 people at 3 or above were a third
    #: of the queue and 169 of them were there for no other reason.
    score_range = ScoreRange(ceiling=QUEUE_THRESHOLD)

    def raw_scores(self, ctx: Context, population: Population) -> dict[str, float]:
        graph = build_graph(population)
        print(
            f"Graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges"
        )

        confirmed = walk_from(graph, population.seeds())
        if not confirmed:
            print("No confirmed person is in the graph, so there is nothing to walk")
            return {}

        rejected = walk_from(graph, population.seeds(-1))
        if rejected:
            print(f"Subtracting proximity to {len(population.seeds(-1))} downvoted")

        return {
            name: confirmed.get(person_node(name), 0.0)
            - NEGATIVE_WEIGHT * rejected.get(person_node(name), 0.0)
            for name in population.shortlist
        }
