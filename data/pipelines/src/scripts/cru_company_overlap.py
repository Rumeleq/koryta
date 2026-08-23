"""How much of the contracts register we already know, and what the rest is.

Answers two questions about `cru_umowy` against `companies_merged`:

* how many of the companies we already hold also appear as a party to a public
  contract, matched on NIP;
* what the counterparties we do *not* hold actually are, so the cost of looking
  them up in KRS can be estimated before anyone pays for it.

The second question is the awkward one. CRU gives a counterparty a name, a NIP
and a REGON, and nothing else -- no legal form, no PKD. We only have PKD for a
company once it is already in `companies_merged`, which is exactly the set this
is trying to grow. So the classifier reads the legal form out of the name, and
`--validate` measures how well it does that against the one population where
the answer is known: the companies that appear in both sources demonstrably
have a KRS, so whatever the name rule says about them is a recall estimate.

    uv run python src/scripts/cru_company_overlap.py
    uv run python src/scripts/cru_company_overlap.py --validate
    uv run python src/scripts/cru_company_overlap.py --list komunalne > out.csv
"""

import argparse
import collections
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from stores.config import VERSIONED_DIR

# --------------------------------------------------------------------------
# Legal form, read out of the name.
#
# Poland keeps companies in KRS and sole traders in CEIDG, and only the first
# of those is a register we can look a counterparty up in. Nothing in CRU says
# which one an entity is in, but the legal form is part of the registered name,
# so the name carries it.
# --------------------------------------------------------------------------

#: Forms that are in KRS.
KRS_FORM = re.compile(
    r"SP[ÓO]?[ŁL]KA|SP\.?\s*Z\s*O\.?\s*O|\bZ\s*O\.?\s*O\.?|SP\.?\s*J\b|SP\.?\s*K\b"
    r"|AKCYJN|\bS\.?\s*A\.?$|FUNDACJ|STOWARZYSZ|SP[ÓO][ŁL]DZIELN"
    r"|PRZEDSI[ĘE]BIORSTWO PA[ŃN]STWOWE|OCHOTNICZA STRA[ŻZ]|\bKLUB\b|ZWI[ĄA]ZEK"
    r"|IZBA\b|INSTYTUT\b|SPZ[OZ]|SAMODZIELNY PUBLICZNY"
    r"|ZAK[ŁL]AD[ÓO]?W? (OPIEKI ZDROWOTNEJ|LECZNICTWA)|SZPITAL|CENTRUM KRWIODAWSTWA"
    r"|TOWARZYSTWO|PRZYCHODNIA|HOSPICJUM|SANATORIUM|UZDROWISKO|AGENCJA\b",
    re.I,
)

#: A spółka cywilna is a contract between sole traders. It has a NIP and a
#: REGON of its own and no KRS, and its name contains "spółka", so it has to be
#: taken back out before the form check above counts it.
CIVIL = re.compile(r"SP[ÓO][ŁL]KA CYWILNA|\bS\.?\s*C\.?\s*$|\bS\.?\s*C\.?[ ,]", re.I)

#: Budget units -- a gmina, a school, a library. In REGON, never in KRS.
BUDGET = re.compile(
    r"^GMINA|^MIASTO|^URZ[ĄA]D|^POWIAT|^WOJEW[ÓO]DZTWO|^STAROSTWO|SZKO[ŁL]A"
    r"|PRZEDSZKOLE|ZESP[ÓO][ŁL] SZK|OŚRODEK POMOCY|BIBLIOTEKA|DOM KULTURY"
    r"|CENTRUM USŁUG|KOMENDA|NADLE[ŚS]NICTWO|S[ĄA]D |PROKURATURA|MINISTERSTWO",
    re.I,
)

# --------------------------------------------------------------------------
# What kind of thing it is.
#
# PKD where we have it, the name otherwise. PKD is the better signal by far --
# it is what the entity told the register it does -- but we only ever have it
# for a company already in companies_merged.
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Kind:
    key: str
    label: str
    #: PKD 2007 section prefixes that mean this kind.
    pkd: tuple[str, ...] = ()
    #: Name patterns that mean this kind, for everything with no PKD.
    name: re.Pattern | None = None


KINDS = (
    Kind(
        "zdrowie",
        "health care -- hospitals, clinics, labs",
        pkd=("86.", "87.", "21."),
        name=re.compile(
            r"SZPITAL|PRZYCHODNIA|ZAK[ŁL]AD[ÓO]?W? (OPIEKI ZDROWOTNEJ|LECZNICTWA)"
            r"|SPZ[OZ]|\bZOZ\b|NZOZ|CENTRUM MEDYCZNE|MEDYCZN|HOSPICJUM|SANATORIUM"
            r"|UZDROWISKO|KRWIODAWSTWA|APTEKA|STOMATOLOG|REHABILITAC",
            re.I,
        ),
    ),
    Kind(
        "komunalne",
        "municipal utilities -- water, waste, heat, transport",
        pkd=("35.", "36.", "37.", "38.", "39.", "49.3"),
        name=re.compile(
            r"WODOCI[ĄA]G|KANALIZAC|CIEP[ŁL]OWN|ENERGETYK|GOSPODARKI KOMUNALNEJ"
            r"|GOSPODARKA KOMUNALNA|OCZYSZCZANIA|ZAK[ŁL]AD KOMUNALNY|USŁUG KOMUNALNYCH"
            r"|\bMPK\b|\bPKS\b|\bMPWIK\b|\bPEC\b|KOMUNIKACJI MIEJSKIEJ|WODNO-KANALIZAC",
            re.I,
        ),
    ),
    Kind(
        "ngo",
        "stowarzyszenia, fundacje, kluby",
        pkd=("94.", "88."),
        name=re.compile(
            r"STOWARZYSZ|FUNDACJ|OCHOTNICZA STRA[ŻZ]|\bOSP\b|\bKLUB\b|ZWI[ĄA]ZEK"
            r"|KO[ŁL]O GOSPOD|PARAFIA|CARITAS|POLSKI CZERWONY KRZY[ŻZ]",
            re.I,
        ),
    ),
    Kind(
        "eventy",
        "events, culture, sport, catering, tourism",
        pkd=("82.3", "90.", "93.", "79.", "55.", "56.", "59.", "73.1"),
        name=re.compile(
            r"AGENCJA ARTYSTYCZNA|IMPREZ|KONCERT|FESTIWAL|\bTARGI\b|\bEVENT"
            r"|ROZRYWK|ARTYSTYCZN|CATERING|GASTRONOM|RESTAURACJ|HOTEL\b|NAG[ŁL]O[ŚS]NIEN"
            r"|SCENOTECHNI|WIDOWISK|ANIMACJ|ESTRAD",
            re.I,
        ),
    ),
    Kind(
        "budownictwo",
        "construction and civil engineering",
        pkd=("41.", "42.", "43."),
        name=re.compile(
            r"BUDOWNICTW|BUDOWLAN|\bBUD\b|DROGOW|INSTALAC|REMONT|DEKARS|BRUK", re.I
        ),
    ),
)


@dataclass
class Party:
    """One NIP as it appears across the register."""

    nip: str
    name: str | None = None
    rodzaj: str | None = None
    as_buyer: int = 0
    as_supplier: int = 0
    contracts: int = 0
    value: float = 0.0
    #: PKD codes, only ever set for a NIP we already hold.
    activity: list[str] = field(default_factory=list)
    krs: str | None = None


def only_digits(value) -> str:
    return re.sub(r"\D", "", str(value or ""))


def read_cru(path: Path) -> tuple[dict[str, Party], float, float]:
    """Every distinct NIP in the register, with what it did there.

    Also returns the register's total value and the part of it that could not
    be attributed to any identified company, so the money in the report adds
    up to the money in the register rather than to something larger.

    A contract's value is split evenly between its suppliers. Attributing the
    whole of it to each -- which is the obvious thing to write, and what this
    did first -- counts a jointly awarded contract once per winner: 1237
    contracts, 0.8% of the register, but 2.79 bn PLN of double counting, which
    put the reported total 23% above the register's own.
    """
    parties: dict[str, Party] = {}
    total = 0.0
    unattributed = 0.0
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            record = json.loads(line)
            value = record.get("wartosc_przedmiotu") or 0.0
            total += value
            # The buyer side is skipped entirely: it is the same money seen
            # from the paying end, and counting it would double the register.
            suppliers = [s for s in record["strony"] if s["kolejnosc"] != 0]
            share = value / len(suppliers) if suppliers else 0.0
            if not suppliers:
                unattributed += value

            for strona in record["strony"]:
                nip = only_digits(strona.get("nip"))
                if len(nip) != 10:
                    if strona["kolejnosc"] != 0:
                        # A supplier CRU names but does not identify -- most
                        # often a private individual. Its share is real money
                        # and simply cannot be filed under a company.
                        unattributed += share
                    continue
                party = parties.setdefault(nip, Party(nip=nip))
                if party.name is None:
                    party.name = strona.get("nazwa")
                    party.rodzaj = strona.get("rodzaj")
                party.contracts += 1
                if strona["kolejnosc"] == 0:
                    party.as_buyer += 1
                else:
                    party.as_supplier += 1
                    party.value += share
    return parties, total, unattributed


def read_companies(path: Path) -> dict[str, dict]:
    """The companies we already hold, keyed by NIP."""
    known: dict[str, dict] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            record = json.loads(line)
            nip = only_digits(record.get("nip"))
            if len(nip) == 10:
                known.setdefault(nip, record)
    return known


def in_krs(name: str | None) -> bool:
    """Whether the name states a legal form that KRS registers."""
    name = name or ""
    return bool(KRS_FORM.search(name)) and not CIVIL.search(name)


def classify_by_name(party: Party) -> str:
    """What kind of body this is, going only on the name.

    Kept separate from `classify` because this is the rule that actually
    decides the estimate: the counterparties we have to guess about are
    precisely the ones with no PKD. Measuring the combined rule against the
    companies we hold would measure the PKD path, which will never run on them.
    """
    name = party.name or ""
    # Sector first, and deliberately before the budget-unit check. CRU files a
    # municipal water company under rodzaj "JSFP" because it is public money,
    # but ZIELONOGÓRSKIE WODOCIĄGI I KANALIZACJA SPÓŁKA Z O.O. is a company
    # with a KRS entry like any other. Testing "JSFP" first called several
    # hundred of those budget units and dropped them from the estimate.
    for kind in KINDS:
        if kind.name is not None and kind.name.search(name):
            return kind.key
    if CIVIL.search(name):
        return "cywilna"
    if in_krs(name):
        return "prywatne"
    if party.rodzaj == "JSFP" or BUDGET.search(name):
        return "budzetowka"
    return "jdg"


def classify(party: Party) -> str:
    """What kind of body this is.

    PKD first where we have it, because it is what the entity itself declared.
    The name is the fallback, and for the ~97% of the register we do not hold
    it is the only signal there is.
    """
    for kind in KINDS:
        if kind.pkd and any(code.startswith(kind.pkd) for code in party.activity):
            return kind.key
    return classify_by_name(party)


LABELS = {kind.key: kind.label for kind in KINDS} | {
    "budzetowka": "public bodies and budget units",
    "prywatne": "other private companies (sp. z o.o., S.A. ...)",
    "cywilna": "spółka cywilna",
    "jdg": "sole traders (CEIDG)",
}


def _heading(title: str) -> None:
    print("=" * 68)
    print(title)
    print("=" * 68)


def _overlap_section(
    cru: dict[str, Party], known: dict[str, dict], overlap: set
) -> None:
    _heading("OVERLAP")
    print(f"  distinct NIPs in the register      {len(cru):>10,}")
    print(f"  companies we hold, with a NIP      {len(known):>10,}")
    print(f"  in both                            {len(overlap):>10,}")
    if known:
        print(f"    {len(overlap) / len(known):>6.1%} of the companies we already know")
    print(f"    {len(overlap) / len(cru):>6.2%} of the register's counterparties")
    suppliers = sum(1 for n in overlap if cru[n].as_supplier)
    print(f"  of those, act as supplier          {suppliers:>10,}")
    print(f"  of those, act as buyer             {len(overlap) - suppliers:>10,}")


def _kind_section(
    cru: dict[str, Party], overlap: set, total: float, unattributed: float
) -> None:
    _heading("WHAT THE COUNTERPARTIES ARE")
    counts: collections.Counter[str] = collections.Counter()
    held: collections.Counter[str] = collections.Counter()
    # Not a Counter: these are złoty, and a Counter is typed as counting.
    value: dict[str, float] = collections.defaultdict(float)
    for nip, party in cru.items():
        kind = classify(party)
        counts[kind] += 1
        value[kind] += party.value
        if nip in overlap:
            held[kind] += 1

    print("  bn PLN is the contract value the register declares, in billions of")
    print("  złoty, split evenly between a contract's suppliers.")
    print()
    print(f"  {'kind':<46}{'NIPs':>7}{'held':>7}{'bn PLN':>9}")
    for kind, n in counts.most_common():
        print(f"  {LABELS[kind]:<46}{n:>7,}{held[kind]:>7,}{value[kind] / 1e9:>9.2f}")
    attributed = sum(value.values())
    print(
        f"  {'TOTAL':<46}{sum(counts.values()):>7,}{sum(held.values()):>7,}"
        f"{attributed / 1e9:>9.2f}"
    )
    # Printed so the table reconciles against the register rather than being
    # taken on trust: these three lines have to add up.
    print(
        f"  {'not attributable to an identified company':<46}{'':>7}{'':>7}"
        f"{unattributed / 1e9:>9.2f}"
    )
    print(
        f"  {'value of every contract in the register':<46}{'':>7}{'':>7}"
        f"{total / 1e9:>9.2f}"
    )


def _lookup_section(cru: dict[str, Party], overlap: set, validate: bool) -> None:
    _heading("KRS LOOKUPS STILL NEEDED")
    todo = [p for n, p in cru.items() if n not in overlap]
    # `in_krs` and nothing else, here and in the validation below. Whether an
    # entity is registered is a different question from what sector it works
    # in, and answering them with one predicate makes the correction below
    # measure the wrong thing.
    needed = sum(1 for p in todo if in_krs(p.name))
    print(f"  counterparties we do not hold      {len(todo):>10,}")
    print(f"  of which registered in KRS         {needed:>10,}")

    if not validate:
        return
    if not overlap:
        print("\n  nothing in both sources, cannot validate")
        return

    # The one population whose answer is known: everything in `overlap` has a
    # KRS, because we hold one for it. So whatever the name rule says about
    # them is its recall, measured rather than assumed.
    hit = sum(1 for n in overlap if in_krs(cru[n].name))
    recall = hit / len(overlap)
    print()
    print(f"  recall of that rule, on the {len(overlap):,} we know have a KRS:")
    print(f"    {hit:,}/{len(overlap):,} = {recall:.1%}")
    print(f"  correcting for it: ~{round(needed / recall):,} lookups")

    missed = sorted(
        filter(None, (cru[n].name for n in overlap if not in_krs(cru[n].name)))
    )
    if missed:
        print(f"\n  {len(missed):,} it misses (these do have a KRS):")
        for name in missed[:8]:
            print(f"    {name[:64]}")


def list_kind(cru: dict[str, Party], overlap: set, kind: str) -> None:
    """The counterparties of one kind we do not hold, as CSV on stdout.

    `in_krs` is a column and not a filter. Most of what is missing from a
    sector is budget units -- of the 337 municipal utilities we do not hold,
    227 only ever appear as a buyer and have no legal form in their name,
    because they are gminne zakłady budżetowe rather than companies. There is
    nothing to look them up in. Reporting that is more use than hiding it.
    """
    missing = [
        p for nip, p in cru.items() if nip not in overlap and classify(p) == kind
    ]
    missing.sort(key=lambda p: (-p.value, -p.contracts, p.nip))

    print("nip,contracts,as_supplier,as_buyer,value_pln,in_krs,name")
    for party in missing:
        name = (party.name or "").replace('"', "'")
        print(
            f"{party.nip},{party.contracts},{party.as_supplier},{party.as_buyer},"
            f'{party.value:.2f},{int(in_krs(party.name))},"{name}"'
        )


def report(
    cru: dict[str, Party],
    known: dict[str, dict],
    validate: bool,
    total: float = 0.0,
    unattributed: float = 0.0,
) -> None:
    overlap = set(cru) & set(known)
    for nip in overlap:
        cru[nip].activity = known[nip].get("activity") or []
        cru[nip].krs = known[nip].get("krs")

    _overlap_section(cru, known, overlap)
    print()
    _kind_section(cru, overlap, total, unattributed)
    print()
    _lookup_section(cru, overlap, validate)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--umowy",
        type=Path,
        default=Path(VERSIONED_DIR) / "cru_umowy" / "cru_umowy.jsonl",
        help="CruUmowy output to read.",
    )
    parser.add_argument(
        "--companies",
        type=Path,
        default=Path(VERSIONED_DIR) / "companies_merged" / "companies_merged.jsonl",
        help="Companies output to compare against.",
    )
    parser.add_argument(
        "--list",
        dest="list_kind",
        choices=sorted(LABELS),
        help="Instead of the report, print the counterparties of this kind "
        "that we do not hold, as CSV.",
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Measure the name classifier against the companies whose KRS we "
        "already hold, and correct the estimate by the recall it scores.",
    )
    args = parser.parse_args()

    for path in (args.umowy, args.companies):
        if not path.exists():
            raise SystemExit(
                f"{path} is missing. Run the pipeline that writes it first "
                f"(koryta CruUmowy / koryta Companies)."
            )

    cru, total, unattributed = read_cru(args.umowy)
    known = read_companies(args.companies)
    if args.list_kind:
        overlap = set(cru) & set(known)
        for nip in overlap:
            cru[nip].activity = known[nip].get("activity") or []
        list_kind(cru, overlap, args.list_kind)
        return
    report(cru, known, args.validate, total, unattributed)


if __name__ == "__main__":
    main()
