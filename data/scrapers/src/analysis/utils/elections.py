"""Reading one candidacy out of the merged PKW tables."""

import typing

import numpy as np


def _first(value: typing.Any) -> str | None:
    """The head of a TERYT list, or the scalar itself, as a string."""
    if isinstance(value, (list, np.ndarray)):
        return str(value[0]) if len(value) > 0 else None
    if value is None or value != value:  # NaN
        return None
    text = str(value)
    return text or None


def candidacy_teryt(election: typing.Mapping) -> str | None:
    """Where the candidacy was, which is not where the candidate lived.

    PKW records both, and both used to be poured into one list that nothing
    ordered - so a person who stood in Kłobuck but lives in Warszawa could have
    the candidacy filed under Warszawa. Ask for the one that means "here is
    where they stood", and fall back to the old list only for rows written
    before it was recorded separately.
    """
    return (
        _first(election.get("teryt_candidacy_powiat"))
        or _first(election.get("teryt_candidacy_wojewodztwo"))
        or _first(election.get("teryt_powiat"))
        or _first(election.get("teryt_wojewodztwo"))
        or _first(election.get("teryt"))
    )
