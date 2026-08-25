import type {
  ForceNodeDatum,
  ForceEdgeDatum,
} from "v-network-graph/lib/force-layout";
import type * as d3 from "d3-force";

type d3Type = typeof d3;

type CreateSimulationFunction = (
  d3: d3Type,
  nodes: ForceNodeDatum[],
  edges: ForceEdgeDatum[],
) => d3.Simulation<ForceNodeDatum, ForceEdgeDatum>;

export const target = 0.001 as const;
export const log_target = -3 as const;

export function simulation(
  initial: boolean,
  tick?: (currentAlpha: number) => void,
  done?: () => void,
): CreateSimulationFunction {
  return (d3, nodes, edges) => {
    // d3-force parameters
    const forceLink = d3
      .forceLink<ForceNodeDatum, ForceEdgeDatum>(edges)
      .id((d: ForceNodeDatum) => d.id);

    const commonConfig = d3
      .forceSimulation(nodes)
      .force("edge", forceLink.distance(80).strength(0.3))
      .force("charge", d3.forceManyBody().strength(-400))
      // A hard floor under how close two nodes may sit, which the charge alone
      // does not give: charge is a long range push that a link force can pull
      // straight through, and it did - on a board with eight members the spokes
      // packed together and the pinned subject at the centre ended up drawn
      // over one of them.
      //
      // The radius is the widest node (46px, the subject) plus room for the
      // label under it, rather than a node's own size: the simulation is handed
      // ids and positions and nothing else, so it cannot ask how big any
      // particular node is. Erring large costs a slightly wider graph, which
      // `fitToContents` then frames.
      .force(
        "collide",
        d3.forceCollide<ForceNodeDatum>().radius(38).strength(0.9),
      )
      // No `forceCenter`, and this is not a tidy-up: it drew two people on top
      // of one another.
      //
      // It works by translating every node so that their centroid sits at the
      // origin. An entity page pins its focus node there (`layoutCentered` in
      // Canvas.vue sets fx/fy), and a pinned node is put back every tick - so the
      // whole correction lands on the nodes that are free to move. With exactly
      // two nodes the centroid can only reach the origin when the free one
      // coincides with the pinned one, so that is where it was driven, every
      // time. Three nodes hid it: two free nodes settle either side of the pin,
      // their centroid is already the origin, and there is nothing to correct.
      //
      // Measured, with one node pinned: as shipped a pair settled 3px apart and
      // a triple 66px; without this force, 140px and 172px. Nothing else needed
      // changing - `forceX`/`forceY` below already pull toward the origin, and
      // they do it per node, so they hold the graph in frame without fighting a
      // pin. Guarded by tests/shared/graph/simulationLayout.test.ts.
      .force("x", d3.forceX().strength(0.02))
      .force("y", d3.forceY().strength(0.02));

    let result;
    if (initial) {
      result = commonConfig
        .velocityDecay(0.2)
        .alphaDecay(0.001)
        .stop()
        .tick(10000);
    } else {
      result = commonConfig.velocityDecay(0.5).alphaDecay(0.01);
    }

    if (tick) {
      result.on("tick.monitor", () => {
        tick(result.alpha());
      });
    }
    if (done) {
      result.on("end.monitor", done);
    }

    return result;
  };
}
