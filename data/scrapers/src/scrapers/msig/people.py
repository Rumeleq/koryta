"""Turning parsed entries into the people they name.

Which rubryka an entry sits under is what says whether it names a person at
all, and what that person was to the company. The table below is matched on
the rubryka's own name rather than on its number, because the numbering is not
stable across the register's forms -- a limited company's shareholders are
Dz. 1 Rub. 7 and a partnership's partners are Dz. 1 Rub. 7 too, but a
cooperative's supervisory board is not where a company's is.

Anything under a rubryka this table does not know is dropped, and dropping is
counted: a rubryka that holds PESEL-shaped fields and is not classified here
is a kind of post nobody has taught this module about, which is worth a line
of output rather than silence.
"""

import re
import typing
from dataclasses import dataclass, replace

from scrapers.msig.entries import Action, Entry

#: 11 digits. The check digit is not verified -- a mistyped PESEL in the
#: register is still the PESEL the register holds, and matching is done
#: against the register.
_PESEL = re.compile(r"^\d{11}$")

#: 9 or 14 digits, which is what a company carries where a person carries a
#: PESEL. Its presence is how an entity shareholder is told from a human one.
_REGON = re.compile(r"^\d{9}(\d{5})?$")

#: Values that are flags rather than a post. The function field moved between
#: 4 and 5 over the years, so it is found by eliminating these instead.
_FLAGS = {"TAK", "NIE"}

#: The most given names or surname parts a person is recorded with. The cap is
#: what tells a name apart from the prose that shares its field numbers: the
#: organ's own entry is ``1. ZARZĄD 2. DO REPREZENTOWANIA SPÓŁKI ...``, and an
#: address is ``1. kraj POLSKA województwo ŚLĄSKIE ...``.
_NAME_WORDS = 4


@dataclass(frozen=True)
class Person:
    """One person as one KRS entry recorded them."""

    last_name: str
    first_names: str | None
    pesel: str | None
    role: str
    action: Action
    position: int | None
    dzial: int
    rubryka: int

    @property
    def full_name(self) -> str:
        """Given names first, the way every other pipeline here spells one."""
        if not self.first_names:
            return self.last_name
        return f"{self.first_names} {self.last_name}"


def _matches(name: str, *needles: str) -> bool:
    lowered = name.lower()
    return any(needle in lowered for needle in needles)


def _function(entry: Entry) -> str | None:
    """The post held, from whichever field this vintage of entry put it in.

    2003: ``4. PREZES ZARZĄDU 5. NIE``. 2024: ``5. CZŁONEK ZARZĄDU 6. NIE``,
    field 4 having become the entity's KRS in between. So: the first of the
    two that is neither a flag nor an identifier.
    """
    for number in (5, 4):
        value = entry.fields.get(number)
        if not value or value.upper() in _FLAGS or value.isdigit():
            continue
        return value.title()
    return None


def _role(entry: Entry) -> str | None:
    """What this entry's rubryka makes the person, or None if it names none."""
    rubryka, subrubryka = entry.rubryka_name, entry.subrubryka or ""

    if _matches(rubryka, "prokuren"):
        return "Prokurent"
    if _matches(rubryka, "pełnomocnik"):
        return "Pełnomocnik"
    if _matches(rubryka, "nadzor") and not _matches(rubryka, "nadzorca"):
        return "Rada Nadzorcza"
    if _matches(rubryka, "likwidat") or _matches(subrubryka, "likwidat"):
        return "Likwidator"
    if _matches(rubryka, "kurator") or _matches(subrubryka, "kurator"):
        return "Kurator"
    if _matches(rubryka, "syndyk", "zarządc", "nadzorca") or _matches(
        subrubryka, "syndyk", "zarządc", "nadzorca"
    ):
        return "Syndyk"
    if _matches(rubryka, "reprezentacji", "reprezentowania", "reprezentujący"):
        # Rub. 1 carries the organ itself (its name, how it signs) before it
        # carries anybody; only the sub-rubryka holds people.
        if not subrubryka:
            return None
        if _matches(subrubryka, "wspólnik"):
            return _function(entry) or "Wspólnik reprezentujący spółkę"
        return _function(entry) or "Zarząd"
    if _matches(subrubryka, "komplementariusz"):
        return "Komplementariusz"
    if _matches(subrubryka, "komandytariusz"):
        return "Komandytariusz"
    if _matches(rubryka, "wspólni", "akcjonariusz", "udziałowc"):
        return "Wspólnik"
    return None


def _name_shaped(value: str | None) -> bool:
    """Whether a field could be somebody's name and not prose.

    Names are set in capitals throughout, which is what separates them from an
    address ("kraj POLSKA ...") without having to know the field layout of
    every rubryka in the register.
    """
    if not value or len(value) > 60:
        return False
    if any(character.isdigit() for character in value):
        return False
    if value != value.upper():
        return False
    return len(value.split()) <= _NAME_WORDS


def _identity(entry: Entry) -> tuple[str, str | None, str | None] | None:
    """Surname, given names and PESEL, or None where the entry names no human.

    A shareholder that is a company sits in the same rubryka in the same
    shape, with a REGON where a person has a PESEL and no given names at all.
    """
    last_name = entry.fields.get(1)
    if not _name_shaped(last_name):
        return None
    assert last_name is not None

    first_names = entry.fields.get(2)
    identifier = (entry.fields.get(3) or "").replace(" ", "")
    has_pesel = bool(_PESEL.match(identifier))

    if _REGON.match(identifier) and not has_pesel:
        return None
    if not has_pesel and not _name_shaped(first_names):
        # No PESEL and nothing that reads as given names: an organ's own entry
        # ("ZARZĄD" / "DO REPREZENTOWANIA SPÓŁKI ..."), a foreign entity, or a
        # rubryka this module has misread. None of them is a person.
        return None

    return last_name, first_names, identifier if has_pesel else None


def _is_organ_header(entry: Entry) -> bool:
    """Whether this is the organ's own line rather than one of its members.

    ``Rub. 1`` opens with what the organ is called and how it signs -- ``1.
    ZARZĄD 2. KAŻDY CZŁONEK ZARZĄDU SAMODZIELNIE`` -- in the same two fields a
    person's name would use. Known and deliberately dropped, so it must not be
    counted as a rubryka nobody has classified.
    """
    return entry.subrubryka is None and _matches(
        entry.rubryka_name, "reprezentacji", "reprezentowania", "reprezentujący"
    )


def _referenced_pesel(entries: list[Entry], index: int) -> str | None:
    """A PESEL added to somebody who was already in the register.

    ``1 (dla pozycji: 1. BREAGY 2. DEREK) wpisać: 3. 69081214630`` is one
    entry naming a sitting board member and another carrying the number now
    being recorded for them. Split across two entries, each half is useless:
    a name with no PESEL, and a PESEL with nobody attached.
    """
    reference = entries[index]
    for entry in entries[index + 1 :]:
        same_rubryka = (
            entry.dzial,
            entry.rubryka,
            entry.subrubryka,
        ) == (reference.dzial, reference.rubryka, reference.subrubryka)
        if not same_rubryka or entry.action is Action.REFERENCE:
            return None
        if entry.fields.get(1):
            return None
        if entry.position not in (None, reference.position):
            return None
        pesel = (entry.fields.get(3) or "").replace(" ", "")
        if _PESEL.match(pesel):
            return pesel
    return None


def _resolve_references(entries: typing.Iterable[Entry]) -> list[Entry]:
    """Give each reference the PESEL its amendment carried, where there is one."""
    resolved = list(entries)
    for index, entry in enumerate(resolved):
        if entry.action is not Action.REFERENCE or entry.fields.get(3):
            continue
        pesel = _referenced_pesel(resolved, index)
        if pesel:
            resolved[index] = replace(entry, fields={**entry.fields, 3: pesel})
    return resolved


def people_in(
    entries: typing.Iterable[Entry],
    unclassified: typing.Counter[str] | None = None,
) -> typing.Iterator[Person]:
    """Every person the entries name, with what each was to the company."""
    for entry in _resolve_references(entries):
        identity = _identity(entry)
        if identity is None:
            continue
        role = _role(entry)
        if role is None:
            if unclassified is not None and not _is_organ_header(entry):
                unclassified[
                    f"Dz.{entry.dzial} Rub.{entry.rubryka} "
                    f"{entry.rubryka_name}"
                    + (f" / {entry.subrubryka}" if entry.subrubryka else "")
                ] += 1
            continue
        last_name, first_names, pesel = identity
        yield Person(
            last_name=last_name,
            first_names=first_names,
            pesel=pesel,
            role=role,
            action=entry.action,
            position=entry.position,
            dzial=entry.dzial,
            rubryka=entry.rubryka,
        )
