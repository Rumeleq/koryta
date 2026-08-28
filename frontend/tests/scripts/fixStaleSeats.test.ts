import { describe, it, expect } from "vitest";
import {
  parseRows,
  resolveRegionId,
  seatPlan,
} from "../../scripts/migrate/fix-stale-seats";

describe("parseRows", () => {
  it("reads a CompaniesPayloads dump", () => {
    const dump = [
      '{"krs": "0000205643", "name": "ELZAT", "teryt_code": "2469", "categories": []}',
      '{"krs": "0000445779", "name": "Centrum Medyczne Żelazna", "teryt_code": "1465"}',
    ].join("\n");
    expect(parseRows(dump)).toEqual([
      { krs: "0000205643", teryt: "2469" },
      { krs: "0000445779", teryt: "1465" },
    ]);
  });

  it("survives the progress bars koryta writes to the same stream", () => {
    // `--output stderr` puts the rows on the stream tqdm draws on, so a real
    // dump is payloads interleaved with hundreds of these, ending in \r.
    const dump =
      "Downloading files: 4it [00:00, 5.23it/s]\r" +
      '{"krs": "205643", "teryt_code": "2469"}\r' +
      "Downloading files: 8it [00:01, 5.01it/s]\r" +
      "=== Started pipeline CompaniesPayloads ===\n" +
      '{"krs": "445779", "teryt_code": "1465"}\n';
    expect(parseRows(dump)).toEqual([
      { krs: "0000205643", teryt: "2469" },
      { krs: "0000445779", teryt: "1465" },
    ]);
  });

  it("pads a KRS the dump wrote as a number", () => {
    expect(parseRows('{"krs": 205643, "teryt_code": "2469"}')).toEqual([
      { krs: "0000205643", teryt: "2469" },
    ]);
  });

  it("unwraps a row that carries its payload as a string", () => {
    // The shape `RegionPayloads` uses; accepted so a hand-made file works.
    const dump =
      '{"entity_id": "x", "payload": "{\\"krs\\": \\"0000205643\\", \\"teryt\\": \\"2469\\"}"}';
    expect(parseRows(dump)).toEqual([{ krs: "0000205643", teryt: "2469" }]);
  });

  it("takes the first of a company stated twice", () => {
    // A dump re-run into the same file states each company twice. Taking both
    // would plan the same move a second time.
    const dump = [
      '{"krs": "0000205643", "teryt_code": "2469"}',
      '{"krs": "0000205643", "teryt_code": "2469"}',
    ].join("\n");
    expect(parseRows(dump)).toHaveLength(1);
  });

  it("skips a row with nothing to say about a seat", () => {
    const dump = [
      '{"krs": "0000205643"}',
      '{"krs": "0000205643", "teryt_code": ""}',
      '{"krs": "0000205643", "teryt_code": "   "}',
      '{"teryt_code": "2469"}',
      "not json at all",
      "",
    ].join("\n");
    expect(parseRows(dump)).toEqual([]);
  });
});

describe("resolveRegionId", () => {
  const has = (ids: string[]) => (id: string) => ids.includes(id);
  const none = () => undefined;

  it("takes the exact code when a node carries it", () => {
    expect(resolveRegionId("2469", has(["teryt2469"]), none)).toBe("teryt2469");
  });

  it("falls through to the powiat, which is where a seat is recorded", () => {
    // `get_teryt` yields six digits (WOJ+POW+GMI, no RODZ), which matches no
    // gmina node - `Regions` mints those as WOJ+POW+GMI+RODZ.
    expect(resolveRegionId("246901", has(["teryt2469"]), none)).toBe(
      "teryt2469",
    );
  });

  it("prefers the exact code over the powiat above it", () => {
    expect(
      resolveRegionId("2469011", has(["teryt2469011", "teryt2469"]), none),
    ).toBe("teryt2469011");
  });

  it("finds a region stored under a different id by its teryt field", () => {
    expect(
      resolveRegionId("2469", has([]), (code) =>
        code === "2469" ? "some-legacy-id" : undefined,
      ),
    ).toBe("some-legacy-id");
  });

  it("answers null rather than guessing when nothing has that code", () => {
    // Reported and skipped by the caller: inventing a region here would seat a
    // company somewhere nobody said it was.
    expect(resolveRegionId("2469", has([]), none)).toBeNull();
  });
});

describe("seatPlan", () => {
  const edge = (id: string) => ({ id, source: "teryt1263", target: "elzat" });

  it("leaves a seat the register agrees with alone", () => {
    expect(seatPlan(edge("anything"), "teryt1263")).toEqual({
      action: "agrees",
    });
  });

  it("updates a random-id seat in place", () => {
    // Nothing reads an edge's id - `findEdge` queries on (source, target,
    // type) - so the document keeps its revision pointer and `published` flag.
    expect(seatPlan(edge("Twm20atuwEHkzrNq8hMe"), "teryt2469")).toEqual({
      action: "update",
      to: "teryt2469",
    });
  });

  it("moves a derived-id seat to the id its new source implies", () => {
    // Left where it is, the document sits at an id naming the old region, and
    // `createEdge` for that region would compute the same id and `batch.set`
    // straight over this seat.
    expect(seatPlan(edge("edge_teryt1263_elzat_seat"), "teryt2469")).toEqual({
      action: "move",
      to: "teryt2469",
      newId: "edge_teryt2469_elzat_seat",
    });
  });

  it("does not mistake an id that merely looks derived", () => {
    // The id has to be the one THIS edge's source and target derive, or the
    // move would be to an id nothing would have collided with anyway.
    expect(seatPlan(edge("edge_teryt9999_elzat_seat"), "teryt2469")).toEqual({
      action: "update",
      to: "teryt2469",
    });
  });
});
