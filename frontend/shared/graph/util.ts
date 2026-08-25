import type { TraversePolicy, Edge, Node, NodeStats } from "./model";
import { SPLIT } from "./model";
import type {
  Person,
  Company,
  Edge as DBEdge,
  EdgeType,
  Region,
} from "../model";
import { DiGraph } from "digraph-js";
import { personNode, companyNode, regionNode } from "./nodes";

export interface GraphLayout {
  edges: Edge[];
  nodeGroups: ReturnType<typeof getNodeGroups>;
  nodes: Record<string, Node & { stats: NodeStats }>;
  /** How many nodes at the outer ring the budget left out, so the canvas can
   * say so. A graph that silently stops at twenty eight names reads as the
   * whole truth about somebody. */
  omitted?: number;
}

export function getNodeGroups(
  nodesNoStats: Record<string, Node>,
  edges: ReturnType<typeof getEdges>,
  people: Record<string, Person>,
  companies: Record<string, Company>,
  regions: Record<string, Region>,
) {
  const placeConnection = new DiGraph();
  placeConnection.addVertices(
    ...Object.keys(nodesNoStats).flatMap((key) => [
      // Corresponds to TraverseState
      { id: key + SPLIT + "active", adjacentTo: [], body: {} },
      { id: key + SPLIT + "dead_end", adjacentTo: [], body: {} },
    ]),
  );

  edges.forEach((edge: Edge) => {
    if (!edge.traverse) {
      return;
    }
    // If the edge should spread the node group, either map it to active node or dead_end
    // Only active states have out-edges.
    if (edge.traverse.forward) {
      placeConnection.addEdge({
        from: edge.source + SPLIT + "active",
        to: edge.target + SPLIT + edge.traverse.forward,
      });
    }
    if (edge.traverse.backward) {
      placeConnection.addEdge({
        from: edge.target + SPLIT + "active",
        to: edge.source + SPLIT + edge.traverse.backward,
      });
    }
  });

  const entries = Object.entries({ ...companies, ...regions, ...people }).map(
    ([placeID, place]) => {
      const children = [
        ...placeConnection.getDeepChildren(placeID + SPLIT + "active"),
      ]
        // Remove node state from the ID.
        .map((extendedID) => extendedID.split(SPLIT)[0])
        .filter((id) => {
          if (!id) return false;
          return !nodesNoStats[id]?.hide;
        }) as string[];

      return {
        id: placeID,
        name: place.name,
        connected: [placeID, ...children],
        stats: {
          people: children.filter(
            (node) => nodesNoStats[node]?.type === "circle",
          ).length,
        },
      };
    },
  );
  entries.push({
    id: "",
    name: "Wszystkie",
    connected: Object.keys(nodesNoStats),
    stats: {
      people: Object.keys(people).length,
    },
  });
  return entries.sort((a, b) => b.stats.people - a.stats.people);
}

export function getNodes(
  nodeGroups: ReturnType<typeof getNodeGroups>,
  nodesNoStats: ReturnType<typeof getNodesNoStats>,
): Record<string, Node & { stats: NodeStats }> {
  const nodeGroupsMap = Object.fromEntries(nodeGroups.map((v) => [v.id, v]));

  return Object.fromEntries(
    Object.entries(nodesNoStats).map(([key, node]) => [
      key,
      {
        ...node,
        stats: nodeGroupsMap[key]?.stats ?? { people: 0 },
      },
    ]),
  );
}

export function getNodesNoStats(
  people: Record<string, Person>,
  companies: Record<string, Company>,
  regions: Record<string, Region>,
  partyColors: Record<string, string>,
): Record<string, Node> {
  const result: Record<string, Node> = {};
  Object.entries(people).forEach(([key, person]) => {
    result[key] = personNode(person, partyColors);
  });
  Object.entries(companies).forEach(([key, company]) => {
    result[key] = companyNode(company);
  });
  Object.entries(regions).forEach(([key, region]) => {
    result[key] = regionNode(region);
  });

  return result;
}

const edgeLabel: Record<EdgeType, string> = {
  employed: "pracuje",
  connection: "zna",
  mentions: "wspomina",
  owns: "właściciel",
  comment: "komentarz",
  election: "kandydował",
  tagged: "temat",
};

const edgeTraverse: Record<EdgeType, TraversePolicy> = {
  employed: {
    forward: "active",
    backward: "dead_end",
  },
  connection: {
    forward: "active",
    backward: "active",
  },
  mentions: {
    forward: "dead_end",
    backward: "active",
  },
  owns: {
    forward: "active",
    backward: "dead_end",
  },
  comment: {
    forward: "dead_end",
    backward: "dead_end",
  },
  election: {
    forward: "dead_end",
    backward: "dead_end",
  },
  // Dead in both directions, and it has to stay that way. A topic is joined to
  // every article in its story, so a traversable `tagged` edge turns the topic
  // node into a hub two hops wide: everyone mentioned anywhere in an affair
  // would read as connected to everyone else, on `/graf` and on every entity
  // page. The topic view builds its own graph from the articles' `references`
  // instead, which is a claim somebody actually made.
  // Guarded by a test in `tests/shared/graph/util.test.ts`.
  tagged: {
    forward: "dead_end",
    backward: "dead_end",
  },
};

export function getEdges(edgesFromDB: DBEdge[]) {
  return edgesFromDB.map((edge: DBEdge) => {
    const result: Edge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.name ?? edgeLabel[edge.type],
      type: edge.type,
      traverse: edgeTraverse[edge.type],
      content: edge.content,
      name: edge.name,
      references: edge.references,
      visibility: edge.visibility,
      party: edge.party,
      committee: edge.committee,
      position: edge.position,
      elected: edge.elected,
      term: edge.term,
      by_election: edge.by_election,
      start_date: edge.start_date,
      end_date: edge.end_date,
    };
    return result;
  });
}

/** The nodes within `maxDepth` relations of the subject, each stamped with how
 * far away it is.
 *
 * The stamp is the point as much as the filter. A two hop graph drawn flat
 * reads as one crowd - the reader cannot tell which of forty names is this
 * person's employer and which is a colleague's - so every node carries the hop
 * count that put it there, and the canvas draws the rings differently.
 *
 * `expandedIds` are nodes the reader asked to see more of. They are extra
 * roots for the walk, but they start at one rather than nought: a page has a
 * single subject, and a neighbour drawn at depth nought gets the subject's
 * size, ring and label - which is a claim about whose page this is. Starting
 * them at one also puts whatever they reveal in the outer ring, where
 * `pruneOuterRing` can budget it rather than letting an expansion smuggle an
 * unbounded number of nodes past it. */
export function getGraphBFS(
  subjectId: string,
  expandedIds: string[],
  maxDepth: number,
  edges: Edge[],
  interestingNodes: Record<string, Node & { stats: NodeStats }>,
): Record<string, Node & { stats: NodeStats; depth: number }> {
  const depths = new Map<string, number>();

  const queue: { id: string; d: number }[] = [];
  const roots: [string, number][] = [
    [subjectId, 0],
    ...expandedIds.map((id): [string, number] => [id, 1]),
  ];
  for (const [id, d] of roots) {
    if (depths.has(id)) continue;
    queue.push({ id, d });
    depths.set(id, d);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.d >= maxDepth) continue;

    const neighbors = edges
      .filter((e) => e.source === current.id || e.target === current.id)
      .map((e) => (e.source === current.id ? e.target : e.source));

    for (const neighborId of neighbors) {
      if (!interestingNodes[neighborId]) {
        continue;
      }

      if (!depths.has(neighborId)) {
        depths.set(neighborId, current.d + 1);
        queue.push({ id: neighborId, d: current.d + 1 });
      }
    }
  }

  return Object.fromEntries(
    Object.entries(interestingNodes)
      .filter(([key]) => depths.has(key))
      .map(([key, node]) => [key, { ...node, depth: depths.get(key)! }]),
  );
}

/** Cut the outermost ring down to `budget`, keeping the part of it that says
 * something about the subject.
 *
 * The ring is cut rather than the fetch narrowed because which second hop nodes
 * matter is only knowable once they are all in hand: the ones worth drawing are
 * those reached through more than one direct relation - a colleague who follows
 * this person from one board to the next - and those whose relation has not
 * ended. Neither is a query Firestore can answer.
 *
 * Shared out round by round rather than by score alone, so every direct
 * relation contributes something before any of them contributes a second: a
 * person with one colleague at a small foundation and forty at a ministry
 * should still see the foundation on the canvas. That is the whole of the
 * fairness rule - no per relation cap on top of it, because a ministry may
 * only reach its seventh once every other relation has had six or run dry, and
 * a person who sits on exactly one board should see that board rather than six
 * of it.
 *
 * The inner rings are never touched. They are the page's own relations, and the
 * list above the graph already names every one of them.
 */
export function pruneOuterRing<T extends Node & { depth: number }>(
  nodes: Record<string, T>,
  edges: Edge[],
  budget: number,
): { nodes: Record<string, T>; omitted: number } {
  const entries = Object.entries(nodes);
  const outerDepth = entries.reduce((max, [, n]) => Math.max(max, n.depth), 0);
  // Nothing to thin: a one hop graph is the page's own relations, and every one
  // of them is drawn whatever it costs.
  if (outerDepth < 2) return { nodes, omitted: 0 };

  const outer = new Set(
    entries.filter(([, n]) => n.depth === outerDepth).map(([id]) => id),
  );
  if (outer.size <= budget) return { nodes, omitted: 0 };

  /** For each inner node, the outer ones hanging off it. */
  const sponsors = new Map<string, Set<string>>();
  /** Which inner nodes each outer one hangs off, and whether any of those
   * relations is still open. Built once and read by the sort below: scoring
   * inside the comparator would re-walk it O(n log n) times for a ranking that
   * is settled before any of the sorting starts. */
  const reach = new Map<string, { paths: Set<string>; current: boolean }>();

  for (const edge of edges) {
    const ends: [string, string][] = [
      [edge.source, edge.target],
      [edge.target, edge.source],
    ];
    for (const [inner, out] of ends) {
      if (!outer.has(out) || outer.has(inner) || !nodes[inner]) continue;
      const seen = reach.get(out) ?? {
        paths: new Set<string>(),
        current: false,
      };
      seen.paths.add(inner);
      seen.current ||= !edge.end_date;
      reach.set(out, seen);

      const hanging = sponsors.get(inner) ?? new Set<string>();
      hanging.add(out);
      sponsors.set(inner, hanging);
    }
  }

  /** Best first: reached by the most of the page's own relations, then still
   * held rather than ended, then by name so the order is total. */
  const better = (a: string, b: string) => {
    const [x, y] = [reach.get(a), reach.get(b)];
    return (
      (y?.paths.size ?? 0) - (x?.paths.size ?? 0) ||
      Number(y?.current ?? false) - Number(x?.current ?? false) ||
      (nodes[a]?.name ?? a).localeCompare(nodes[b]?.name ?? b)
    );
  };

  const ranked = new Map<string, string[]>(
    [...sponsors].map(([inner, hanging]) => [inner, [...hanging].sort(better)]),
  );
  // Deterministic order for the round robin, so the same graph is drawn twice
  // the same way and a cached response matches a fresh one.
  const innerOrder = [...ranked.keys()].sort((a, b) =>
    (nodes[a]?.name ?? a).localeCompare(nodes[b]?.name ?? b),
  );

  const kept = new Set<string>();
  while (kept.size < budget) {
    const before = kept.size;
    for (const inner of innerOrder) {
      if (kept.size >= budget) break;
      const next = ranked.get(inner)?.find((id) => !kept.has(id));
      if (next) kept.add(next);
    }
    // Every sponsor had a turn and none of them had anything left.
    if (kept.size === before) break;
  }

  return {
    nodes: Object.fromEntries(
      entries.filter(([id, n]) => n.depth !== outerDepth || kept.has(id)),
    ),
    omitted: outer.size - kept.size,
  };
}
