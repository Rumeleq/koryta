"""Models that nominate the next person to look at.

Each model writes its verdict to the site as a vote under its own `userUid`,
all of them containing "pipeline" so the frontend keeps them out of the human
tally. They are not variants of one another: `PeopleScores` reads a person's
employers, `PeopleScoresPageRank` reads the shape of the graph around them,
`PeopleScoresCoappointment` reads who they keep turning up with,
`PeopleScoresTurnover` reads what they did after an election,
`PeopleScoresSuccession` reads whose seat they took, and
`PeopleScoresCapture` reads the institution rather than the person. Any of them
can nominate somebody the others miss, which is why the site takes the best
score across models rather than the sum.

See `base.PeopleScoreModel` for what they share.
"""

from analysis.scores.base import PeopleScoreModel, Population
from analysis.scores.capture import PeopleScoresCapture
from analysis.scores.coappointment import PeopleScoresCoappointment
from analysis.scores.company import CompanyScores, PeopleScores
from analysis.scores.pagerank import PeopleScoresPageRank
from analysis.scores.succession import PeopleScoresSuccession
from analysis.scores.turnover import PeopleScoresTurnover

#: Every model, in the order a run should produce them: the shared sources are
#: read once and cached, so the first is the slow one.
PEOPLE_SCORE_MODELS: list[type[PeopleScoreModel]] = [
    PeopleScores,
    PeopleScoresPageRank,
    PeopleScoresCoappointment,
    PeopleScoresTurnover,
    PeopleScoresSuccession,
    PeopleScoresCapture,
]

__all__ = [
    "CompanyScores",
    "PEOPLE_SCORE_MODELS",
    "PeopleScoreModel",
    "PeopleScores",
    "PeopleScoresCapture",
    "PeopleScoresCoappointment",
    "PeopleScoresPageRank",
    "PeopleScoresSuccession",
    "PeopleScoresTurnover",
    "Population",
]
