"""Recognising an api-krs person in a rejestr.io response.

api-krs masks names (see `scrapers.krs.people_parsing`), so "Kaliszewski"
arrives as ``K**********``: the initial and the length survive and nothing
else. rejestr.io serves names in full. A censored name therefore cannot be
compared to a plain one directly, but it can be reduced to the same
*signature* - ``(initial, length)`` - and a censored name whose signature
matches nobody in a rejestr.io response is somebody rejestr.io does not know
about.

That comparison is the only way, short of paying rejestr.io again, to tell
that a response we already hold was fetched before rejestr.io caught up with
a change the register had already published. Nothing else we store says so:
the response carries no as-of date, and `KRSNeedsRefresh` only ever re-queues
a company whose people change *again*.

The two sources spell a compound surname three different ways, which is why a
censored surname stands for a set of signatures rather than one:

* split across the two components, joined by rejestr.io -
  ``K*****`` + ``S******`` against "Kałuża Swoboda";
* whole in the first component, separator included -
  ``S*****************`` against "Spiczak Brzeziński";
* only the first part in the first component -
  ``K**********`` against "Kaliszewski Vel Kieliszewski".

The last one is why the rejestr.io side offers every token-boundary prefix of
its surname rather than just the whole string.

Matching on the initial and length of a surname and a given name is not an
identification - two board members can share a signature - so a *match* only
ever means "not missing". The check reads it in that direction only.
"""

import re
import unicodedata
from dataclasses import dataclass

from scrapers.krs.people_parsing import CensoredPerson

#: What separates the parts of a compound surname on the rejestr.io side.
SURNAME_SEPARATOR = re.compile(r"[\s\-]+")

#: A censored name reduced to what survives the masking.
Signature = tuple[str, int]

#: api-krs roles whose absence from a rejestr.io response says nothing about
#: how fresh it is, so counting them would make the check noisy or blind.
#:
#: ``kierownik_pzoz`` is the head of a public healthcare provider, recorded in
#: ``reprezentacjaIBIGBPPSPZOZ``: rejestr.io's connections feed has no
#: equivalent and returned none of the 1,730 in the crawl.
#:
#: ``komitet_zalozycielski`` is the committee that founded an association. It
#: is a fact from the moment of registration rather than a standing tie, and
#: rejestr.io names only 77% of them (757 of 981) as current connections -
#: enough that a miss cannot be told from a modelling difference. Every other
#: role is named 96-100% of the time and is compared.
ROLES_REJESTRIO_OMITS = frozenset({"kierownik_pzoz", "komitet_zalozycielski"})


def _normalise(value: str) -> str:
    return unicodedata.normalize("NFC", value).strip()


def signature(value: str) -> Signature | None:
    """``(initial, length)`` of a name, censored or plain."""
    text = _normalise(value)
    if not text:
        return None
    return (text[0].casefold(), len(text))


def censored_surname_signatures(components: tuple[str, ...]) -> set[Signature]:
    """Every whole surname a censored component list can stand for."""
    parts = [_normalise(c) for c in components if _normalise(c)]
    if not parts:
        return set()

    initial = parts[0][0].casefold()
    signatures = {(initial, len(parts[0]))}
    if len(parts) > 1:
        total = sum(len(p) for p in parts)
        # One separator character between each pair, or none if the register
        # ran the parts together.
        signatures.add((initial, total + len(parts) - 1))
        signatures.add((initial, total))
    return signatures


def plain_surname_signatures(surname: str) -> set[Signature]:
    """Signatures of a plain surname and of each of its leading parts."""
    text = _normalise(surname)
    if not text:
        return set()
    initial = text[0].casefold()
    boundaries = [m.start() for m in SURNAME_SEPARATOR.finditer(text)]
    return {(initial, end) for end in [*boundaries, len(text)]}


@dataclass(frozen=True)
class PlainPerson:
    """A person as rejestr.io names them, reduced to signatures."""

    surnames: frozenset[Signature]
    given: Signature

    @staticmethod
    def build(surname: str, given: str) -> "PlainPerson | None":
        surnames = plain_surname_signatures(surname)
        given_signature = signature(given)
        if not surnames or given_signature is None:
            return None
        return PlainPerson(frozenset(surnames), given_signature)


#: rejestr.io connection types that say nothing about how fresh a response is,
#: because the register entry we compare against does not record them.
#:
#: ``BENEFICIARY`` is a beneficial owner, which comes from the CRBR register
#: rather than the KRS, so 31% of them are in no OdpisAktualny at all.
#: ``KRS_FOUNDER`` is the mirror of ``komitet_zalozycielski``: a fact from the
#: moment of registration, 96% of which the register no longer carries.
#: ``KRS_CREDITOR`` sits in a part of dzial4 that holds no people. Every other
#: type is in the register 96-100% of the time.
TYPES_NOT_IN_THE_REGISTER = frozenset({"BENEFICIARY", "KRS_FOUNDER", "KRS_CREDITOR"})


def is_person(entry) -> bool:
    """Whether a rejestr.io krs-powiazania entry describes a human."""
    return isinstance(entry, dict) and entry.get("typ") in (
        "osoba",
        "osoba-bez-pesel",
    )


def connection_types(entry) -> set[str]:
    """The kinds of tie a rejestr.io entry records to the queried company."""
    links = entry.get("krs_powiazania_kwerendowane")
    if not isinstance(links, list):
        return set()
    return {
        str(link.get("typ"))
        for link in links
        if isinstance(link, dict) and link.get("typ")
    }


def people_in_response(response, comparable_only: bool = False) -> list[PlainPerson]:
    """The people named in a rejestr.io krs-powiazania response.

    With ``comparable_only``, drops those held by a tie the register does not
    record, whose absence from an OdpisAktualny means nothing.
    """
    if not isinstance(response, list):
        return []
    people = []
    for entry in response:
        if not is_person(entry):
            continue
        identity = entry.get("tozsamosc")
        if not isinstance(identity, dict):
            continue
        if comparable_only:
            types = connection_types(entry)
            if types and types <= TYPES_NOT_IN_THE_REGISTER:
                continue
        person = PlainPerson.build(
            str(identity.get("nazwisko", "") or ""),
            str(identity.get("imie", "") or ""),
        )
        if person is not None:
            people.append(person)
    return people


def is_present(censored: CensoredPerson, people: list[PlainPerson]) -> bool:
    """Whether rejestr.io named somebody this censored person could be."""
    wanted = censored_surname_signatures(censored.surname)
    given = signature(censored.given)
    if not wanted or given is None:
        # Nothing to match on. Treat as present rather than invent a gap.
        return True
    return any(person.given == given and wanted & person.surnames for person in people)


def comparable(censored: CensoredPerson) -> bool:
    """Whether this person's absence from rejestr.io would mean anything."""
    return censored.role.split(":")[0].strip() not in ROLES_REJESTRIO_OMITS


def comparable_people(censored_people) -> list[CensoredPerson]:
    """Those whose absence from a rejestr.io response would mean something."""
    return [person for person in censored_people if comparable(person)]


def missing_from_response(censored_people, response) -> list[CensoredPerson]:
    """The people api-krs lists that a rejestr.io response does not name."""
    people = people_in_response(response)
    return [
        person
        for person in comparable_people(censored_people)
        if not is_present(person, people)
    ]


def named_by(censored: CensoredPerson, person: PlainPerson) -> bool:
    """Whether a censored person could be this plain one."""
    wanted = censored_surname_signatures(censored.surname)
    given = signature(censored.given)
    return bool(wanted and given == person.given and wanted & person.surnames)


def phantoms_in_response(censored_people, response) -> list[PlainPerson]:
    """The people a rejestr.io response names that the register does not.

    The other direction of the same staleness, and the more visible one: a seat
    rejestr.io still shows as held is published as a live connection, where a
    seat it has not heard about yet is merely absent. Ties the register does
    not record at all are dropped first - see TYPES_NOT_IN_THE_REGISTER.
    """
    listed = comparable_people(censored_people)
    return [
        person
        for person in people_in_response(response, comparable_only=True)
        if not any(named_by(censored, person) for censored in listed)
    ]
