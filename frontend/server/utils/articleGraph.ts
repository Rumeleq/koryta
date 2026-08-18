import type { Firestore } from "firebase-admin/firestore";
import { partyColors } from "~~/shared/misc";
import {
  getEdges,
  getNodeGroups,
  getNodes,
  getNodesNoStats,
  type GraphLayout,
} from "~~/shared/graph/util";
import { fetchNodesByIds } from "~~/server/utils/fetch";
import {
  edgesCitingArticles,
  nodesMentionedByArticles,
} from "~~/server/utils/topics";
import type { Person, Company, Region } from "~~/shared/model";

/** The people a set of articles puts on the record.
 *
 * Two things go in. The articles' `references` give the relations somebody drew
 * from them, which are the edges; the articles' `mentions` give the people they
 * name, who are nodes whether or not a relation has been drawn from them yet -
 * somebody who has just been recorded as named in a story should appear in it,
 * and waiting for a relation would mean they only ever appear once the work of
 * connecting them is already done.
 *
 * Neither the articles nor the topic are drawn: `getNodesNoStats` builds nodes
 * for people, places and regions only. That is the point - what a reader wants
 * from a story is who is in it, not a diagram of our filing.
 *
 * Unlike `/api/graph/local/[id]` there is no BFS. What the articles say *is*
 * the answer, so every node reached is wanted and nothing is reached by
 * traversal.
 */
export async function graphForArticles(
  db: Firestore,
  articleIds: string[],
  includeDrafts: boolean,
): Promise<GraphLayout> {
  const [cited, mentioned] = await Promise.all([
    edgesCitingArticles(db, articleIds, includeDrafts),
    nodesMentionedByArticles(db, articleIds, includeDrafts),
  ]);

  const nodeIds = Array.from(
    new Set([
      ...cited.flatMap((edge) => [edge.source, edge.target]),
      ...mentioned,
    ]),
  );
  const nodesRaw = await fetchNodesByIds(nodeIds);

  const people: Record<string, Person> = {};
  const places: Record<string, Company> = {};
  const regions: Record<string, Region> = {};
  for (const node of nodesRaw) {
    if (!node.id) continue;
    // A draft endpoint is only drawn for someone who may see drafts, or a story
    // would advertise the existence of pages they cannot open.
    if (!includeDrafts && !node.visibility) continue;
    if (node.type === "person") people[node.id] = node;
    else if (node.type === "place") places[node.id] = node;
    else if (node.type === "region") regions[node.id] = node;
  }

  const nodesNoStats = getNodesNoStats(people, places, regions, partyColors);
  const validNodeIds = new Set(Object.keys(nodesNoStats));

  const edges = getEdges(
    cited.filter(
      (edge) => validNodeIds.has(edge.source) && validNodeIds.has(edge.target),
    ),
  );
  const nodeGroups = getNodeGroups(
    nodesNoStats,
    edges,
    people,
    places,
    regions,
  );

  return { edges, nodes: getNodes(nodeGroups, nodesNoStats), nodeGroups };
}
