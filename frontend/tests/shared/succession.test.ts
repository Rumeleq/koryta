import { describe, it, expect } from "vitest";
import {
  gapLabel,
  spellDate,
  successionsAtCompany,
  MAX_GAP_DAYS,
  MAX_OVERLAP_DAYS,
  type SuccessionSpell,
} from "../../shared/succession";

/** A spell, named after who served it so the assertions read as sentences. */
function spell(
  personId: string,
  start: string | null,
  end: string | null,
  role: string | null = "Rada Nadzorcza",
): SuccessionSpell {
  return {
    id: `${personId}-${start ?? "?"}-${role ?? "?"}`,
    personId,
    role,
    start,
    end,
  };
}

/** Who replaced whom, as `"A -> B"`, which is what the tests are about. */
function handovers(spells: SuccessionSpell[]): string[] {
  return successionsAtCompany(spells).map(
    (pair) => `${pair.left.personId} -> ${pair.joined.personId}`,
  );
}

describe("spellDate", () => {
  it("reads an ISO day", () => {
    expect(spellDate("2024-04-12")).toBe(Date.parse("2024-04-12T00:00:00Z"));
  });

  it("refuses everything that is not one", () => {
    // A bare year would land on 1 January and put a spell eleven months from
    // where the register put it; the blank forms are the two spellings of "no
    // date" that /api/edges/create and the edge editor write.
    expect(spellDate("2024")).toBeNull();
    expect(spellDate("")).toBeNull();
    expect(spellDate(null)).toBeNull();
    expect(spellDate(undefined)).toBeNull();
    expect(spellDate("12.04.2024")).toBeNull();
    expect(spellDate("brak")).toBeNull();
  });
});

describe("successionsAtCompany", () => {
  it("pairs a seat handed over on the day", () => {
    const pairs = successionsAtCompany([
      spell("odchodzi", "2020-01-01", "2024-04-12"),
      spell("wchodzi", "2024-04-12", null),
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.left.personId).toBe("odchodzi");
    expect(pairs[0]!.joined.personId).toBe("wchodzi");
    expect(pairs[0]!.gapDays).toBe(0);
  });

  it("pairs across a gap up to the tolerance and not past it", () => {
    const at = (days: number) => {
      const start = new Date(
        Date.parse("2024-04-12T00:00:00Z") + days * 86_400_000,
      );
      return start.toISOString().slice(0, 10);
    };

    expect(
      handovers([
        spell("odchodzi", "2020-01-01", "2024-04-12"),
        spell("wchodzi", at(MAX_GAP_DAYS), null),
      ]),
    ).toEqual(["odchodzi -> wchodzi"]);
    expect(
      handovers([
        spell("odchodzi", "2020-01-01", "2024-04-12"),
        spell("wchodzi", at(MAX_GAP_DAYS + 1), null),
      ]),
    ).toEqual([]);
  });

  it("tolerates the register filing the two entries out of order", () => {
    // The successor entered before the predecessor was struck off. That is one
    // clerk working through a batch, not two people on one seat.
    const pairs = successionsAtCompany([
      spell("odchodzi", "2020-01-01", "2024-04-12"),
      spell("wchodzi", "2024-03-20", null),
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.gapDays).toBe(-23);
  });

  it("does not pair two people who sat on the board together for years", () => {
    expect(
      handovers([
        spell("pierwszy", "2015-01-01", "2024-04-12"),
        spell("drugi", "2016-01-01", null),
      ]),
    ).toEqual([]);
    // The boundary of the same rule.
    expect(MAX_OVERLAP_DAYS).toBe(90);
  });

  it("keeps the management board and the supervisory board apart", () => {
    expect(
      handovers([
        spell("odchodzi", "2020-01-01", "2024-04-12", "Zarząd"),
        spell("wchodzi", "2024-04-12", null, "Rada Nadzorcza"),
      ]),
    ).toEqual([]);
  });

  it("treats a role the same however it was capitalised", () => {
    expect(
      handovers([
        spell("odchodzi", "2020-01-01", "2024-04-12", "Rada Nadzorcza"),
        spell("wchodzi", "2024-04-12", null, "  rada nadzorcza "),
      ]),
    ).toEqual(["odchodzi -> wchodzi"]);
  });

  it("leaves out a spell whose role nobody recorded", () => {
    // Two unknown roles at one company are not evidence of the same seat.
    expect(
      handovers([
        spell("odchodzi", "2020-01-01", "2024-04-12", null),
        spell("wchodzi", "2024-04-12", null, null),
      ]),
    ).toEqual([]);
  });

  it("pairs a whole board changing on one day off rather than squaring it", () => {
    // The shape the register actually produces, and the reason the match is
    // one-to-one: seven out and seven in is seven claims, not forty-nine.
    const spells = [
      ...Array.from({ length: 7 }, (_, i) =>
        spell(`odchodzi${i}`, "2018-01-01", "2024-04-12"),
      ),
      ...Array.from({ length: 7 }, (_, i) =>
        spell(`wchodzi${i}`, "2024-04-12", null),
      ),
    ];

    const pairs = successionsAtCompany(spells);

    expect(pairs).toHaveLength(7);
    expect(new Set(pairs.map((p) => p.left.id)).size).toBe(7);
    expect(new Set(pairs.map((p) => p.joined.id)).size).toBe(7);
  });

  it("prefers the closest arrival when several could have taken the seat", () => {
    expect(
      handovers([
        spell("odchodzi", "2018-01-01", "2024-04-12"),
        spell("dwa-miesiace-pozniej", "2024-06-12", null),
        spell("tego-samego-dnia", "2024-04-12", null),
      ]),
    ).toEqual(["odchodzi -> tego-samego-dnia"]);
  });

  it("counts the same spell recorded twice as one seat", () => {
    // 211 duplicate spells in the last register import. Each copy would
    // otherwise hand the one vacated seat over a second time.
    const duplicated = spell("odchodzi", "2020-01-01", "2024-04-12");
    const pairs = successionsAtCompany([
      duplicated,
      { ...duplicated, id: "kopia" },
      spell("wchodzi", "2024-04-12", null),
      spell("tez-wchodzi", "2024-04-12", null),
    ]);

    expect(pairs).toHaveLength(1);
  });

  it("does not let somebody replace themselves", () => {
    expect(
      handovers([
        spell("ta-sama-osoba", "2016-01-01", "2020-04-12"),
        spell("ta-sama-osoba", "2020-04-12", null),
      ]),
    ).toEqual([]);
  });

  it("ignores a spell with no usable date on the side that matters", () => {
    expect(
      handovers([
        spell("wciaz-w-radzie", "2020-01-01", null),
        spell("wchodzi", "2024-04-12", null),
      ]),
    ).toEqual([]);
    expect(
      handovers([
        spell("odchodzi", "2020-01-01", "2024-04-12"),
        spell("bez-daty", null, null),
      ]),
    ).toEqual([]);
  });

  it("returns the newest handover first", () => {
    const pairs = successionsAtCompany([
      spell("a", "2010-01-01", "2014-01-01"),
      spell("b", "2014-01-01", "2020-01-01"),
      spell("c", "2020-01-01", null),
    ]);

    expect(pairs.map((p) => p.joined.personId)).toEqual(["c", "b"]);
  });

  it("pairs a same-day batch the same way whatever the edge ids are", () => {
    // Every gap in a board change is zero, so the tie-break decides who the
    // page names as whose predecessor. Keyed on edge ids, that answer moved
    // every time the ingest rewrote the collection - the site would have said
    // one thing this week and another the next with nothing having happened.
    const board = (ids: [string, string, string, string]) => [
      {
        id: ids[0],
        personId: "adam",
        role: "RN",
        start: "2019-03-01",
        end: "2024-04-12",
      },
      {
        id: ids[1],
        personId: "barbara",
        role: "RN",
        start: "2020-06-01",
        end: "2024-04-12",
      },
      {
        id: ids[2],
        personId: "cezary",
        role: "RN",
        start: "2024-04-12",
        end: null,
      },
      {
        id: ids[3],
        personId: "danuta",
        role: "RN",
        start: "2024-04-12",
        end: null,
      },
    ];

    const first = handovers(board(["a", "b", "c", "d"]));
    const reimported = handovers(board(["zz", "yy", "xx", "ww"]));

    expect(first).toEqual(reimported);
    // And the assignment itself follows the register: the member who had sat
    // there longest is filed against the arrival that sorts first.
    expect(first.sort()).toEqual(["adam -> cezary", "barbara -> danuta"]);
  });

  it("does not depend on the order the edges came back in", () => {
    const spells = [
      spell("a", "2010-01-01", "2014-01-01"),
      spell("b", "2014-01-01", "2020-01-01"),
      spell("c", "2020-01-01", null),
    ];

    expect(handovers(spells)).toEqual(handovers([...spells].reverse()));
  });
});

describe("gapLabel", () => {
  it("says what kind of gap it is, not how big the number is", () => {
    expect(gapLabel(0)).toBe("tego samego dnia");
    expect(gapLabel(1)).toBe("po 1 dniu przerwy");
    expect(gapLabel(38)).toBe("po 38 dniach przerwy");
    expect(gapLabel(-1)).toBe("wpisy nachodzą na siebie o 1 dzień");
    expect(gapLabel(-23)).toBe("wpisy nachodzą na siebie o 23 dni");
  });
});
