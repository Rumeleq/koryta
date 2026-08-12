"""Reading a KRS entry out of the announcement that published it.

An MSiG announcement carries the entry as the register writes it -- the same
działy, rubryki and numbered fields as an odpis, flattened into one line of
prose::

    W dniu 26.01.2024 dokonano wpisu do rejestru KRS nr 17 następującej treści:
    Dz. 1. Rub. 7. Dane wspólników wykreślić: 1 1. GOSIEWSKI 2. STANISŁAW
    ANTONI 3. 69032811497 5. 50 UDZIAŁÓW ... 6. NIE  Dz. 2. Rub. 1. Organ
    uprawniony do reprezentacji podmiotu 1 (dla pozycji: 1. ZARZĄD SPÓŁKI)
    PRub. Dane osób wchodzących w skład organu wykreślić: 1 1. GOSIEWSKI
    2. STANISŁAW ANTONI 3. 69032811497 5. CZŁONEK ZARZĄDU 6. NIE

Which is the whole point of this source: ``69032811497`` and ``GOSIEWSKI
STANISŁAW ANTONI``, in full, for an entry the open KRS API will only ever
show as ``G******* S********`` with a PESEL of ``6**********``.

Three things about the shape are worth knowing before reading the code.

**An announcement is a diff, not a state.** ``wpisać``/``wykreślić`` mark what
was added and removed; everything else stayed. The exception is a *wpis
pierwszy* (chapter "1. Wpisy pierwsze"), which has no markers at all and
states the register in full -- :data:`Action.STATE`.

**Field numbers moved.** A board member reads ``1. Nazwisko 2. Imiona
3. PESEL 4. Funkcja 5. Zawieszony`` in a 2003 entry and ``1. Nazwisko
2. Imiona 3. PESEL 5. Funkcja 6. Zawieszony`` in a 2024 one, where 4 became
the entity's KRS. So the function is read as "the first of fields 4 and 5 that
is not a yes/no flag and not an identifier", never as a fixed position.

**``(dla pozycji: ...)`` is a reference.** It names a person already in the
register whose *other* fields are being amended, so it is neither an
appointment nor a dismissal -- :data:`Action.REFERENCE`. Parsing it as an
insert would appoint people who were already there, and its inner ``1. 2. 3.``
would otherwise be read as a new entry's fields.
"""

import re
import typing
from dataclasses import dataclass, field
from enum import Enum


class Action(Enum):
    """What an entry says happened to the thing it describes."""

    ADD = "wpisac"
    REMOVE = "wykreslic"
    #: A *wpis pierwszy*: no marker, because nothing is being changed yet.
    STATE = "stan"
    #: ``(dla pozycji: ...)`` -- named only to be amended. See module docstring.
    REFERENCE = "dla_pozycji"


@dataclass(frozen=True)
class Entry:
    """One numbered item under one rubryka -- a person, a PKD code, a filing."""

    dzial: int
    rubryka: int
    rubryka_name: str
    subrubryka: str | None
    action: Action
    position: int | None
    fields: dict[int, str] = field(default_factory=dict)

    def get(self, *numbers: int) -> str | None:
        """The first of `numbers` this entry carries, ignoring blanks."""
        for number in numbers:
            value = self.fields.get(number)
            if value:
                return value
        return None


@dataclass(frozen=True)
class Body:
    """One announcement's entry, parsed."""

    #: When the court made the entry, ISO-8601. The publication date is days
    #: to weeks later and lives on the announcement, not in its text.
    entry_date: str | None
    #: The register's own running count of entries for this company.
    entry_number: int | None
    entries: list[Entry]


_HEADER = re.compile(
    r"W\s*dniu\s*(\d{2})\.(\d{2})\.(\d{4})\s*dokonano\s*wpisu\s*do\s*rejestru"
    r"(?:\s*KRS)?\s*(?:nr\s*(\d+))?[^:]*:",
)

#: Every boundary the walk in `_scan` recognises, longest-first so that
#: ``PRub.`` never matches as ``Rub.`` and a rubryka number never matches as a
#: field number. ``field`` demands a space after the dot, which is what keeps
#: ``2.500,00 ZŁ`` and ``27.11.1991`` out of it.
_MARKER = re.compile(
    r"(?P<dzial>Dz\.\s*(?P<dzial_no>\d+)\s*\.?)"
    r"|(?P<prub>PRub\.)"
    r"|(?P<rubryka>Rub\.\s*(?P<rubryka_no>\d+)\s*\.?)"
    r"|(?P<add>wpisać\s*:)"
    r"|(?P<remove>wykreślić\s*:)"
    # The colon is optional: entries from before roughly 2010 write
    # "(dla pozycji 1. ZARZĄD)" without one.
    r"|(?P<reference>(?:(?P<ref_pos>\d+)\s+)?\(dla\s*pozycji\s*:?(?P<ref_body>[^)]*)\))"
    r"|(?P<position>(?<=\s)(?P<position_no>\d+)\s+(?=1\.\s))"
    r"|(?P<field>(?<![\w.])(?P<field_no>\d{1,2})\.\s)"
)

#: A rubryka's name runs from its number to the first thing that is not a
#: name. Older entries put un-numbered prose there instead ("Rub. 4 Umowa lub
#: statut 1 UMOWA SPÓŁKI ZAWARTA DNIA ..."), so it is cut short rather than
#: kept whole -- nothing downstream reads more than the first few words.
_NAME_LIMIT = 60


_MONTHS = (
    "STYCZNIA|LUTEGO|MARCA|KWIETNIA|MAJA|CZERWCA|LIPCA|SIERPNIA|"
    "WRZEŚNIA|PAŹDZIERNIKA|LISTOPADA|GRUDNIA"
)

#: The page furniture of the printed Monitor, which the JSON carries through
#: verbatim: the running head, and on issues from around 2010 the subscriber
#: watermark under it. It lands wherever the page broke, which is to say in
#: the middle of the entry and sometimes in the middle of a word.
_RUNNING_HEAD = (
    r"(?:MONITOR SĄDOWY I GOSPODARCZY\s*)?"
    r"(?:[IVXL]+\s*\.\s*)?WPISY DO KRAJOWEGO REJESTRU SĄDOWEGO"
    r"(?i:\s*/?\s*\d+\s*\.\s*Wpisy \w+)?"
    rf"\s*\d{{1,2}}\s+(?:{_MONTHS})\s+\d{{4}}\s*R\s*\."
    r"(?:\s*Odbiorca\s*:[^:]{0,40}ID\s*:\s*\S+)?"
)

#: A word hyphenated across the page break: the hyphen and the head both go,
#: and the two halves are joined -- "reprezentowa-<head> nia spółki" is
#: "reprezentowania spółki".
_HYPHENATED_HEAD = re.compile(r"-\s*" + _RUNNING_HEAD + r"\s*")
_HEAD = re.compile(_RUNNING_HEAD)


def normalize(text: str) -> str:
    """Collapse the run-on whitespace, and drop the page furniture.

    The announcement is set in two narrow columns, and the line breaks survive
    into the JSON as runs of spaces -- inside names as readily as between
    fields, so ``BIELECKA  JAKUBIAK`` is one surname broken over a line rather
    than two people.

    A word broken across a page break *without* a hyphen cannot be put back
    together and is left as two: "miej<head>scowość" becomes "miej scowość".
    That costs a token in a rubryka name now and then; guessing at the join
    would cost a wrong surname.
    """
    text = re.sub(r"\s+", " ", text.replace("\xa0", " "))
    text = _HYPHENATED_HEAD.sub("", text)
    text = _HEAD.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_body(text: str | None) -> Body:
    """Parse an announcement's ``textInBody`` into its entries."""
    if not text:
        return Body(entry_date=None, entry_number=None, entries=[])

    body = normalize(text)
    entry_date, entry_number = None, None
    header = _HEADER.search(body)
    if header:
        day, month, year, number = header.groups()
        entry_date = f"{year}-{month}-{day}"
        entry_number = int(number) if number else None
        body = body[header.end() :]

    return Body(
        entry_date=entry_date,
        entry_number=entry_number,
        entries=list(_scan(body)),
    )


class _Cursor:
    """Where in the entry the walk currently is, and what it has collected.

    Split out from `_scan` because "start a new entry, unless the one we have
    is empty" is the same decision at six different boundaries, and getting it
    wrong at one of them silently merges two people into one.
    """

    def __init__(self) -> None:
        self.dzial = 0
        self.rubryka = 0
        self.rubryka_name = ""
        self.subrubryka: str | None = None
        self.action = Action.STATE
        self.position: int | None = None
        self.fields: dict[int, str] = {}

    def flush(self) -> typing.Iterator[Entry]:
        """Emit what has been collected, if anything has."""
        if self.fields:
            yield Entry(
                dzial=self.dzial,
                rubryka=self.rubryka,
                rubryka_name=self.rubryka_name,
                subrubryka=self.subrubryka,
                action=self.action,
                position=self.position,
                fields=dict(self.fields),
            )
        self.fields = {}

    def add_field(self, number: int, value: str) -> typing.Iterator[Entry]:
        """Record a field, starting a new entry if this one repeats a number.

        A number that does not increase is the only boundary between two
        entries that were written without an ordinal between them -- which is
        how the first entry under a rubryka is always written.
        """
        if number in self.fields or (self.fields and number < max(self.fields)):
            yield from self.flush()
            self.position = None
        self.fields[number] = value


def _fields_of(text: str) -> dict[int, str]:
    """The numbered fields of a fragment that holds nothing else.

    Used for ``(dla pozycji: ...)``, whose body is a plain field list.
    """
    fields: dict[int, str] = {}
    matches = list(re.finditer(r"(?<![\w.])(\d{1,2})\.\s", text))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        fields[int(match.group(1))] = text[match.end() : end].strip(" .,")
    return fields


def _scan(body: str) -> typing.Iterator[Entry]:  # noqa: C901 - one walk, one state
    """Walk the entry left to right, emitting an Entry per numbered item."""
    cursor = _Cursor()
    pending_field: int | None = None
    pending_from = 0

    def value_up_to(end: int) -> str:
        return body[pending_from:end].strip(" .,")

    for marker in _MARKER.finditer(body):
        if pending_field is not None:
            yield from cursor.add_field(pending_field, value_up_to(marker.start()))
            pending_field = None

        kind = marker.lastgroup
        if marker.group("dzial"):
            yield from cursor.flush()
            cursor.dzial = int(marker.group("dzial_no"))
            cursor.rubryka, cursor.rubryka_name = 0, ""
            cursor.subrubryka, cursor.position = None, None
            cursor.action = Action.STATE
        elif marker.group("rubryka"):
            yield from cursor.flush()
            cursor.rubryka = int(marker.group("rubryka_no"))
            cursor.rubryka_name = _name_after(body, marker.end())
            cursor.subrubryka, cursor.position = None, None
            cursor.action = Action.STATE
        elif marker.group("prub"):
            yield from cursor.flush()
            cursor.subrubryka = _name_after(body, marker.end()) or None
            cursor.position = None
        elif marker.group("add") or marker.group("remove"):
            yield from cursor.flush()
            cursor.action = Action.ADD if marker.group("add") else Action.REMOVE
            cursor.position = None
        elif marker.group("reference"):
            yield from cursor.flush()
            position = marker.group("ref_pos")
            cursor.position = int(position) if position else None
            reference = _fields_of(marker.group("ref_body"))
            if reference:
                yield Entry(
                    dzial=cursor.dzial,
                    rubryka=cursor.rubryka,
                    rubryka_name=cursor.rubryka_name,
                    subrubryka=cursor.subrubryka,
                    action=Action.REFERENCE,
                    position=cursor.position,
                    fields=reference,
                )
        elif marker.group("position"):
            yield from cursor.flush()
            cursor.position = int(marker.group("position_no"))
        elif kind == "field" or marker.group("field"):
            pending_field = int(marker.group("field_no"))
            pending_from = marker.end()

    if pending_field is not None:
        yield from cursor.add_field(pending_field, value_up_to(len(body)))
    yield from cursor.flush()


def _name_after(body: str, start: int) -> str:
    """The rubryka name that follows a ``Rub.``/``PRub.`` marker."""
    next_marker = _MARKER.search(body, start)
    end = next_marker.start() if next_marker else len(body)
    return normalize(body[start : min(end, start + _NAME_LIMIT)]).strip(" .,")
