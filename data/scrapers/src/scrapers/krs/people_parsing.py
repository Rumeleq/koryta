"""Parsing of censored people from api-krs.ms.gov.pl JSON responses.

api-krs serves personal data masked: every name arrives as its first character
followed by one asterisk per remaining character, so "Kaliszewski" comes back
as ``K**********``. What survives is the initial and the length, which is
enough to tell two board members apart.

Covers dzial1 (partners) and dzial2 (representation, supervision, proxies).
"""

from dataclasses import dataclass

#: The sections of dzial2 that hold a list of people directly, rather than
#: wrapping them in an organ with a ``sklad``. `prokurenci` belongs here and
#: not with `reprezentacja`: the API spells a proxy list as a bare list, and
#: reading it as an organ silently found nobody.
DZIAL2_PERSON_LISTS = (
    ("prokurenci", "prokurent", "rodzajProkury"),
    ("pelnomocnicy", "pelnomocnik", ""),
    ("osobyReprezentujacePZ", "osoba_pz", ""),
)


@dataclass(frozen=True, order=True)
class CensoredPerson:
    """One person as api-krs masks them, with the role they hold.

    ``surname`` keeps the components apart because the register does:
    "Kałuża Swoboda" arrives as ``nazwiskoICzlon`` plus ``nazwiskoIICzlon``,
    and folding the two into one string would make her indistinguishable from
    a "Kałuża" who holds a different seat.

    ``born`` is the one field here the register does not mask. It is carried
    for the same reason as ``pesel``: for 347 people in the crawl it is the
    only identifier there is, and without it two masked namesakes in the same
    role hash alike and a replacement of one by the other is invisible.
    """

    surname: tuple[str, ...]
    given: str
    second_given: str
    pesel: str
    born: str
    role: str

    def as_row(self) -> list[str]:
        """A JSON-serialisable form, for a pipeline column."""
        return [
            "|".join(self.surname),
            self.given,
            self.second_given,
            self.pesel,
            self.born,
            self.role,
        ]

    @staticmethod
    def from_row(row) -> "CensoredPerson":
        surname, given, second_given, pesel, born, role = row
        return CensoredPerson(
            # "|" rather than a space: a censored component is asterisks, but
            # nothing promises the register never puts a space inside one, and
            # a separator that cannot occur makes the round trip total.
            surname=tuple(s for s in str(surname).split("|") if s),
            given=str(given),
            second_given=str(second_given),
            pesel=str(pesel),
            born=str(born),
            role=str(role),
        )


def parse_person(p: dict, role: str) -> CensoredPerson | None:
    """Parse a single person dict into a CensoredPerson, or None."""
    if not isinstance(p, dict):
        return None

    nazwisko = p.get("nazwisko")
    surname: tuple[str, ...] = ()
    if isinstance(nazwisko, dict):
        surname = tuple(
            str(nazwisko[key])
            for key in ("nazwiskoICzlon", "nazwiskoIICzlon")
            if nazwisko.get(key)
        )

    imiona = p.get("imiona")
    if not isinstance(imiona, dict):
        imiona = {}
    imie = str(imiona.get("imie", "") or "")
    imie2 = str(imiona.get("imieDrugie", "") or "")

    identyfikator = p.get("identyfikator")
    if not isinstance(identyfikator, dict):
        identyfikator = {}
    pesel = str(identyfikator.get("pesel", "") or "")
    born = str(identyfikator.get("dataUrodzenia", "") or "")

    if not (surname or imie or pesel or born):
        return None
    return CensoredPerson(
        surname=surname,
        given=imie,
        second_given=imie2,
        pesel=pesel,
        born=born,
        role=role,
    )


def extract_sklad(
    container: dict,
    key: str,
    role_prefix: str,
    role_field: str,
) -> list[CensoredPerson]:
    """Extract people from a 'sklad' list inside a container dict."""
    results: list[CensoredPerson] = []
    section = container.get(key, {})
    if not isinstance(section, dict):
        return results
    sklad = section.get("sklad", [])
    if not isinstance(sklad, list):
        return results
    for p in sklad:
        function = p.get(role_field, "") if isinstance(p, dict) else ""
        parsed = parse_person(p, f"{role_prefix}: {function}")
        if parsed:
            results.append(parsed)
    return results


def extract_person_list(
    container: dict,
    key: str,
    role: str,
    role_field: str,
) -> list[CensoredPerson]:
    """Extract people from a plain list of person dicts."""
    results: list[CensoredPerson] = []
    section = container.get(key, [])
    if not isinstance(section, list):
        return results
    for p in section:
        detail = p.get(role_field, "") if role_field and isinstance(p, dict) else ""
        parsed = parse_person(p, f"{role}: {detail}" if detail else role)
        if parsed:
            results.append(parsed)
    return results


def extract_dzial1_people(dane: dict) -> set[CensoredPerson]:
    """Extract people from dzial1 (wspolnicySpzoo).

    Most partners are companies rather than people; those carry a ``nazwa``
    and a ``krs`` and no name fields, so `parse_person` drops them.
    """
    dzial1 = dane.get("dzial1", {})
    if not isinstance(dzial1, dict):
        return set()
    return set(extract_person_list(dzial1, "wspolnicySpzoo", "wspolnik", ""))


def extract_dzial2_people(dane: dict) -> set[CensoredPerson]:
    """Extract people from dzial2 (representation, supervision, etc.)."""
    people: set[CensoredPerson] = set()
    dzial2 = dane.get("dzial2", {})
    if not isinstance(dzial2, dict):
        return people

    for t in extract_sklad(
        dzial2,
        "reprezentacja",
        "reprezentacja",
        "funkcjaWOrganie",
    ):
        people.add(t)

    # organNadzoru (can be list or dict)
    organ_nadzoru = dzial2.get("organNadzoru", {})
    organs = organ_nadzoru if isinstance(organ_nadzoru, list) else [organ_nadzoru]
    for organ in organs:
        if isinstance(organ, dict):
            for t in extract_sklad(
                {"o": organ},
                "o",
                "nadzor",
                "funkcjaWOrganie",
            ):
                people.add(t)

    # reprezentacjaIBIGBPPSPZOZ (single person dict)
    rep_pzoz = dzial2.get("reprezentacjaIBIGBPPSPZOZ", {})
    if isinstance(rep_pzoz, dict):
        parsed = parse_person(rep_pzoz, "kierownik_pzoz")
        if parsed:
            people.add(parsed)

    for key, role, role_field in DZIAL2_PERSON_LISTS:
        people.update(extract_person_list(dzial2, key, role, role_field))

    return people


def is_odpis(data) -> bool:
    """Whether a parsed api-krs response actually carries a register entry.

    Checks the header and the body, not just the envelope. A query against the
    wrong register answers 404 with a JSON body, which has no ``odpis`` at all;
    but an ``odpis`` present and empty would pass a shallower check and become
    a snapshot of a company with nobody in it - which is exactly how the 404
    body used to read as the whole board resigning. Every one of the 13,139
    real entries in the crawl carries both of these.
    """
    if not isinstance(data, dict):
        return False
    odpis = data.get("odpis")
    if not isinstance(odpis, dict):
        return False
    header = odpis.get("naglowekA")
    if not isinstance(header, dict) or not header.get("numerKRS"):
        return False
    dane = odpis.get("dane")
    return isinstance(dane, dict) and bool(dane)


def extract_censored_people(data: dict) -> set[CensoredPerson]:
    """Extract all censored people from an api-krs JSON response.

    Returns an empty set for anything that is not an odpis - api-krs answers a
    query against the wrong register with a 404 body, which parses as JSON and
    would otherwise read as a company with nobody in it.
    """
    if not is_odpis(data):
        return set()

    dane = data["odpis"]["dane"]
    return extract_dzial1_people(dane) | extract_dzial2_people(dane)
