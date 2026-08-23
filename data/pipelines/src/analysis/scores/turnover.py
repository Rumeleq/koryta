"""Who took a post just after an election they stood in.

The other models ask who a person is near. This one asks what happened to them,
and it is the only one that looks at the mechanism the site is actually about:
somebody runs on a committee's list, that committee takes the gmina, and a few
months later the same person turns up on the board of a company the gmina owns.
Each of those facts is unremarkable alone. In that order, in that region, they
are the thing.

The evidence is deliberately layered rather than filtered, because each layer
is separately incomplete. PKW records the year of a candidacy but not the day,
so timing can only mean "the election year or the one after". A candidacy's
teryt and a company's teryt are both often missing or recorded at different
depths, so the region match is a prefix comparison that abstains when either
side is silent. And whether a company is public-sector is knowable for only
some of the register - `is_public` being false mostly means nobody could tell -
so it adds a point rather than deciding the question. An appointment that
clears all three is worth four times one that only happened to be well timed.
"""

from analysis.scores.base import PeopleScoreModel, Population
from scrapers.stores import Context

#: How many years after an election an appointment still counts as following
#: it. Polish local elections are held in the autumn and the new council seats
#: its people over the following months, so the year after is where most of
#: them land.
YEARS_AFTER_ELECTION = 1

#: What a well-timed appointment is worth before the other two layers.
TIMING_POINTS = 1.0
#: Added when the company sits in the region the candidacy was run in.
REGION_POINTS = 1.0
#: Added when the register confirms the company is public-sector.
PUBLIC_POINTS = 2.0


def year_of(value: str | None) -> int | None:
    """The year in a date or year string, or None if it does not hold one."""
    if not value:
        return None
    text = str(value).strip()[:4]
    return int(text) if text.isdigit() else None


def same_region(candidacy_teryt: str | None, company_teryt: str | None) -> bool:
    """Whether a candidacy and a company are in the same place.

    TERYT codes nest, and the two sides are recorded at different depths - a
    candidacy for a sejmik carries two digits, a company carries the powiat's
    four - so either being a prefix of the other means the smaller sits inside
    the larger. Neither being known is not a match; it is an abstention, and
    the caller scores it as such.
    """
    if not candidacy_teryt or not company_teryt:
        return False
    return candidacy_teryt.startswith(company_teryt) or company_teryt.startswith(
        candidacy_teryt
    )


class PeopleScoresTurnover(PeopleScoreModel):
    filename = "people_scores_turnover"
    model_tag = "pipeline-turnover"

    def raw_scores(self, ctx: Context, population: Population) -> dict[str, float]:
        scores: dict[str, float] = {}
        matched_appointments = 0

        for name in population.shortlist:
            candidacies = population.candidacies.get(name, [])
            if not candidacies:
                continue

            total = 0.0
            for post in population.employments.get(name, []):
                started = year_of(post.start)
                if started is None:
                    continue
                company = population.companies.get(post.krs)
                company_teryt = company.teryt if company else None

                # One appointment, scored once, on whichever candidacy explains
                # it best. Somebody who stood three times in the same year has
                # not taken the job three times.
                best = 0.0
                for candidacy in candidacies:
                    stood = year_of(candidacy.year)
                    if stood is None:
                        continue
                    if not stood <= started <= stood + YEARS_AFTER_ELECTION:
                        continue

                    points = TIMING_POINTS
                    if same_region(candidacy.teryt, company_teryt):
                        points += REGION_POINTS
                    if company and company.is_public:
                        points += PUBLIC_POINTS
                    best = max(best, points)

                if best:
                    matched_appointments += 1
                    total += best

            if total:
                scores[name] = total

        print(
            f"{matched_appointments} appointments followed an election the person "
            f"stood in, across {len(scores)} people"
        )
        return scores
