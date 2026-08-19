import { describe, it, expect } from "vitest";
import {
  employmentPlaceIds,
  regionNamesByPlaceId,
  workLocationNames,
} from "~/utils/companyLocation";
import type { Region } from "~~/shared/model";

function region(
  name: string,
  teryt: string,
  targets: { all?: string[]; approved?: string[] },
): Region {
  return {
    name,
    type: "region",
    teryt,
    stats: {
      isApproved: true,
      notesCount: 0,
      votes: {},
      edges: {
        all: {
          experienceMonths: 0,
          latestEmploymentStart: null,
          targetNodeIds: targets.all ?? [],
          currentlyEmployed: false,
        },
        approved: {
          experienceMonths: 0,
          latestEmploymentStart: null,
          targetNodeIds: targets.approved ?? [],
          currentlyEmployed: false,
        },
      },
    },
  } as Region;
}

describe("regionNamesByPlaceId", () => {
  it("names the region that owns a company", () => {
    const regions = {
      teryt1462: region("Płock", "1462", { approved: ["orlen"] }),
    };

    expect(regionNamesByPlaceId(regions, "approved")).toEqual({
      orlen: "Płock",
    });
  });

  it("reads the edge scope it is asked for", () => {
    const regions = {
      teryt1462: region("Płock", "1462", {
        all: ["orlen", "pending"],
        approved: ["orlen"],
      }),
    };

    expect(regionNamesByPlaceId(regions, "approved")).toEqual({
      orlen: "Płock",
    });
    expect(regionNamesByPlaceId(regions, "all")).toEqual({
      orlen: "Płock",
      pending: "Płock",
    });
  });

  it("prefers the most specific region claiming a company", () => {
    // The region hierarchy shares the owns edge, so a województwo can end up
    // listing a company its powiat owns.
    const regions = {
      teryt14: region("mazowieckie", "14", {
        approved: ["teryt1462", "orlen"],
      }),
      teryt1462: region("Płock", "1462", { approved: ["orlen"] }),
    };

    expect(regionNamesByPlaceId(regions, "approved").orlen).toBe("Płock");
  });

  it("survives regions the stats job has not reached", () => {
    const regions = {
      teryt14: { name: "mazowieckie", type: "region", teryt: "14" } as Region,
    };

    expect(regionNamesByPlaceId(regions, "approved")).toEqual({});
  });
});

describe("employmentPlaceIds", () => {
  const edge = (type: string, id: string, nodeType = "place") => ({
    type,
    richNode: { id, type: nodeType, name: id },
  });

  it("keeps the companies a person was employed at", () => {
    expect(
      employmentPlaceIds([edge("employed", "orlen"), edge("employed", "pkp")]),
    ).toEqual(["orlen", "pkp"]);
  });

  it("ignores relations that are not employment", () => {
    // Owning a company or being mentioned beside one says nothing about where
    // somebody sat.
    expect(
      employmentPlaceIds([
        edge("owns", "orlen"),
        edge("connection", "pkp"),
        edge("election", "teryt1461", "region"),
      ]),
    ).toEqual([]);
  });

  it("ignores employment edges that do not lead to a place", () => {
    expect(employmentPlaceIds([edge("employed", "jan", "person")])).toEqual([]);
  });
});

describe("workLocationNames", () => {
  const regionNames = { orlen: "Płock", pkp: "Warszawa", mpk: "Płock" };

  it("names the region of every employer", () => {
    expect(workLocationNames(["orlen", "pkp"], regionNames)).toEqual([
      "Płock",
      "Warszawa",
    ]);
  });

  it("names a city once however many employers sit in it", () => {
    expect(workLocationNames(["orlen", "mpk"], regionNames)).toEqual(["Płock"]);
  });

  it("drops companies no region claims", () => {
    expect(workLocationNames(["orlen", "unknown"], regionNames)).toEqual([
      "Płock",
    ]);
  });
});
