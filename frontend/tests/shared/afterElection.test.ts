import { describe, it, expect } from "vitest";
import {
  linksAfterElection,
  yearOf,
  YEARS_AFTER_ELECTION,
  type Candidacy,
  type Post,
} from "../../shared/afterElection";

function candidacy(
  year: number,
  elected?: boolean | null,
  region = "Powiat Testowy",
): Candidacy {
  return {
    id: `c-${year}-${region}`,
    regionId: region.toLowerCase().replace(/\s+/g, "-"),
    regionName: region,
    year,
    position: "Rada powiatu",
    elected,
  };
}

function post(start: string, company = "Zakład Testowy"): Post {
  return {
    id: `p-${start}-${company}`,
    companyId: company.toLowerCase().replace(/\s+/g, "-"),
    companyName: company,
    role: "Rada Nadzorcza",
    start,
  };
}

describe("yearOf", () => {
  it("reads an ISO day and a bare year", () => {
    expect(yearOf("2024-04-12")).toBe(2024);
    expect(yearOf("2024")).toBe(2024);
  });

  it("refuses anything that does not name a year", () => {
    expect(yearOf(undefined)).toBeNull();
    expect(yearOf("")).toBeNull();
    expect(yearOf("kwiecień 2024")).toBeNull();
    expect(yearOf("2024-04")).toBeNull();
  });
});

describe("linksAfterElection", () => {
  it("pairs a post taken in the year of the election", () => {
    const links = linksAfterElection(
      [candidacy(2024, false)],
      [post("2024-04-12")],
    );

    expect(links).toHaveLength(1);
    expect(links[0]!.timing).toBe("same-year");
    expect(links[0]!.outcome).toBe("lost");
    expect(links[0]!.alsoMatching).toBe(0);
  });

  it("pairs a post taken in the year after", () => {
    const links = linksAfterElection(
      [candidacy(2023, true)],
      [post("2024-01-15")],
    );

    expect(links).toHaveLength(1);
    expect(links[0]!.timing).toBe("next-year");
    expect(links[0]!.outcome).toBe("elected");
  });

  it("leaves a post outside the window alone", () => {
    // Two years on is an ordinary appointment, not one that followed
    // anything - which is the whole point of a bounded window.
    expect(
      linksAfterElection(
        [candidacy(2022)],
        [post(`${2022 + YEARS_AFTER_ELECTION + 1}-01-15`)],
      ),
    ).toHaveLength(0);
  });

  it("leaves a post taken before the election alone", () => {
    expect(
      linksAfterElection([candidacy(2024)], [post("2023-11-02")]),
    ).toHaveLength(0);
  });

  it("says nothing about a candidacy whose outcome nobody recorded", () => {
    const links = linksAfterElection(
      [candidacy(2017, undefined)],
      [post("2018-01-01")],
    );

    expect(links[0]!.outcome).toBe("unknown");
  });

  it("names one candidacy per post and counts the others", () => {
    // Somebody who stood twice in one autumn did not take the job twice. The
    // card names the candidacy nearest the appointment and admits that the
    // register does not say which of them it followed.
    const links = linksAfterElection(
      [candidacy(2024, false, "Powiat A"), candidacy(2024, true, "Powiat B")],
      [post("2024-06-01")],
    );

    expect(links).toHaveLength(1);
    expect(links[0]!.alsoMatching).toBe(1);
  });

  it("prefers the candidacy nearest the appointment", () => {
    const links = linksAfterElection(
      [candidacy(2023), candidacy(2024)],
      [post("2024-06-01")],
    );

    expect(links[0]!.candidacy.year).toBe(2024);
    expect(links[0]!.alsoMatching).toBe(1);
  });

  it("pairs each post separately", () => {
    const links = linksAfterElection(
      [candidacy(2024)],
      [post("2024-06-01", "Zakład A"), post("2025-02-01", "Zakład B")],
    );

    expect(links.map((link) => link.post.companyName)).toEqual([
      "Zakład B",
      "Zakład A",
    ]);
  });

  it("drops a post with no start date rather than guessing one", () => {
    expect(
      linksAfterElection(
        [candidacy(2024)],
        [{ ...post("2024-01-01"), start: "" }],
      ),
    ).toHaveLength(0);
  });

  it("does not reorder on the ids when two posts share a start", () => {
    // Two rows filed on one day would otherwise change places whenever the
    // ingest rewrote the collection, with nothing having happened.
    const first = linksAfterElection(
      [candidacy(2024)],
      [post("2024-06-01", "Zakład B"), post("2024-06-01", "Zakład A")],
    );
    const second = linksAfterElection(
      [candidacy(2024)],
      [post("2024-06-01", "Zakład A"), post("2024-06-01", "Zakład B")],
    );

    expect(first.map((link) => link.post.companyName)).toEqual([
      "Zakład A",
      "Zakład B",
    ]);
    expect(second.map((link) => link.post.companyName)).toEqual(
      first.map((link) => link.post.companyName),
    );
  });
});
