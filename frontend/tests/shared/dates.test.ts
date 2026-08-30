import { describe, it, expect } from "vitest";
import { isoDay, longDate, shortDate, monthYear } from "../../shared/dates";

describe("isoDay", () => {
  it("reads an ISO day", () => {
    expect(isoDay("2024-04-12")).toEqual({ y: 2024, m: 4, d: 12 });
  });

  /** `new Date("2016")` answers 1 January, which would print a date no
   * register ever recorded. */
  it("refuses anything that is not one", () => {
    for (const input of [
      "2016",
      "2016-04",
      "12.04.2024",
      "brak",
      "",
      null,
      undefined,
    ]) {
      expect(isoDay(input)).toBeNull();
    }
  });

  /** The shape alone is not enough: `Date.UTC(2024, 1, 31)` is 2 March, so a
   * day the calendar does not have would otherwise be printed as a different,
   * real one. */
  it("refuses a day the month does not have", () => {
    expect(isoDay("2024-02-31")).toBeNull();
    expect(isoDay("2023-02-29")).toBeNull();
    expect(isoDay("2024-02-29")).toEqual({ y: 2024, m: 2, d: 29 });
  });
});

describe("longDate", () => {
  it("writes the month out", () => {
    expect(longDate("2024-01-15")).toBe("15 stycznia 2024");
    expect(longDate("2024-04-12")).toBe("12 kwietnia 2024");
  });

  /** The whole point of `timeZone: "UTC"`: without it a browser west of
   * Greenwich renders every register day as the day before. The formatter is
   * pinned to UTC, so the process zone cannot move it. */
  it("does not move the day", () => {
    expect(longDate("2024-01-01")).toBe("1 stycznia 2024");
    expect(longDate("2024-12-31")).toBe("31 grudnia 2024");
  });

  it("takes a caller's own fallback", () => {
    expect(longDate(null)).toBe("brak daty");
    expect(longDate("2016", "")).toBe("");
  });
});

describe("shortDate", () => {
  it("pads to two digits", () => {
    expect(shortDate("2024-04-12")).toBe("12.04.2024");
    expect(shortDate("2019-03-01")).toBe("01.03.2019");
  });

  it("takes a caller's own fallback", () => {
    expect(shortDate(undefined)).toBe("brak daty");
  });
});

describe("monthYear", () => {
  /** The genitive, because every caller writes „od …” in front of it. A
   * `{ month: "long", year: "numeric" }` formatter answers „marzec 2019”,
   * which reads as „od marzec 2019”. */
  it("declines the month", () => {
    expect(monthYear("2019-03-01")).toBe("marca 2019");
    expect(monthYear("2024-01-15")).toBe("stycznia 2024");
    expect(monthYear("2024-10-31")).toBe("października 2024");
  });

  /** The day is dropped, not rounded: any day of the month answers the same. */
  it("says nothing about the day", () => {
    expect(monthYear("2019-03-01")).toBe(monthYear("2019-03-28"));
  });

  it("answers with an empty string by default", () => {
    expect(monthYear("2019")).toBe("");
    expect(monthYear(null, "brak daty")).toBe("brak daty");
  });
});
