"""Data classes representing individuals from various data sources."""

from dataclasses import dataclass


@dataclass
class Koryta:
    """Represents a person from the main 'koryta.pl' dataset."""

    id: str
    full_name: str
    parties: list[str]
    data: dict
    is_public: bool = False
    votes_interesting: int | None = None


@dataclass
class KRS:
    """Represents a person associated with a KRS (National Court Register) entry."""

    id: str
    first_name: str
    last_name: str
    full_name: str
    employed_krs: str
    employed_start: str | None
    employed_end: str | None
    employed_for: str | None
    employed_role: str | None = None
    birth_date: str | None = None
    second_names: str | None = None
    sex: str | None = None

    def __post_init__(self):
        """Ensures the person's ID is a string."""
        self.id = str(self.id)


@dataclass
class MSiG:
    """A person as one KRS entry in the Monitor Sądowy i Gospodarczy named them.

    One row per person per entry, not per spell: the Monitor publishes the
    register's diffs, so what it states is "on this date this person was
    written into, or struck from, this post" -- `action` says which. Whoever
    wants the roster of a company on a date replays these in order.

    Unlike `KRS`, which comes from rejestr.io, this carries the name and PESEL
    in full. That is the whole reason the source is worth crawling: the free
    KRS API masks both.
    """

    krs: str
    last_name: str
    first_names: str | None
    full_name: str
    pesel: str | None
    role: str
    #: `wpisac`, `wykreslic`, `stan` (a first entry), or `dla_pozycji` (named
    #: while some other field of theirs was amended, so: sitting at the time).
    action: str
    #: When the court made the entry. The publication follows days to weeks
    #: later, and is what `publication_date` holds.
    entry_date: str | None
    publication_date: str | None
    announcement_id: str
    monitor_number: str | None = None
    position: int | None = None
    dzial: int | None = None
    rubryka: int | None = None


@dataclass
class PKW:
    """Represents a person from a PKW (National Electoral Commission) dataset."""

    election_year: str
    election_type: str
    sex: str | None = None
    birth_year: int | None = None
    age: str | None = None
    teryt_candidacy: str | None = None
    teryt_living: str | None = None
    candidacy_success: str | None = None
    party: str | None = None
    position: str | None = None
    pkw_name: str | None = None
    first_name: str | None = None
    middle_name: str | None = None
    last_name: str | None = None
    party_member: str | None = None


@dataclass
class Wikipedia:
    """Represents a person from a Wikipedia article."""

    source: str
    full_name: str
    party: str | None
    birth_iso8601: str | None
    birth_year: int | None
    infoboxes: list[str]
    content_score: int
    links: list[str]


@dataclass
class PersonVote:
    """Represents a vote associated with a person."""

    person_koryta_id: str
    interesting: int | None


def is_pipeline_uid(user_uid: str | None) -> bool:
    """Whether a vote was cast by a scoring model rather than by a person.

    One model per uid - `pipeline`, `pipeline-pagerank` and so on - and the
    substring is what tells them apart from a Firebase uid, which is 28
    alphanumeric characters. Kept identical to `isPipelineUid` in
    `frontend/shared/stats.ts`: the two sides have to agree on what counts as a
    human vote or the pipeline ends up seeded on its own output.
    """
    return bool(user_uid) and "pipeline" in str(user_uid)


@dataclass
class RejestrIOKey:
    """Represents a person from the RejestrIO dataset."""

    id: str

    def __hash__(self) -> int:
        """Computes the hash based on the KRS ID."""
        return hash(self.id)

    def __eq__(self, other: object) -> bool:
        """Checks equality based on the KRS ID."""
        return isinstance(other, RejestrIOKey) and self.id == other.id
