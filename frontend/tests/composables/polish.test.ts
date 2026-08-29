import { describe, it, expect } from "vitest";
import {
  polishCounting,
  polishCountingGenitive,
  polishCountingGrouped,
  polishNumber,
} from "../../app/composables/polish";

/** The separator `Intl` groups thousands with in Polish. Spelled out so a
 * failing expectation shows „1 284” against „1284” rather than two strings
 * that look identical in the diff. */
const NBSP = "\u00a0";

describe("polishCountingGenitive", () => {
  it("uses the genitive plural after a preposition", () => {
    // The progress bar said „sprawdzono 645 z 1284 osoby” until this existed:
    // `polishCounting` answers in the nominative, and after „z” a count
    // ending in 2-4 wants „osób”.
    expect(polishCountingGenitive(1284, "osoby", "osób")).toBe(
      `1${NBSP}284 osób`,
    );
    expect(polishCountingGenitive(2, "osoby", "osób")).toBe("2 osób");
    expect(polishCountingGenitive(22, "osoby", "osób")).toBe("22 osób");
    expect(polishCountingGenitive(0, "osoby", "osób")).toBe("0 osób");
  });

  it("keeps the singular for exactly one", () => {
    // A filtered table can hold one person, and „z 1 osób” is the one place
    // the two-form rule would show.
    expect(polishCountingGenitive(1, "osoby", "osób")).toBe("1 osoby");
    expect(polishCountingGenitive(21, "osoby", "osób")).toBe("21 osób");
  });

  it("leaves polishCounting's nominative alone", () => {
    // A dozen other sentences and two visual baselines are written against
    // this output; the genitive is a second function for that reason.
    expect(polishCounting(1284, "osoba", "osoby", "osób")).toBe("1284 osoby");
    expect(polishCounting(1, "osoba", "osoby", "osób")).toBe("1 osoba");
  });
});

describe("polishCountingGrouped", () => {
  it("groups the thousands and keeps the nominative", () => {
    // The query bar's row count sits directly above „sprawdzono 645 z 1 284
    // osób”; ungrouped, the two figures did not look like the same number.
    expect(polishCountingGrouped(1284, "osoba", "osoby", "osób")).toBe(
      `1${NBSP}284 osoby`,
    );
    expect(polishCountingGrouped(1, "osoba", "osoby", "osób")).toBe("1 osoba");
    expect(polishCountingGrouped(12, "osoba", "osoby", "osób")).toBe("12 osób");
    expect(polishCountingGrouped(1002, "osoba", "osoby", "osób")).toBe(
      `1${NBSP}002 osoby`,
    );
  });
});

describe("polishNumber", () => {
  it("groups four-digit counts, which the pl locale does not", () => {
    // `Intl.NumberFormat("pl-PL")` on its own answers „1284”: CLDR only starts
    // grouping at five digits, and the table's totals live below that.
    expect(polishNumber(1284)).toBe(`1${NBSP}284`);
    expect(polishNumber(12345)).toBe(`12${NBSP}345`);
    expect(polishNumber(645)).toBe("645");
  });
});
