import { describe, it, expect } from "vitest";
import { graphNodeDestination, readableInk } from "~/utils/graphNode";
import { NODE_COLORS } from "~~/shared/graph/nodes";
import { partyColors } from "~~/shared/misc";
import type { Node as GraphNode } from "~~/shared/graph/model";

const node = (over: Partial<GraphNode>): GraphNode => ({
  name: "X",
  type: "circle",
  color: "#000000",
  ...over,
});

describe("graphNodeDestination", () => {
  it("reads the node's own kind where it has one", () => {
    expect(
      graphNodeDestination(node({ entityType: "person", type: "circle" })),
    ).toBe("person");
    expect(
      graphNodeDestination(node({ entityType: "place", type: "rect" })),
    ).toBe("place");
    expect(
      graphNodeDestination(node({ entityType: "region", type: "document" })),
    ).toBe("region");
  });

  it("falls back to the shape for a payload written before entityType", () => {
    expect(graphNodeDestination(node({ type: "circle" }))).toBe("person");
    expect(graphNodeDestination(node({ type: "rect" }))).toBe("place");
  });

  it("tells a region from an article by its teryt, the only thing that does", () => {
    // Both are drawn as `document`, so without `entityType` the shape alone
    // cannot say which page the node leads to.
    expect(
      graphNodeDestination({
        ...node({ type: "document" }),
        teryt: "12",
      } as GraphNode),
    ).toBe("region");
    expect(graphNodeDestination(node({ type: "document" }))).toBe("article");
  });

  it("has nothing to say about a node it was not given", () => {
    expect(graphNodeDestination(undefined)).toBeUndefined();
  });
});

describe("readableInk", () => {
  it("puts white on the dark party colours and black on the light ones", () => {
    // PiS navy and Konfederacja's near black at one end, Polska 2050's yellow
    // at the other. A glyph drawn in one fixed colour is invisible on half of
    // them, which is the whole reason this function exists.
    expect(readableInk(partyColors.PiS)).toBe("#ffffff");
    expect(readableInk(partyColors.Konfederacja)).toBe("#ffffff");
    expect(readableInk(partyColors["Polska 2050"])).toBe("#1b1b1b");
    expect(readableInk(partyColors.PSL)).toBe("#1b1b1b");
  });

  it("carries a white glyph on every node colour that is not a party's", () => {
    expect(readableInk(NODE_COLORS.person)).toBe("#ffffff");
    expect(readableInk(NODE_COLORS.place)).toBe("#ffffff");
    expect(readableInk(NODE_COLORS.region)).toBe("#ffffff");
  });

  it("reads three digit hex, with or without the hash", () => {
    expect(readableInk("#fff")).toBe("#1b1b1b");
    expect(readableInk("000")).toBe("#ffffff");
  });

  it("assumes dark for anything it cannot parse", () => {
    // The css keywords older node builders wrote - `gray`, `green` - are both
    // dark enough for white, so the fallback is the right guess and not merely
    // a safe one.
    expect(readableInk("gray")).toBe("#ffffff");
    expect(readableInk(undefined)).toBe("#ffffff");
  });
});
