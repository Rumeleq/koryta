/** Who sits on the supervisory boards of publicly owned hospitals, by party.
 *
 * The pure half of /api/stats/hospitals: everything here takes rows and returns
 * rows, so the rules can be tested without a Firestore. The handler does the
 * reading.
 *
 * THE DISTINCTION THIS EXISTS FOR. A hospital run as a spółka has a rada
 * nadzorcza, whose members may be paid - KSH art. 222(1) § 1 says a
 * wynagrodzenie "może zostać przyznane", the uchwała wspólników sets it, and
 * the ustawa z 9 czerwca 2016 r. caps it. A hospital run as a samodzielny
 * publiczny zakład opieki zdrowotnej has a rada społeczna instead, and the
 * ustawa o działalności leczniczej gives its members neither wynagrodzenie nor
 * dieta - art. 48 ust. 9-10 allow only a reimbursement of wages a member
 * actually lost by attending, and only when their employer gave them unpaid
 * leave for it. Counting the two together would report a few thousand unpaid
 * seats as paid ones.
 *
 * The register is the only thing that can tell them apart, and rejestr.io -
 * where the edges come from - cannot: it labels every supervisory connection
 * KRS_SUPERVISION, which the scrapers map to the literal role "Rada Nadzorcza",
 * rada społeczna members included. So the edge says *that* somebody supervises
 * and the company's `supervisoryOrgan` says *what they sit on*. Both are needed.
 *
 * `supervisoryOrgan`, not `supervisoryBody`. The two are different readings of
 * the register and only this one is fine enough for a page that reports boards:
 * `supervisoryBody` comes from the legal form and answers a yes/no about pay,
 * which is what the employment counters need, while this comes from
 * `dzial2.organNadzoru` and can name a komisja rewizyjna or say the entry filed
 * nothing. See `shared/companyOrgans.ts`.
 *
 * WHY THE RULE IS AN ALLOWLIST. Most SPZOZ file no organ with KRS at all - the
 * rada społeczna is created by statute, not by the entry - so "everything
 * except a rada społeczna" would quietly readmit hundreds of unpaid boards.
 * Only `supervisoryOrgan === "rada_nadzorcza"` counts as paid; everything else,
 * absent included, is reported separately and left out of the breakdown.
 *
 * Seats, not money. Nothing in the database holds a remuneration: the 2016 act
 * sets a ceiling and the actual figure lives in each spółka's uchwała. What can
 * be counted is who holds a seat that is paid at all.
 */

import { asArray, pageIsPublic } from "~~/shared/model";
import {
  supervisoryOrgans,
  type SupervisoryOrgan,
} from "~~/shared/companyOrgans";

/** A place node, as much of it as this endpoint reads. */
export type HospitalPlaceRow = {
  id: string;
  name?: string;
  categories?: string[] | Record<string, string>;
  legalForm?: string;
  supervisoryOrgan?: string;
  isPublic?: boolean;
  published?: unknown;
  deleted?: unknown;
};

/** An `employed` edge: `source` is the person, `target` the institution, and
 * `name` the role, which is where the person ingest puts it. */
export type BoardEdgeRow = {
  source?: string;
  target?: string;
  name?: string;
  end_date?: string;
  published?: unknown;
  deleted?: unknown;
};

/** A person node, as much of it as this endpoint reads. */
export type BoardPersonRow = {
  id: string;
  name?: string;
  parties?: string[] | Record<string, string>;
  published?: unknown;
  deleted?: unknown;
};

/** The sentinel the rest of the site already uses for "no party", so a link
 * built out of this response lands on the filter the table understands - see
 * `applyPartiesFilter` in server/utils/fetch.ts. */
export const NO_PARTY = "__NONE__";

export type PartySeats = {
  /** A party as it is stored on the person node, or `NO_PARTY`. */
  party: string;
  /** Seats held by somebody carrying this party. A person with two parties is
   * counted under both, so these sum to more than the group's `seats`;
   * `seatsWithParty` is the honest denominator for a share. */
  seats: number;
  people: number;
  hospitals: number;
};

export type HospitalRow = {
  id: string;
  name: string;
  /** Null when the scrapers have not looked at this company since the field was
   * added, as opposed to `"brak"`, which means KRS names no organ. */
  supervisoryOrgan: SupervisoryOrgan | null;
  legalForm: string | null;
  seats: number;
  /** Parties seated on this board, most seats first. */
  parties: string[];
};

export type SupervisoryGroup = {
  /** The organ kinds counted here, so the page can name what it shows without
   * hardcoding the split a second time. */
  kinds: SupervisoryOrgan[];
  hospitals: number;
  /** Hospitals in this group with at least one seat on record. The rest are the
   * denominator that stops a party looking clean when it is only unobserved. */
  hospitalsWithSeats: number;
  /** Seats currently held. One person on one board is one seat, however many
   * spells the database records for them. */
  seats: number;
  /** Seats the database says somebody has left. Reported rather than counted:
   * an odpis aktualny only ever names the sitting board. */
  endedSeats: number;
  /** Of `seats`, those held by somebody with a party on their node. */
  seatsWithParty: number;
  byParty: PartySeats[];
  rows: HospitalRow[];
};

export type HospitalStats = {
  /** When the numbers were computed, so a cached page can say how fresh it is. */
  generatedAt: string;
  /** Every publicly owned hospital in the database, whatever supervises it. */
  hospitals: number;
  /** Boards whose seats are, as a rule, paid. This is the breakdown the page is
   * about. */
  paid: SupervisoryGroup;
  /** Boards whose seats are not paid. Counted and returned so that the
   * exclusion can be shown rather than silently applied. */
  unpaid: SupervisoryGroup;
  /** Everything else: a hospital KRS records no supervisory organ for, one the
   * scrapers have not read since the field was added, and the few whose organ
   * is neither. Out of both breakdowns because there is no evidence either
   * way. */
  other: SupervisoryGroup;
};

const PAID_KINDS: SupervisoryOrgan[] = ["rada_nadzorcza"];
const UNPAID_KINDS: SupervisoryOrgan[] = ["rada_spoleczna"];
const OTHER_KINDS: SupervisoryOrgan[] = supervisoryOrgans.filter(
  (kind) => !PAID_KINDS.includes(kind) && !UNPAID_KINDS.includes(kind),
);

/** Whether a place is a hospital this page counts.
 *
 * `isPublic === true` rather than `publicSectorKnown`: only `true` asserts
 * public ownership, and this page is a claim about public money. It costs
 * coverage - KRS does not publish the shareholders of a spółka akcyjna unless
 * there is exactly one, so some genuinely samorządowe hospitals read as unknown
 * and are missing here. That is the right way round for a page that names
 * people.
 */
export function isPublicHospital(place: HospitalPlaceRow): boolean {
  if (!pageIsPublic(place)) return false;
  if (place.isPublic !== true) return false;
  return asArray<string>(place.categories).includes("szpitale");
}

/** Whether an employment role is a seat on a supervisory board.
 *
 * The roles the KRS pipeline writes are "Zarząd", "Rada Nadzorcza", "Prokurent"
 * and "Pełnomocnik"; a human filling in the relation form can type anything.
 * Matched on the front of the string, with case and spacing folded, so that
 * "Rada Nadzorcza (przewodniczący)" and a stray double space both count.
 *
 * "Rada Społeczna" is accepted against the day the scrapers start labelling
 * those correctly. Today they do not, which is precisely why the paid/unpaid
 * split is decided by the company's `supervisoryOrgan` and not here.
 */
export function isSupervisoryRole(role: string | undefined): boolean {
  if (!role) return false;
  const folded = role.toUpperCase().replace(/\s+/g, " ").trim();
  return (
    folded.startsWith("RADA NADZORCZA") ||
    folded.startsWith("RADA SPOŁECZNA") ||
    folded.startsWith("RADA SPOLECZNA")
  );
}

function supervisoryOrganOf(place: HospitalPlaceRow): SupervisoryOrgan | null {
  const value = place.supervisoryOrgan as SupervisoryOrgan | undefined;
  return value && supervisoryOrgans.includes(value) ? value : null;
}

type Seat = { placeId: string; personId: string };

/** The board seats an edge set describes, deduplicated.
 *
 * One person on one board is one seat: the database can hold two `employed`
 * edges for the same person and hospital - a spell recorded twice, or a
 * re-appointment after a break - and counting both would inflate a board past
 * its own size. An ended spell is returned separately rather than counted: an
 * odpis aktualny only names the sitting board, so somebody with an end date has
 * left. If they also hold an open spell, the open one wins.
 */
export function boardSeats(
  edges: BoardEdgeRow[],
  today: string,
): { current: Seat[]; ended: Seat[] } {
  const current = new Map<string, Seat>();
  const ended = new Map<string, Seat>();

  for (const edge of edges) {
    if (!edge.source || !edge.target) continue;
    if (!pageIsPublic(edge)) continue;
    if (!isSupervisoryRole(edge.name)) continue;

    const key = `${edge.target}|${edge.source}`;
    const seat = { placeId: edge.target, personId: edge.source };
    if (edge.end_date && edge.end_date < today) ended.set(key, seat);
    else current.set(key, seat);
  }

  for (const key of current.keys()) ended.delete(key);

  return { current: [...current.values()], ended: [...ended.values()] };
}

function emptyGroup(kinds: SupervisoryOrgan[]): SupervisoryGroup {
  return {
    kinds,
    hospitals: 0,
    hospitalsWithSeats: 0,
    seats: 0,
    endedSeats: 0,
    seatsWithParty: 0,
    byParty: [],
    rows: [],
  };
}

/** A party tally while it is being built. Sets rather than counters because a
 * person can hold three seats and the same party can reach one hospital through
 * several of them. */
type Tally = { seats: number; people: Set<string>; hospitals: Set<string> };

/** The whole response, from the three collections it takes to build it.
 *
 * `today` is passed in rather than read off the clock, so that a test can say
 * which spells are over.
 */
export function buildHospitalStats(input: {
  places: HospitalPlaceRow[];
  edges: BoardEdgeRow[];
  people: BoardPersonRow[];
  generatedAt: string;
  today: string;
}): HospitalStats {
  const hospitals = input.places.filter(isPublicHospital);
  const byId = new Map(hospitals.map((place) => [place.id, place]));

  // Only people who have a page of their own are attributed. An unpublished
  // person node is a draft nobody has checked; the seat still counts, it just
  // lands under "no party" rather than under a party read off a draft.
  const parties = new Map<string, string[]>();
  for (const person of input.people) {
    if (!pageIsPublic(person)) continue;
    parties.set(
      person.id,
      asArray<string>(person.parties).filter((party) => !!party),
    );
  }

  const groups = {
    paid: emptyGroup(PAID_KINDS),
    unpaid: emptyGroup(UNPAID_KINDS),
    other: emptyGroup(OTHER_KINDS),
  };
  const groupOf = (placeId: string): SupervisoryGroup | undefined => {
    const place = byId.get(placeId);
    if (!place) return undefined;
    const kind = supervisoryOrganOf(place);
    if (kind && PAID_KINDS.includes(kind)) return groups.paid;
    if (kind && UNPAID_KINDS.includes(kind)) return groups.unpaid;
    return groups.other;
  };

  const tallies = new Map<SupervisoryGroup, Map<string, Tally>>([
    [groups.paid, new Map()],
    [groups.unpaid, new Map()],
    [groups.other, new Map()],
  ]);
  const rows = new Map<string, HospitalRow>();
  const rowParties = new Map<string, Map<string, number>>();

  for (const place of hospitals) {
    groupOf(place.id)!.hospitals++;
    rows.set(place.id, {
      id: place.id,
      name: place.name ?? place.id,
      supervisoryOrgan: supervisoryOrganOf(place),
      legalForm: place.legalForm ?? null,
      seats: 0,
      parties: [],
    });
    rowParties.set(place.id, new Map());
  }

  const { current, ended } = boardSeats(
    input.edges.filter((edge) => !!edge.target && byId.has(edge.target)),
    input.today,
  );

  for (const seat of current) {
    const group = groupOf(seat.placeId)!;
    const row = rows.get(seat.placeId)!;
    const tally = tallies.get(group)!;

    group.seats++;
    row.seats++;

    // A person with no party still holds the seat, so it is counted under the
    // sentinel rather than dropped: a breakdown showing only the seats it could
    // attribute would overstate every party's share of the board.
    const held = parties.get(seat.personId) ?? [];
    if (held.length > 0) group.seatsWithParty++;
    for (const party of held.length > 0 ? held : [NO_PARTY]) {
      const entry = tally.get(party) ?? {
        seats: 0,
        people: new Set<string>(),
        hospitals: new Set<string>(),
      };
      entry.seats++;
      entry.people.add(seat.personId);
      entry.hospitals.add(seat.placeId);
      tally.set(party, entry);

      const perRow = rowParties.get(seat.placeId)!;
      perRow.set(party, (perRow.get(party) ?? 0) + 1);
    }
  }

  for (const seat of ended) groupOf(seat.placeId)!.endedSeats++;

  for (const [group, tally] of tallies) {
    group.byParty = [...tally.entries()]
      .map(([party, entry]) => ({
        party,
        seats: entry.seats,
        people: entry.people.size,
        hospitals: entry.hospitals.size,
      }))
      // The sentinel sorts last whatever its size, so that a chart drawn
      // straight off this list opens with parties rather than with the bucket
      // for everyone we could not place.
      .sort(
        (a, b) =>
          Number(a.party === NO_PARTY) - Number(b.party === NO_PARTY) ||
          b.seats - a.seats ||
          a.party.localeCompare(b.party),
      );
  }

  for (const place of hospitals) {
    const group = groupOf(place.id)!;
    const row = rows.get(place.id)!;
    if (row.seats > 0) group.hospitalsWithSeats++;
    row.parties = [...rowParties.get(place.id)!.entries()]
      .sort(
        (a, b) =>
          Number(a[0] === NO_PARTY) - Number(b[0] === NO_PARTY) ||
          b[1] - a[1] ||
          a[0].localeCompare(b[0]),
      )
      .map(([party]) => party);
    group.rows.push(row);
  }

  for (const group of Object.values(groups)) {
    group.rows.sort(
      (a, b) => b.seats - a.seats || a.name.localeCompare(b.name),
    );
  }

  return {
    generatedAt: input.generatedAt,
    hospitals: hospitals.length,
    ...groups,
  };
}
