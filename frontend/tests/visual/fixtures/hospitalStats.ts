import type {
  HospitalStats,
  PartySeats,
  SupervisoryGroup,
} from "../../../server/utils/hospitalStats";

/** A stand-in for `/api/stats/hospitals`, for the visual capture of
 * /eksploruj/szpitale.
 *
 * WHY A FIXTURE AND NOT THE SEED. The page is one chart, and the chart is the
 * only thing on it whose layout is worth a picture: a five-column grid that at
 * a phone's width has to shed two of them. The seeded world contains no
 * hospital at all - `scripts/nodes.json` has no place carrying the `szpitale`
 * category - so a capture against it draws the empty state and guards the
 * copy around a chart that is not there. Seeding hospitals instead would move
 * the node counts every other baseline in this suite is drawn from, which is a
 * great deal of collateral for one page.
 *
 * WHAT IT IS SHAPED FOR. Long hospital names, because the name column is where
 * the phone width is fought over; six parties, so the head of a bar has enough
 * segments for the minimum-width correction to fire; and a backlog on every
 * region and hospital row, so the grey tail and the "do sprawdzenia" column
 * both have something to draw. The party split deliberately has none - that is
 * the rule the chart exists to state.
 */

const PARTIES = ["PiS", "PO", "PSL", "Polska 2050", "Nowa Lewica", "__NONE__"];

const REGIONS: [string, string][] = [
  ["14", "Województwo mazowieckie"],
  ["24", "Województwo śląskie"],
  ["30", "Województwo wielkopolskie"],
  ["12", "Województwo małopolskie"],
  ["02", "Województwo dolnośląskie"],
  ["10", "Województwo łódzkie"],
  ["22", "Województwo pomorskie"],
  ["06", "Województwo lubelskie"],
];

const HOSPITALS: [string, string][] = [
  ["h-gorzow", "WIELOSPECJALISTYCZNY SZPITAL WOJEWÓDZKI W GORZOWIE WLKP."],
  [
    "h-czestochowa",
    "Wojewódzki Szpital Specjalistyczny im. Najświętszej Maryi Panny w Częstochowie",
  ],
  [
    "h-krasnystaw",
    "Samodzielny Publiczny Zakład Opieki Zdrowotnej w Krasnymstawie",
  ],
  ["h-zawiercie", "Szpital Powiatowy w Zawierciu"],
  [
    "h-kutno",
    "Kutnowski Szpital Samorządowy Spółka z ograniczoną odpowiedzialnością",
  ],
  ["h-miechow", "Szpital Św. Anny w Miechowie"],
];

/** Seats by party for one row, thinning down the list so the smallest segments
 * are the ones the 5px floor has to widen. */
function byParty(scale: number): PartySeats[] {
  return PARTIES.slice(0, 5).map((party, i) => ({
    party,
    seats: Math.max(1, Math.round((26 - i * 5) * scale)),
    people: Math.max(1, Math.round((24 - i * 5) * scale)),
    hospitals: Math.max(1, 7 - i),
  }));
}

const sum = (rows: PartySeats[]) =>
  rows.reduce((total, r) => total + r.seats, 0);

function paidGroup(): SupervisoryGroup {
  const rows = HOSPITALS.map(([id, name], i) => {
    const parties = byParty(1 / (i + 1));
    return {
      id,
      name,
      supervisoryOrgan: "rada_nadzorcza" as const,
      legalForm: "Spółka z ograniczoną odpowiedzialnością",
      seats: sum(parties),
      unreviewed: 38 + i * 11,
      parties: parties.map((p) => p.party),
      byParty: parties,
    };
  });
  const byRegion = REGIONS.map(([teryt, name], i) => {
    const parties = byParty(1 / (i + 1));
    return {
      teryt,
      name,
      hospitals: 34 - i * 3,
      groupHospitals: 26 - i * 3,
      hospitalsWithSeats: 18 - i * 2,
      seats: sum(parties),
      unreviewed: 44 + i * 13,
      seatsWithParty: Math.round(sum(parties) * 0.72),
      byParty: parties,
    };
  });
  return {
    kinds: ["rada_nadzorcza"],
    hospitals: 271,
    hospitalsWithSeats: 143,
    seats: 591,
    endedSeats: 37,
    seatsWithParty: 366,
    unreviewed: 558,
    byParty: byParty(4),
    rows,
    byRegion,
  };
}

function unpaidGroup(): SupervisoryGroup {
  return {
    kinds: ["rada_spoleczna"],
    hospitals: 90,
    hospitalsWithSeats: 21,
    seats: 118,
    endedSeats: 4,
    seatsWithParty: 61,
    unreviewed: 143,
    byParty: byParty(1.5),
    rows: HOSPITALS.slice(0, 3).map(([id, name], i) => {
      const parties = byParty(0.4 / (i + 1));
      return {
        id: `${id}-spzoz`,
        name,
        supervisoryOrgan: "rada_spoleczna" as const,
        legalForm: "Samodzielny publiczny zakład opieki zdrowotnej",
        seats: sum(parties),
        unreviewed: 12 + i * 5,
        parties: parties.map((p) => p.party),
        byParty: parties,
      };
    }),
    byRegion: REGIONS.slice(0, 4).map(([teryt, name], i) => {
      const parties = byParty(0.4 / (i + 1));
      return {
        teryt,
        name,
        hospitals: 12 - i,
        groupHospitals: 9 - i,
        hospitalsWithSeats: 5 - i,
        seats: sum(parties),
        unreviewed: 15 + i * 6,
        seatsWithParty: Math.round(sum(parties) * 0.7),
        byParty: parties,
      };
    }),
  };
}

/** The hospitals with no organ in the register. Counted on the page, never
 * broken down, so the rows are empty on purpose. */
function otherGroup(): SupervisoryGroup {
  return {
    kinds: ["komisja_rewizyjna", "inny", "nieznany", "brak"],
    hospitals: 341,
    hospitalsWithSeats: 0,
    seats: 0,
    endedSeats: 0,
    seatsWithParty: 0,
    unreviewed: 0,
    byParty: [],
    rows: [],
    byRegion: [],
  };
}

/** `generatedAt` is stamped at call time, not baked in: the page prints it
 * through `formatDaysAgo`, so a fixed date would read "dzisiaj" on the day the
 * baseline was taken and "3 dni temu" by the end of the week. */
export function hospitalStatsFixture(): HospitalStats {
  return {
    generatedAt: new Date().toISOString(),
    hospitals: 612,
    paid: paidGroup(),
    unpaid: unpaidGroup(),
    other: otherGroup(),
  };
}
