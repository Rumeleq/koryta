"""Which sector a company belongs to, for the category filter on koryta.pl.

The site offers a "Kategoria" filter on /eksploruj that narrows the table to
one sector - hospitals, water utilities, railways. The category is stored on
the place node as `categories` and shipped there by the company ingest
payload, so this module is the one place that decides what a company is.

It used to live in the frontend (`frontend/shared/companyCategories.ts`) and
derive the answer from PKD codes alone, which is not enough for two reasons
that only show up once you look at real companies:

  - **A PKD code is a claim about activity, not about a sector.** 42.12
    (roboty zwiazane z budowa drog szynowych) is the only code that reaches
    PKP PLK, whose declared main activity is the far broader 52.21, but it is
    also carried as a secondary code by road builders, a quarry and a water
    utility. Meanwhile a company can list a rail code because it owns a
    siding: Orlen Aviation and Enea Bioenergia both declare 49.20.
  - **KRS carries two vintages of PKD at once.** The 2025 revision split
    passenger rail out of 49.10 into 49.11 (miedzymiastowy) and 49.12 (miejski
    i podmiejski, taken out of 49.31), so an operator's code depends on when it
    last filed. PKP Szybka Kolej Miejska w Trojmiescie declares only 49.12.

So the mapping is prefix matching *plus* an explicit override list, and both
halves carry their reasoning. The overrides are by KRS number rather than by
name because a name is not unique - 96 company names in the register are
shared by more than one entity.

A category set computed here is a *default*. Once a person edits the
categories of a company on the site, the node records
`categoriesSource: "manual"` and the ingest stops writing over it, the same
contract `isPublic`/`isPublicSource` already has. See
`frontend/server/api/ingest/company.post.ts`.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Override:
    """One company the prefix rules get wrong, and why.

    The reason is not decoration: an override is a standing claim about a
    single company that nobody can re-derive from the data, so the next person
    to look at the list needs to know what it was for.
    """

    krs: str
    name: str
    reason: str

    def __post_init__(self):
        object.__setattr__(self, "krs", str(self.krs).zfill(10))


@dataclass(frozen=True)
class Category:
    """A sector, and the three ways a company lands in it.

    `pkd_prefixes` matches against *any* of a company's PKD codes, not just the
    main one. KRS lets an entity declare ten, and the one that names the sector
    is regularly not the first: PKP Cargo Connect's main activity is road
    freight and it hauls by rail as a secondary.
    """

    value: str
    title: str
    pkd_prefixes: tuple[str, ...] = ()
    include: tuple[Override, ...] = ()
    exclude: tuple[Override, ...] = ()

    @property
    def included_krs(self) -> frozenset[str]:
        return frozenset(o.krs for o in self.include)

    @property
    def excluded_krs(self) -> frozenset[str]:
        return frozenset(o.krs for o in self.exclude)


SZPITALE = Category(
    value="szpitale",
    title="Szpitale",
    # 86.10 Dzialalnosc szpitali
    pkd_prefixes=("86.10",),
)

WODOCIAGI = Category(
    value="wodociagi",
    title="Wodociagi i kanalizacja",
    # 36.00 Pobor, uzdatnianie i dostarczanie wody
    # 37.00 Odprowadzanie i oczyszczanie sciekow
    pkd_prefixes=("36.00", "37.00"),
)

KOLEJE = Category(
    value="koleje",
    title="Koleje",
    # Operators, both PKD vintages:
    #   49.10 Transport kolejowy pasazerski miedzymiastowy       (PKD 2007)
    #   49.11 Transport kolejowy pasazerski miedzymiastowy       (PKD 2025)
    #   49.12 Transport kolejowy pasazerski miejski i podmiejski (PKD 2025)
    #   49.20 Transport kolejowy towarow                         (both)
    # Infrastructure and rolling stock:
    #   42.12 Roboty zwiazane z budowa drog szynowych i kolei podziemnej
    #   30.20 Produkcja lokomotyw kolejowych oraz taboru szynowego
    #
    # 49.31 (transport miejski i podmiejski) is left out: in the 2007 vintage
    # it is trams, metro and buses together, and the rail half of it became
    # 49.12 in 2025, which is listed above. 52.21 (uslugi wspomagajace
    # transport ladowy) is left out for the same reason - it also covers roads,
    # parking and bus terminals - and its 2025 A/B split is not a rail/road
    # one: 52.21.B holds a swimming pool, a hospital and an airport alongside
    # PKP PLK. 33.17 (naprawa pozostalego sprzetu transportowego) is where
    # rolling-stock repair sits, but it also holds water utilities and an
    # orthopaedic workshop, so the repair shops are named individually below.
    pkd_prefixes=("49.10", "49.11", "49.12", "49.20", "42.12", "30.20"),
    include=(
        Override(
            "0000019193",
            "Polskie Koleje Panstwowe",
            "the group holding company: PKD says 70.10, firmy centralne",
        ),
        Override("0000042646", "PKP Informatyka", "PKP group IT, PKD 62.01"),
        Override(
            "0000504917",
            "PKP Telkol",
            "PKP group telecoms and rail signalling, PKD 95.10",
        ),
        Override(
            "0000327801",
            "PKP Cargotabor",
            "wagon maintenance for PKP Cargo, PKD 33.17 - too broad to match on",
        ),
        Override(
            "0000091303",
            "PKP Intercity Remtrak",
            "rolling-stock repair for PKP Intercity, PKD 33.17",
        ),
        Override(
            "0000377050",
            "PKP Cargo Terminale",
            "PKP Cargo's intermodal terminals, PKD 52.24",
        ),
        Override(
            "0000014327",
            "PKP Energetyka",
            "no PKD stored at all; traction power for the network",
        ),
        Override(
            "0000849277",
            "PKP Linia Chelmska Szerokotorowa",
            "no PKD stored; a broad-gauge line operator",
        ),
        Override(
            "0000249835",
            "PKP Cargo Wagon-Tarnowskie Gory",
            "no PKD stored; wagon repair",
        ),
        Override(
            "0000496856", "PKP Budownictwo", "no PKD stored; PKP group construction"
        ),
        Override(
            "0000569557",
            "PMT Linie Kolejowe 2",
            "no PKD stored; sibling of PMT Linie Kolejowe, which matches on 49.10",
        ),
        Override(
            "0000031521",
            "Polregio (poprzedni wpis)",
            "no PKD stored; the earlier registration of the regional operator",
        ),
        Override(
            "0000034257", "Cargosped", "no PKD stored; PKP Cargo's forwarding arm"
        ),
        Override(
            "0000953069",
            "PHN Kolejowa",
            "PKD 68.12; holds the PKP group's railway property",
        ),
        Override(
            "0000157565",
            "Kolejowe Zaklady Lacznosci",
            "PKD 27.90; builds rail signalling and communications equipment",
        ),
        Override(
            "0000541901",
            "PGE Energetyka Kolejowa Holding",
            "PKD 64.21; the traction-power group's holding company",
        ),
        Override(
            "0000610778",
            "PGE Energetyka Kolejowa Operator",
            "PKD 35.14; distributes traction power",
        ),
        Override(
            "0000610805",
            "PGE Energetyka Kolejowa Centrum Uslug Wspolnych",
            "PKD 69.20; shared services for the traction-power group",
        ),
        Override(
            "0000152612",
            "Swietokrzyska Kolejka Dojazdowa Ciuchcia Expres Ponidzia",
            "no PKD stored; a narrow-gauge heritage railway",
        ),
        Override(
            "0000628522",
            "Zwiazek Samorzadowych Przewoznikow Kolejowych",
            "no PKD stored; the regional operators' association",
        ),
    ),
    exclude=(
        # "Kolejowy" in the name, and nothing to do with running a railway.
        Override("0000312594", "Polskie Koleje Linowe", "cable cars, not rail"),
        Override(
            "0000079964",
            "Polskie Koleje Linowe",
            "cable cars, not rail - a second registration",
        ),
        Override(
            "0000527636",
            "Polskie Koleje Linowe Food",
            "catering at the cable-car stations",
        ),
        # Railway-branded hospitals. They match 86.10 and belong in `szpitale`;
        # the exclusion only stops a future name rule from claiming them.
        Override(
            "0000074422", "Kolejowy Szpital Uzdrowiskowy", "a hospital, PKD 86.10"
        ),
        Override("0000102533", "Okregowy Szpital Kolejowy w Katowicach", "a hospital"),
        Override(
            "0000011133",
            "Obwod Lecznictwa Kolejowego w Gliwicach",
            "an outpatient clinic",
        ),
        # Road, water, mining and aviation companies that carry 42.12 or a
        # freight-rail code because of a siding or a contract, not because
        # railways are what they do.
        Override(
            "0000158240",
            "Instytut Badawczy Drog i Mostow",
            "a roads research institute; 42.12 is one of ten codes",
        ),
        Override(
            "0000027591", "Drogowa Trasa Srednicowa", "builds a motorway; PKD 71.12"
        ),
        Override(
            "0000503225",
            "Poznanskie Inwestycje Miejskie",
            "the city's general investment vehicle, PKD 41.20",
        ),
        Override(
            "0000035770",
            "Przedsiebiorstwo Budownictwa Przemyslowego Chemobudowa",
            "industrial construction, PKD 41.20",
        ),
        Override(
            "0000502907",
            "Zaklad Przerobki Piaskowca Zbylutow",
            "a sandstone quarry, PKD 09.90",
        ),
        Override(
            "0000209019",
            "Wikom - Wodociagi i Oczyszczanie Miasta",
            "a water utility, PKD 36.00 - it belongs in wodociagi",
        ),
        Override(
            "0000128844",
            "Przedsiebiorstwo Uslug Portowych Rezerwa",
            "port services, PKD 81.22",
        ),
        Override(
            "0000384573",
            "Lokalna Agencja Rozwoju Gospodarczego Gminy Suchy Las",
            "a gmina development agency, PKD 70.20",
        ),
        Override(
            "0000794409",
            "Przedsiebiorstwo Gospodarki Mieszkaniowej Inwestycje",
            "municipal housing, PKD 41.10",
        ),
        Override("0000070755", "Poldim-Mosty", "bridge building, PKD 08.11"),
        Override("0000115191", "Huta Pokoj Konstrukcje", "steel structures, PKD 25.11"),
        Override(
            "0000110826",
            "Przedsiebiorstwo Budowy Kopaln Pebeka",
            "mine construction, PKD 43.99",
        ),
        Override(
            "0000171488",
            "Przedsiebiorstwo Drogowo-Mostowe",
            "roads and bridges, PKD 42.11",
        ),
        Override("0000117194", "Przedsiebiorstwo Robot Drogowych", "roads, PKD 42.11"),
        Override(
            "0000073875",
            "Kopalnia Wapienia Czatkowice",
            "a limestone quarry with a siding, PKD 08.11",
        ),
        Override(
            "0000060011",
            "Kopalnia Surowcow Skalnych - Kleczany",
            "a quarry with a siding, PKD 08.11",
        ),
        Override(
            "0000185170",
            "Grupa Azoty Kopalnie i Zaklady Chemiczne Siarki Siarkopol",
            "sulphur mining with a siding, PKD 08.91",
        ),
        Override(
            "0000376459",
            "Enea Bioenergia",
            "biomass, PKD 16.11; the rail code is a siding",
        ),
        Override(
            "0000085139",
            "Dolnoslaskie Zaklady Uslugowo-Produkcyjne Dozamel",
            "an industrial park landlord, PKD 68.20",
        ),
        Override("0000022177", "Orlen Aviation", "aviation fuel, PKD 52.23"),
        Override(
            "0000059625", "Centrala Zbytu Wegla Weglozbyt", "coal trading, PKD 46.81"
        ),
    ),
)

COMPANY_CATEGORIES: tuple[Category, ...] = (SZPITALE, WODOCIAGI, KOLEJE)

CATEGORY_VALUES: tuple[str, ...] = tuple(c.value for c in COMPANY_CATEGORIES)


def matches_pkd(activity: list[str] | None, prefixes: tuple[str, ...]) -> bool:
    """Whether any declared code starts with any of `prefixes`.

    Prefix matching is directional and that is deliberate: "49.20.Z".startswith
    ("49.20") holds, "49.2.".startswith("49.20") does not. A handful of stored
    codes are truncated to the division ("49..", "42.1."), and those are too
    coarse to place a company - division 49 is every kind of land transport,
    most of it buses - so not matching them is the right answer rather than a
    gap.
    """
    if not activity:
        return False
    return any(code.startswith(prefix) for code in activity for prefix in prefixes)


def categories_for(krs: str | None, activity: list[str] | None) -> list[str]:
    """Every category a company belongs to, in `COMPANY_CATEGORIES` order.

    An exclusion beats everything, including an inclusion: the two lists are
    written by hand and an entry appearing on both is a mistake, so the safer
    of the two answers wins rather than the order of the checks deciding it.

    Returns a list rather than a set so the value is stable from one run to the
    next - it ends up in a Firestore document that a diff is taken against.
    """
    normalized = str(krs).zfill(10) if krs is not None else None
    result = []
    for category in COMPANY_CATEGORIES:
        if normalized is not None and normalized in category.excluded_krs:
            continue
        if normalized is not None and normalized in category.included_krs:
            result.append(category.value)
            continue
        if matches_pkd(activity, category.pkd_prefixes):
            result.append(category.value)
    return result
