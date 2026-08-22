"""What kind of body supervises a company, per dzial2 of an OdpisAktualny.

Two organs the register spells almost alike mean opposite things about money.
A *rada nadzorcza* is the supervisory board of a commercial company, and a
seat on it is as a rule paid - a JST-owned spółka must have one (art. 10a
ust. 1 ustawy o gospodarce komunalnej) and the zgromadzenie wspólników sets
the pay by uchwała, capped by the ustawa z 9 czerwca 2016 r. A *rada
społeczna* is the statutory advisory organ of a samodzielny publiczny zakład
opieki zdrowotnej, and the ustawa o działalności leczniczej gives its members
no wynagrodzenie and no dieta at all - only, under art. 48 ust. 9-10, the
wages they actually lost by attending. Counting the two together answers
"who pays themselves how much" with a number that is mostly unpaid seats: at
publicly owned hospitals in the crawl there are 521 rada-nadzorcza seats
against 1,770 rada-społeczna ones.

The register writes the distinction on the *organ* and not on its members: an
entry under ``dzial2.organNadzoru`` carries its ``nazwa`` beside the ``sklad``
of people, and ``funkcjaWOrganie`` - the field that would say it on the person
- is absent on all 52,146 supervisory members in the crawl. So the kind can
only come from the container, which is why `scrapers.krs.people_parsing` grew
a container field to carry it.

``nazwa`` is free text and is spelled 117 different ways across the crawl:
"RADA  NADZORCZA" with two spaces, "RADA NADZROCZA" and "RADA NADZ0RCZA" (a
digit zero) transposed and mistyped, "RADA NADZORCZA SPÓŁKI TAURON SERWIS
SP.Z O.O." and "RADA SPOŁECZNA PRZY SAMODZIELNYM PUBLICZNYM ZAKŁADZIE OPIEKI
ZDROWOTNEJ W LASKOWEJ" suffixed, "RADA SPOLECZNA" undiacriticked, and 4 with
no ``nazwa`` at all. An alternation of the spellings anybody has seen so far
misses the next one silently, so the classification folds the string and then
allows a bounded number of typos in the one word that decides it. Measured
over every organ on one crawl of each of the 7,840 companies: 3,614
rada_nadzorcza, 1,293 komisja_rewizyjna, 468 rada_spoleczna, 241 inny and 4
nieznany, with every one of the 117 distinct strings read by hand and none of
them in the wrong bucket.
"""

import re
import unicodedata

#: What one organ can turn out to be.
#:
#: ``inny`` is a body that is neither - a rada fundacji, a rada izby, a
#: minister named as the supervisor - and ``nieznany`` is an organ the
#: register listed without naming. The two are kept apart because they say
#: different things: one is evidence about the company, the other is a gap.
ORGAN_KINDS = (
    "rada_nadzorcza",
    "rada_spoleczna",
    "komisja_rewizyjna",
    "inny",
    "nieznany",
)

#: The company-level answers, most significant first.
#:
#: A company with two organs collapses to one value, and this is the order in
#: which they win. Only 20 of 7,840 companies list two, and none anywhere
#: lists both a rada nadzorcza and a rada społeczna, so the choice between
#: those two never actually fires - but the unpaid reading is put first
#: deliberately, so that if it ever does, a seat gets left out of a page about
#: pay rather than wrongly counted into one.
#:
#: ``brak`` closes the set: the register listed no supervisory organ. It is
#: emphatically not evidence of a rada nadzorcza - 719 of 1,192 SPZOZ register
#: no organ at all, because a rada społeczna is created by statute rather than
#: by an entry - so a reader must exclude on the legal form as well.
SUPERVISION_KINDS = (
    "rada_spoleczna",
    "rada_nadzorcza",
    "komisja_rewizyjna",
    "inny",
    "nieznany",
    "brak",
)


def _tokens(nazwa) -> list[str]:
    """An organ name reduced to the words a comparison can be made on.

    Diacritics go (so "SPOŁECZNA" and "SPOLECZNA" are one string), ``Ł`` by
    hand because NFKD does not decompose it, and ``0`` to ``O`` because the
    register contains "RADA NADZ0RCZA". Punctuation and runs of spaces become
    single separators, which is what folds "RADA  NADZORCZA" and "RADA
    SPOŁECZNA - ORGAN OPINIODAWCZY I DORADCZY" into the same shape as the rest.
    """
    if not isinstance(nazwa, str):
        return []
    folded = unicodedata.normalize("NFKD", nazwa.upper())
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    folded = folded.replace("Ł", "L").replace("0", "O")
    return [token for token in re.split(r"[^0-9A-Z]+", folded) if token]


def _close(word: str, target: str, limit: int) -> bool:
    """Whether `word` is `target` with at most `limit` characters wrong.

    Levenshtein, banded by a cheap length check and abandoned as soon as every
    way of aligning the prefix already costs more than `limit`. The words
    compared are one register field long, so the cost of the full table would
    not matter either; the early exit is here to make it obvious that a long
    company name cannot accidentally be two edits from "NADZORCZA".
    """
    if abs(len(word) - len(target)) > limit:
        return False

    previous = list(range(len(target) + 1))
    for i, a in enumerate(word, start=1):
        current = [i]
        for j, b in enumerate(target, start=1):
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + (a != b),
                )
            )
        if min(current) > limit:
            return False
        previous = current
    return previous[-1] <= limit


def organ_kind(nazwa) -> str:
    """Which of `ORGAN_KINDS` an organ's ``nazwa`` names.

    The word that decides it is the one right after "RADA", so only the two
    tokens following the head are considered. Reading the whole string would
    let a suffix overrule the name: "RADA NADZORCZA FUNDACJI EKONOMII
    SPOŁECZNEJ" ends in the same word declined, two edits from "SPOŁECZNA",
    and a paid board would be read as an unpaid one and left out of the very
    page this exists for.

    Two typos are allowed in that word and one in "RADA": the transpositions
    the register actually contains ("NADZROCZA", "NAZDORCZA") cost two, and
    among nine letters nothing but an inflection of the same word comes that
    close - which is what the window is for.
    """
    tokens = _tokens(nazwa)
    if not tokens:
        return "nieznany"

    head_is_rada = _close(tokens[0], "RADA", 1)
    qualifier = tokens[1:3]
    # Społeczna first: see SUPERVISION_KINDS on why the unpaid reading wins.
    if head_is_rada and any(_close(token, "SPOLECZNA", 2) for token in qualifier):
        return "rada_spoleczna"
    if head_is_rada and any(_close(token, "NADZORCZA", 2) for token in qualifier):
        return "rada_nadzorcza"
    # A komisja rewizyjna is not a rada, so nothing about it sits at a fixed
    # position - "GŁÓWNA KOMISJA REWIZYJNA ZWIĄZKU OSP RP", "NACZELNA KOMISJA
    # SĄDOWNICZO-REWIZYJNA" - and the whole name is searched instead. That is
    # safe here and would not be above: this line is only reached once neither
    # rada reading held, so a wandering match cannot overrule one.
    if any(_close(token, "REWIZYJNA", 2) for token in tokens):
        return "komisja_rewizyjna"
    return "inny"


def organs(dzial2) -> list[dict]:
    """The supervisory organs a dzial2 lists.

    ``organNadzoru`` is a list in all 12,363 entries in the crawl that have
    one, but it is read tolerantly for the same reason every other section is:
    reading a section as the wrong shape finds nothing and says nothing.
    """
    if not isinstance(dzial2, dict):
        return []
    node = dzial2.get("organNadzoru")
    if isinstance(node, dict):
        node = [node]
    if not isinstance(node, list):
        return []
    return [organ for organ in node if isinstance(organ, dict)]


def supervision_kind(dzial2) -> str:
    """One `SUPERVISION_KINDS` value for a whole company's dzial2."""
    kinds = {organ_kind(organ.get("nazwa")) for organ in organs(dzial2)}
    for kind in SUPERVISION_KINDS:
        if kind in kinds:
            return kind
    return "brak"
