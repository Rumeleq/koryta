"""What an announcement says about the company itself, rather than its people.

Dział 1 opens with the company: rubryka 1 is its name and identifiers, rubryka
2 its seat. Both are published the same way as everything else -- only when
they change -- so a company's current address comes from the last announcement
that touched Rub. 2, which may be twenty years old, and most announcements say
nothing about either.

The announcement's own ``entityName`` is the fallback and usually the better
answer: the search index carries the name the register held at publication,
for every announcement, including the ones that changed nothing about it.
"""

import re
from dataclasses import dataclass

from scrapers.msig.entries import Entry

#: Rub. 1 field 2, where the register puts REGON: 9 digits, or 14 for a unit
#: of a larger entity.
_REGON = re.compile(r"^\d{9}(\d{5})?$")

#: The seat is one run-on field -- "kraj POLSKA województwo ŚLĄSKIE powiat
#: M. KATOWICE gmina M. KATOWICE miejscowość KATOWICE" -- with the town last.
_TOWN = re.compile(r"miejscowość\s+(.+?)\s*$")

#: And the street is the next one, with the postal code in the middle of it.
_POSTAL_CODE = re.compile(r"kod\s*pocztowy\s+(\d{2}-\d{3})")


@dataclass(frozen=True)
class Identity:
    """What one announcement stated about the company. Any field may be None."""

    name: str | None = None
    regon: str | None = None
    city: str | None = None
    postal_code: str | None = None

    def merge(self, older: "Identity") -> "Identity":
        """This identity, falling back to an older one field by field.

        Called newest-first, so what the newer announcement stated wins and
        the older one only fills the gaps -- which is most of them, since an
        announcement states only what changed.
        """
        return Identity(
            name=self.name or older.name,
            regon=self.regon or older.regon,
            city=self.city or older.city,
            postal_code=self.postal_code or older.postal_code,
        )


def clean_name(name: str | None) -> str | None:
    """A company name as the announcement prints it, tidied.

    The typesetting leaves doubled spaces inside the name and a full stop
    after it -- "POLSKIE KOLEJE PAŃSTWOWE  SPÓŁKA AKCYJNA." -- neither of
    which is part of what the company is called.
    """
    if not name:
        return None
    return re.sub(r"\s+", " ", name).strip().rstrip(".").strip() or None


def identity_in(entries: list[Entry]) -> Identity:
    """The company facts one announcement's entries carry."""
    identity = Identity()
    for entry in entries:
        if entry.dzial != 1:
            continue
        if entry.rubryka == 1:
            regon = (entry.fields.get(2) or "").replace(" ", "")
            identity = Identity(
                name=clean_name(entry.fields.get(3)) or identity.name,
                regon=regon if _REGON.match(regon) else identity.regon,
                city=identity.city,
                postal_code=identity.postal_code,
            )
        elif entry.rubryka == 2:
            town = _TOWN.search(entry.fields.get(1) or "")
            code = _POSTAL_CODE.search(entry.fields.get(2) or "")
            identity = Identity(
                name=identity.name,
                regon=identity.regon,
                city=town.group(1).strip() if town else identity.city,
                postal_code=code.group(1) if code else identity.postal_code,
            )
    return identity
