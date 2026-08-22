import { describe, it, expect } from "vitest";
import {
  boardSeats,
  buildHospitalStats,
  isPublicHospital,
  isSupervisoryRole,
  NO_PARTY,
  type BoardEdgeRow,
  type BoardPersonRow,
  type HospitalPlaceRow,
} from "../../../server/utils/hospitalStats";

function place(
  id: string,
  overrides: Partial<HospitalPlaceRow> = {},
): HospitalPlaceRow {
  return {
    id,
    name: id,
    published: true,
    isPublic: true,
    categories: ["szpitale"],
    ...overrides,
  };
}

function seat(
  personId: string,
  placeId: string,
  overrides: Partial<BoardEdgeRow> = {},
): BoardEdgeRow {
  return {
    source: personId,
    target: placeId,
    name: "Rada Nadzorcza",
    published: true,
    ...overrides,
  };
}

function person(
  id: string,
  parties: string[] | Record<string, string> | undefined,
  overrides: Partial<BoardPersonRow> = {},
): BoardPersonRow {
  return { id, name: id, parties, published: true, ...overrides };
}

const build = (input: {
  places: HospitalPlaceRow[];
  edges?: BoardEdgeRow[];
  people?: BoardPersonRow[];
}) =>
  buildHospitalStats({
    places: input.places,
    edges: input.edges ?? [],
    people: input.people ?? [],
    generatedAt: "2026-08-22T00:00:00.000Z",
    today: "2026-08-22",
  });

describe("isPublicHospital", () => {
  it("counts a published, publicly owned place tagged szpitale", () => {
    expect(isPublicHospital(place("a"))).toBe(true);
  });

  it("reads a category array stored as a numbered-key object", () => {
    // sanitizeFirestoreData writes arrays that way, and array-contains cannot
    // match them - which is why the filter runs in memory at all.
    expect(
      isPublicHospital(place("a", { categories: { "0": "szpitale" } })),
    ).toBe(true);
  });

  it("leaves out a draft, a place nobody tagged, and one nobody has shown to be public", () => {
    expect(isPublicHospital(place("a", { published: false }))).toBe(false);
    expect(isPublicHospital(place("a", { deleted: true }))).toBe(false);
    expect(isPublicHospital(place("a", { categories: ["wodociagi"] }))).toBe(
      false,
    );
    // `false` and absent both mean "no evidence", and this page names people.
    expect(isPublicHospital(place("a", { isPublic: false }))).toBe(false);
    expect(isPublicHospital(place("a", { isPublic: undefined }))).toBe(false);
  });
});

describe("isSupervisoryRole", () => {
  it("recognises the role the KRS pipeline writes, however it is spaced", () => {
    expect(isSupervisoryRole("Rada Nadzorcza")).toBe(true);
    expect(isSupervisoryRole("rada  nadzorcza ")).toBe(true);
    expect(isSupervisoryRole("Rada Nadzorcza (przewodniczący)")).toBe(true);
    expect(isSupervisoryRole("Rada Społeczna")).toBe(true);
  });

  it("is not every job at the hospital", () => {
    expect(isSupervisoryRole("Zarząd")).toBe(false);
    expect(isSupervisoryRole("Prokurent")).toBe(false);
    expect(isSupervisoryRole(undefined)).toBe(false);
    expect(isSupervisoryRole("")).toBe(false);
  });
});

describe("boardSeats", () => {
  it("counts one person on one board once, however many spells are recorded", () => {
    // Two open spells: a re-appointment, or the same one recorded twice. One
    // seat either way - a board cannot hold more members than it has chairs.
    const { current } = boardSeats(
      [seat("p1", "h1"), seat("p1", "h1", { name: "Rada Nadzorcza" })],
      "2026-08-22",
    );
    expect(current).toEqual([{ placeId: "h1", personId: "p1" }]);
  });

  it("puts a finished spell aside instead of counting it", () => {
    const { current, ended } = boardSeats(
      [seat("p1", "h1", { end_date: "2020-05-01" })],
      "2026-08-22",
    );
    expect(current).toEqual([]);
    expect(ended).toEqual([{ placeId: "h1", personId: "p1" }]);
  });

  it("lets an open spell outrank a finished one for the same seat", () => {
    const { current, ended } = boardSeats(
      [seat("p1", "h1", { end_date: "2020-05-01" }), seat("p1", "h1")],
      "2026-08-22",
    );
    expect(current).toHaveLength(1);
    expect(ended).toEqual([]);
  });

  it("skips unpublished edges and roles that are not board seats", () => {
    const { current } = boardSeats(
      [
        seat("p1", "h1", { published: false }),
        seat("p2", "h1", { name: "Zarząd" }),
        seat("p3", "h1", { name: undefined }),
      ],
      "2026-08-22",
    );
    expect(current).toEqual([]);
  });
});

describe("buildHospitalStats", () => {
  it("splits the hospitals by what supervises them, not by the edge role", () => {
    // Both edges say "Rada Nadzorcza" - rejestr.io labels every supervisory
    // connection that way. Only the company field knows which seat is paid.
    const stats = build({
      places: [
        place("paid", { supervisoryOrgan: "rada_nadzorcza" }),
        place("unpaid", { supervisoryOrgan: "rada_spoleczna" }),
        place("silent", { supervisoryOrgan: "brak" }),
        place("unread"),
      ],
      edges: [
        seat("p1", "paid"),
        seat("p2", "unpaid"),
        seat("p3", "silent"),
        seat("p4", "unread"),
      ],
      people: [
        person("p1", ["PiS"]),
        person("p2", ["PO"]),
        person("p3", ["PSL"]),
        person("p4", ["PSL"]),
      ],
    });

    expect(stats.hospitals).toBe(4);
    expect(stats.paid.hospitals).toBe(1);
    expect(stats.paid.seats).toBe(1);
    expect(stats.unpaid.hospitals).toBe(1);
    expect(stats.unpaid.seats).toBe(1);
    // "no organ registered" is not evidence of a paid one: most SPZOZ never
    // file their rada społeczna, so those sit out of both breakdowns.
    expect(stats.other.hospitals).toBe(2);
    expect(stats.other.seats).toBe(2);
    expect(stats.paid.byParty).toEqual([
      { party: "PiS", seats: 1, people: 1, hospitals: 1 },
    ]);
    expect(stats.paid.rows).toEqual([
      {
        id: "paid",
        name: "paid",
        supervisoryOrgan: "rada_nadzorcza",
        legalForm: null,
        seats: 1,
        parties: ["PiS"],
      },
    ]);
  });

  it("counts a seat under every party its holder carries, and says how many it could attribute", () => {
    const stats = build({
      places: [place("h1", { supervisoryOrgan: "rada_nadzorcza" })],
      edges: [seat("p1", "h1"), seat("p2", "h1"), seat("p3", "h1")],
      people: [
        person("p1", ["PO", "Nowa Lewica"]),
        person("p2", ["PO"]),
        person("p3", []),
      ],
    });

    expect(stats.paid.seats).toBe(3);
    expect(stats.paid.seatsWithParty).toBe(2);
    expect(stats.paid.byParty).toEqual([
      { party: "PO", seats: 2, people: 2, hospitals: 1 },
      { party: "Nowa Lewica", seats: 1, people: 1, hospitals: 1 },
      { party: NO_PARTY, seats: 1, people: 1, hospitals: 1 },
    ]);
  });

  it("reads parties stored as a numbered-key object", () => {
    const stats = build({
      places: [place("h1", { supervisoryOrgan: "rada_nadzorcza" })],
      edges: [seat("p1", "h1")],
      people: [person("p1", { "0": "PiS" })],
    });
    expect(stats.paid.byParty).toEqual([
      { party: "PiS", seats: 1, people: 1, hospitals: 1 },
    ]);
  });

  it("keeps the seat but not the party when the person is still a draft", () => {
    const stats = build({
      places: [place("h1", { supervisoryOrgan: "rada_nadzorcza" })],
      edges: [seat("p1", "h1")],
      people: [person("p1", ["PiS"], { published: false })],
    });
    expect(stats.paid.seats).toBe(1);
    expect(stats.paid.seatsWithParty).toBe(0);
    expect(stats.paid.byParty).toEqual([
      { party: NO_PARTY, seats: 1, people: 1, hospitals: 1 },
    ]);
  });

  it("shows how many boards it has actually observed", () => {
    const stats = build({
      places: [
        place("h1", { supervisoryOrgan: "rada_nadzorcza" }),
        place("h2", { supervisoryOrgan: "rada_nadzorcza" }),
      ],
      edges: [seat("p1", "h1"), seat("p1", "h1", { end_date: "2020-01-01" })],
      people: [person("p1", ["PiS"])],
    });
    expect(stats.paid.hospitals).toBe(2);
    // A party with few seats may just be unobserved, so the denominator ships
    // with the numbers.
    expect(stats.paid.hospitalsWithSeats).toBe(1);
    expect(stats.paid.endedSeats).toBe(0);
  });

  it("reports the seats somebody has left without counting them", () => {
    const stats = build({
      places: [place("h1", { supervisoryOrgan: "rada_nadzorcza" })],
      edges: [seat("p1", "h1", { end_date: "2020-01-01" })],
      people: [person("p1", ["PiS"])],
    });
    expect(stats.paid.seats).toBe(0);
    expect(stats.paid.endedSeats).toBe(1);
    expect(stats.paid.byParty).toEqual([]);
  });

  it("ignores edges into anything that is not a counted hospital", () => {
    const stats = build({
      places: [
        place("h1", { supervisoryOrgan: "rada_nadzorcza" }),
        place("private", {
          supervisoryOrgan: "rada_nadzorcza",
          isPublic: false,
        }),
      ],
      edges: [seat("p1", "private"), seat("p2", "elsewhere")],
      people: [person("p1", ["PiS"]), person("p2", ["PiS"])],
    });
    expect(stats.hospitals).toBe(1);
    expect(stats.paid.seats).toBe(0);
    expect(stats.paid.byParty).toEqual([]);
  });

  it("names the organ kinds each group covers", () => {
    const stats = build({ places: [] });
    expect(stats.paid.kinds).toEqual(["rada_nadzorcza"]);
    expect(stats.unpaid.kinds).toEqual(["rada_spoleczna"]);
    expect(stats.other.kinds).toEqual([
      "komisja_rewizyjna",
      "inny",
      "nieznany",
      "brak",
    ]);
  });

  it("sorts hospitals by seats and keeps the legal form for the exclusion note", () => {
    const stats = build({
      places: [
        place("small", {
          supervisoryOrgan: "rada_nadzorcza",
          legalForm: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
        }),
        place("big", {
          supervisoryOrgan: "rada_nadzorcza",
          legalForm: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
        }),
      ],
      edges: [seat("p1", "big"), seat("p2", "big"), seat("p3", "small")],
      people: [person("p1", ["PO"]), person("p2", ["PO"]), person("p3", [])],
    });
    expect(stats.paid.rows.map((row) => row.id)).toEqual(["big", "small"]);
    expect(stats.paid.rows[0]?.legalForm).toBe(
      "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
    );
  });
});
