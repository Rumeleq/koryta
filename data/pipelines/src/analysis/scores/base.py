"""What every model that rates a person has in common.

A scoring model answers one question: of the people the pipeline knows about
and the site has not looked at yet, which should somebody open next? Each model
answers it from a different angle, and each writes its answer as a vote under
its own `userUid` - `pipeline-pagerank`, `pipeline-together` and so on. The
frontend treats any uid containing "pipeline" as non-human and takes the best
of them, so a model that is wrong about somebody costs a wasted click rather
than a corrupted aggregate.

Two things are shared here rather than left to each model. `Population` unpacks
the payloads once into the shapes the models actually want (who works where,
who stood for what, who sits on which board), because four models re-deriving
that from raw payload rows would be four chances to disagree about what a
missing KRS means. And `banded_scores` puts every model on the same 1-5 scale
by rank, not by value: raw model outputs are on wildly different scales - a
PageRank mass is ~1e-5, a co-appointment count is an integer - and with the
frontend taking the maximum across models, whichever model scaled itself most
generously would otherwise win every tie.

Ranking within a model is not the same as being right, though, and `ScoreRange`
is what the first measurement of that cost. `scripts/score_model_accuracy.py`
matches every human vote cast since the models went live on 2026-08-08 to the
scores standing on that person just before somebody looked at them, and asks
what the reader then said. Over 132 people:

    model      n    said interesting    wasted a click    band orders?
    turnover   43   88 %               12 %              no  (87 % -> 90 %)
    pagerank  120   66 %               34 %              no  (64 % -> 68 %)
    company   124   65 %               35 %              yes (54 % -> 88 %)
    capture   130   65 %               35 %              yes (56 % -> 80 %)
    together   51   51 %               49 %              no  (56 % -> 41 %)

against a base rate of 65 % interesting and 35 % wasted over everybody a reader
judged. "Band orders" compares the model saying 1-2 against it saying 3-5, and
the arrow is what the reader concluded; the split is significant for `company`
(p = 0.0002) and `capture` (p = 0.008) and not for the other three. Being named
at all is significant only for `turnover` (88 % against 65 %, p = 0.0001) and
for `together`, which is significantly *worse* than the pool it draws from
(51 %, p = 0.009).

So a 5 does not mean the same thing from every model: `turnover` is right about
almost everybody it names and its own ordering adds nothing, `company` and
`capture` earn their scale, and `pagerank` and `together` emit a 5 that carries
no more information than their 1 - and with the site taking the maximum, that 5
is what decides the queue.

`ScoreRange` therefore gives each model the part of the 1-5 axis its measured
accuracy supports, and `banded_scores` folds the rank bands onto it. A model
whose ceiling is 2 can never on its own put somebody in the queue, which starts
at 3; a model floored at 3 puts everybody it names there. Nothing about the
site changes - it still takes the highest score any model gave - but the
highest score now comes from whichever model has earned the right to say it.
"""

import dataclasses
import typing

import pandas as pd

from analysis.payloads.person import PeoplePayloads
from entities.composite import PersonScore
from scrapers.koryta.download import KorytaPeople, KorytaVotes
from scrapers.krs.list import CompaniesKRS
from scrapers.stores import Context, Pipeline

#: How strongly a published page counts as "we already decided this one is
#: interesting". A page gets published after a human wrote it up, so it is
#: firmer evidence than a single passing vote but weaker than a maximal one.
IS_PUBLIC_SCORE = 3

#: The percentile a raw score has to reach to earn each point of the 1-5 scale,
#: highest band first. Deliberately not even fifths: the point of a score is to
#: order a queue, and a queue where a fifth of everybody is a 5 orders nothing.
SCORE_BANDS: tuple[tuple[float, int], ...] = (
    (0.99, 5),
    (0.95, 4),
    (0.85, 3),
    (0.60, 2),
    (0.0, 1),
)

#: The score a person needs before the site's default queue shows them at all.
#: Mirrors `DEFAULT_MIN_VOTES` in `frontend/app/pages/eksploruj/nowe.vue`, and
#: it is the number the ranges below are drawn around: a ceiling under it keeps
#: a model out of the queue, a floor on it puts everybody it names in.
QUEUE_THRESHOLD = 3


@dataclasses.dataclass(frozen=True)
class ScoreRange:
    """How much of the 1-5 axis a model has earned.

    The band a model hands out is a rank within its own output, and a rank says
    nothing about whether the model is right. Measuring that against what
    readers concluded (see the module docstring) put the models a long way
    apart, so each gets the span its accuracy supports rather than all of them
    getting all five points.
    """

    floor: int = 1
    ceiling: int = 5

    def __post_init__(self) -> None:
        if not 1 <= self.floor <= self.ceiling <= 5:
            raise ValueError(f"{self} is not a range inside 1-5")

    def rescale(self, band: int) -> int:
        """Where a 1-5 rank band lands once folded onto this range.

        Rounded up at the halves, so a model with a narrow range still reaches
        its own ceiling - a range of 1-2 whose top band came out as 1 would be
        a model that cannot say anything at all.
        """
        width = self.ceiling - self.floor
        return self.floor + int((band - 1) * width / 4 + 0.5)


#: What a model that has not been measured gets: the whole axis, as before.
FULL_RANGE = ScoreRange()


def iter_dicts(value: typing.Any) -> typing.Iterator[dict]:
    """The dict entries of a payload list column, whatever pandas made of it.

    The same column arrives as a list of dataclass-dicts when the payloads were
    built in this process and as a list of plain dicts when they were read back
    from jsonl, and as a float NaN when the person had none.
    """
    if value is None or isinstance(value, float):
        return
    if not hasattr(value, "__iter__") or isinstance(value, (str, bytes)):
        return
    for item in value:
        if isinstance(item, dict):
            yield item


@dataclasses.dataclass
class Employment:
    krs: str
    role: str | None
    start: str | None
    end: str | None


@dataclasses.dataclass
class Candidacy:
    year: str | None
    teryt: str | None
    party: str | None
    committee: str | None


@dataclasses.dataclass
class CompanyFacts:
    name: str | None
    teryt: str | None
    is_public: bool


@dataclasses.dataclass
class Population:
    """Everyone a model can see, and what the site already thinks of them.

    Keyed by person name throughout, which is what `PeoplePayloads` and the
    site's own nodes are joined on today. Names collide - the existing
    `CompanyScores` carries a TODO saying so - and until the payloads carry the
    koryta node id, a model inherits that.

    The population is whatever the payload run covered. `Extract` filters by
    region unless asked for everything, so a regional run gives a regional
    graph: someone whose only tie to a known face runs through a company in the
    next voivodeship is invisible to it. That is the same horizon the current
    model has, not a new limitation.
    """

    #: Payload rows, one per person, in payload order.
    people: pd.DataFrame
    #: Person name -> koryta node id. Only people the site already has a node
    #: for; a model cannot vote on anybody else.
    node_ids: dict[str, str]
    #: Person name -> posts held, in payload order.
    employments: dict[str, list[Employment]]
    #: Person name -> candidacies stood.
    candidacies: dict[str, list[Candidacy]]
    #: KRS -> everybody the payloads put in that company.
    roster: dict[str, list[str]]
    #: KRS -> what the KRS register says about the company.
    companies: dict[str, CompanyFacts]
    #: Person name -> how firmly the site has already judged them. Positive for
    #: a published page or an upvote, negative for a downvote, absent for the
    #: unexamined. This is the ground truth the models generalise from, so it
    #: counts humans only - seeding a model on the pipeline's own past votes
    #: would just teach it to repeat itself.
    seed_weights: dict[str, float]
    #: The people eligible for a score: known to the site, not published, and
    #: not yet voted on by a human. Rating anybody else is telling somebody
    #: something they already know.
    shortlist: list[str]

    def seeds(self, sign: int = 1) -> dict[str, float]:
        """Confirmed people whose judgement went the given way, weight positive."""
        return {
            name: abs(weight)
            for name, weight in self.seed_weights.items()
            if weight * sign > 0
        }

    def has_candidacy(self, name: str) -> bool:
        return bool(self.candidacies.get(name))


def banded_scores(
    raw: typing.Mapping[str, float], span: ScoreRange = FULL_RANGE
) -> dict[str, int]:
    """Put a model's raw output on the shared 1-5 scale, inside its own range.

    By rank, so the shape of the raw distribution does not matter: PageRank
    masses are a power law and co-appointment counts are small integers with
    ties everywhere, and both need to come out as a usable shortlist. People
    scoring zero or less are dropped rather than banded - a model saying
    nothing about somebody is not a vote.

    The rank band is then folded onto `span`, which is how a model that ranks
    its own people perfectly well but is wrong about most of them stops
    outranking one that is right. Ranking and being right are separate
    questions and only the first is knowable without a reader.
    """
    series = pd.Series(raw, dtype="float64")
    positive = series[series > 0]
    if positive.empty:
        return {}

    percentile = positive.rank(pct=True, method="average")

    def band(value: float) -> int:
        for floor, points in SCORE_BANDS:
            if value >= floor:
                return points
        return 1

    return {str(name): span.rescale(band(value)) for name, value in percentile.items()}


class PeopleScoreModel(Pipeline):
    """A model that nominates people to look at next.

    Subclasses set `filename` and `model_tag` and implement `raw_scores`. The
    base handles who is eligible, the 1-5 banding and the output shape.
    """

    #: The `userUid` this model's votes are stored under. Anything containing
    #: "pipeline" reads as non-human to the frontend; the tag after it is what
    #: tells two models apart in `stats.votes.models`.
    model_tag: str = "pipeline"

    #: How much of the 1-5 axis this model has earned, measured against what
    #: readers said about the people it named. A model nobody has checked yet
    #: keeps the whole axis - the range is a record of a measurement, not a
    #: guess, and guessing one would be worse than leaving it alone.
    score_range: ScoreRange = FULL_RANGE

    people_payloads: PeoplePayloads
    people_koryta: KorytaPeople
    people_votes: KorytaVotes
    companies_krs: CompaniesKRS

    def raw_scores(self, ctx: Context, population: Population) -> dict[str, float]:
        """This model's opinion, on whatever scale suits it, keyed by name.

        Scores for people outside the shortlist are ignored, so a model is free
        to compute over everybody - the graph models have to.
        """
        raise NotImplementedError

    def process(self, ctx: Context):
        population = self.population(ctx)
        print(
            f"{type(self).__name__}: {len(population.people)} people, "
            f"{len(population.seeds())} positive seeds, "
            f"{len(population.seeds(-1))} negative, "
            f"{len(population.shortlist)} on the shortlist"
        )

        raw = self.raw_scores(ctx, population)
        eligible = set(population.shortlist)
        banded = banded_scores(
            {name: score for name, score in raw.items() if name in eligible},
            self.score_range,
        )

        records = [
            dataclasses.asdict(
                PersonScore(
                    node_id=population.node_ids[name],
                    name=name,
                    score=score,
                    model=self.model_tag,
                )
            )
            for name, score in banded.items()
        ]
        if not records:
            print(f"{type(self).__name__} found nobody to score")
            return pd.DataFrame(columns=["node_id", "name", "score", "model"])

        df = pd.DataFrame.from_records(records)
        df = df.sort_values(by="score", ascending=False).reset_index(drop=True)
        print(f"{type(self).__name__} scored {len(df)} people")
        print(df["score"].value_counts().sort_index(ascending=False))
        return df.astype({"score": "int32"})

    def population(self, ctx: Context) -> Population:
        people = self.people_payloads.read_or_process(ctx)
        koryta = self.people_koryta.read_or_process(ctx)
        votes = self.people_votes.read_or_process(ctx)
        companies = self.companies_krs.read_or_process(ctx)

        node_ids = dict(zip(koryta["full_name"], koryta["id"]))
        human_votes = self.human_votes(votes, koryta)

        employments: dict[str, list[Employment]] = {}
        candidacies: dict[str, list[Candidacy]] = {}
        roster: dict[str, list[str]] = {}

        for _, row in people.iterrows():
            name = str(row.get("name"))
            posts = [
                Employment(
                    krs=str(company["krs"]),
                    role=company.get("role"),
                    start=company.get("start"),
                    end=company.get("end"),
                )
                for company in iter_dicts(row.get("companies"))
                if company.get("krs")
            ]
            employments[name] = posts
            for post in posts:
                roster.setdefault(post.krs, []).append(name)

            candidacies[name] = [
                Candidacy(
                    year=election.get("election_year"),
                    teryt=election.get("teryt"),
                    party=election.get("party"),
                    committee=election.get("committee"),
                )
                for election in iter_dicts(row.get("elections"))
            ]

        seed_weights: dict[str, float] = {}
        shortlist: list[str] = []
        for _, entry in koryta.iterrows():
            name = str(entry.get("full_name"))
            is_public = entry.get("is_public", False)
            if pd.isna(is_public):
                is_public = False

            vote = human_votes.get(str(entry.get("id")), 0.0)
            if is_public:
                seed_weights[name] = max(seed_weights.get(name, 0.0), IS_PUBLIC_SCORE)
            elif vote:
                seed_weights[name] = vote
            elif name in employments:
                shortlist.append(name)

        return Population(
            people=people,
            node_ids=node_ids,
            employments=employments,
            candidacies=candidacies,
            roster=roster,
            companies=self.company_facts(companies),
            seed_weights=seed_weights,
            shortlist=shortlist,
        )

    @staticmethod
    def human_votes(votes: pd.DataFrame, koryta: pd.DataFrame) -> dict[str, float]:
        """Node id -> the sum of what people voted on it.

        `KorytaPeople.votes_interesting` would be the obvious source and is the
        wrong one: it is the site's own aggregate, which includes the
        pipeline's vote. A model seeded on it would be seeded on its own output
        and, worse, `shortlist` would drop everybody the pipeline had ever
        scored, so no run after the first could revise a score.
        """
        if votes.empty or "person_koryta_id" not in votes:
            return {}
        totals: dict[str, float] = {}
        for _, row in votes.iterrows():
            target = row.get("person_koryta_id")
            interesting = row.get("interesting")
            # NaN rather than a blank is what a vote with no node on it looks
            # like once pandas has been through it, and NaN is truthy - see
            # `KorytaVotes.process`, which is where those get dropped now.
            if pd.isna(target) or interesting is None or pd.isna(interesting):
                continue
            node_id = str(target).strip()
            if not node_id:
                continue
            totals[node_id] = totals.get(node_id, 0.0) + float(interesting)
        return totals

    @staticmethod
    def company_facts(companies: pd.DataFrame) -> dict[str, CompanyFacts]:
        if companies.empty or "krs" not in companies:
            return {}
        facts = {}
        for _, row in companies.iterrows():
            krs = row.get("krs")
            if not krs or pd.isna(krs):
                continue
            is_public = row.get("is_public", False)
            facts[str(krs)] = CompanyFacts(
                name=row.get("name"),
                teryt=str(row["teryt_code"]) if row.get("teryt_code") else None,
                is_public=bool(is_public) if not pd.isna(is_public) else False,
            )
        return facts
