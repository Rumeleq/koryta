import { describe, it, expect } from "vitest";
import * as d3 from "d3-force";
import { simulation } from "~~/shared/graph/simulation";
import type {
  ForceNodeDatum,
  ForceEdgeDatum,
} from "v-network-graph/lib/force-layout";

/** A node is 32px across (`Canvas.vue` sizes it), so two centres closer than
 * that are one circle drawn on top of another. */
const NODE_WIDTH = 32;

/** The layout the forces actually settle on, rather than which forces were
 * configured.
 *
 * simulation.test.ts next door mocks d3 out entirely, so it can say that a
 * charge force exists and nothing about where anyone ends up - which is how two
 * people in a story came to be drawn on top of each other without a test
 * noticing.
 */
function settle(
  nodeCount: number,
  edges: ForceEdgeDatum[],
  /** Pins the first node at the origin, the way an entity page pins the person
   * whose graph it is - `layoutCentered` in Canvas.vue, which reaches d3 as
   * fx/fy. Leaving this out is what let the bug through the first time. */
  pinFirst = false,
) {
  const nodes: ForceNodeDatum[] = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i}`,
  }));
  if (pinFirst) {
    Object.assign(nodes[0]!, { x: 0, y: 0, fx: 0, fy: 0 });
  }

  // `initial` runs to equilibrium synchronously, which is what the graph does
  // on first paint and what a reader is left looking at.
  simulation(true)(d3, nodes, edges);

  return nodes as (ForceNodeDatum & { x: number; y: number })[];
}

function closestPair(nodes: { x: number; y: number }[]) {
  let closest = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i]!.x - nodes[j]!.x;
      const dy = nodes[i]!.y - nodes[j]!.y;
      closest = Math.min(closest, Math.hypot(dx, dy));
    }
  }
  return closest;
}

describe("force layout separation", () => {
  it("keeps two connected people apart", () => {
    // Two people drawn on top of each other was reported as the simulation
    // pulling them together. It was not - the forces settle a linked pair about
    // 100px apart, as this says, and the nodes were overlapping because no
    // layout handler had been installed to run them at all (see Canvas.vue).
    // Kept because it is what rules the physics out next time.
    const nodes = settle(2, [{ source: "n0", target: "n1" }]);

    expect(closestPair(nodes)).toBeGreaterThanOrEqual(NODE_WIDTH);
  });

  it("keeps two people apart when nothing joins them", () => {
    // Two people cited by the same article but not to each other - no link
    // force to hold them off one another at all.
    const nodes = settle(2, []);

    expect(closestPair(nodes)).toBeGreaterThanOrEqual(NODE_WIDTH);
  });

  it("keeps a crowd apart too", () => {
    // A hub: everyone joined to one person, which packs the spokes together.
    const edges = Array.from({ length: 7 }, (_, i) => ({
      source: "n0",
      target: `n${i + 1}`,
    }));
    const nodes = settle(8, edges);

    expect(closestPair(nodes)).toBeGreaterThanOrEqual(NODE_WIDTH);
  });

  it("keeps two people apart when one of them is pinned", () => {
    // The reported bug, and the case the tests above all miss. An entity page
    // pins the person whose graph it is at the origin, and `forceCenter` used
    // to translate every node so their centroid landed there. The pinned node
    // is put back each tick, so the whole correction fell on the free one - and
    // with two nodes the centroid only reaches the origin once the free node is
    // sitting on top of the pin. It settled 3px away.
    const nodes = settle(2, [{ source: "n0", target: "n1" }], true);

    expect(closestPair(nodes)).toBeGreaterThanOrEqual(NODE_WIDTH);
  });

  it("keeps three people apart when one of them is pinned", () => {
    // Three hid the bug: two free nodes settle either side of the pin, so their
    // centroid is already the origin and there is nothing to correct. Kept so
    // that a fix which only helps the two-node case is not mistaken for one
    // that works.
    const nodes = settle(
      3,
      [
        { source: "n0", target: "n1" },
        { source: "n1", target: "n2" },
      ],
      true,
    );

    expect(closestPair(nodes)).toBeGreaterThanOrEqual(NODE_WIDTH);
  });

  it("still spreads a graph out rather than stacking it at the origin", () => {
    const nodes = settle(2, [{ source: "n0", target: "n1" }]);

    // Separated, but not flung to opposite corners: the link is still doing its
    // job of holding a related pair near each other.
    expect(closestPair(nodes)).toBeLessThan(400);
  });
});
