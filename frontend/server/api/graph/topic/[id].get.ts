import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { partyColors } from "~~/shared/misc";
import {
  getEdges,
  getNodeGroups,
  getNodes,
  getNodesNoStats,
  type GraphLayout,
} from "~~/shared/graph/util";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { fetchNodesByIds } from "~~/server/utils/fetch";
import {
  articleIdsForTopic,
  edgesCitingArticles,
} from "~~/server/utils/topics";
import type { Person, Company, Region } from "~~/shared/model";
import type { H3Event } from "h3";

/** The people in a story.
 *
 * Three hops: the topic's `tagged` edges give the articles, the articles'
 * `references` give the relations somebody drew from them, and those relations
 * give the people. The articles and the topic are not drawn - `getNodesNoStats`
 * builds nodes for people, places and regions only - which is the point: what a
 * reader wants from a story is who is in it, not a diagram of our filing.
 *
 * Unlike `/api/graph/local/[id]` there is no BFS. The cited relations *are* the
 * answer, so every node they touch is wanted and nothing is reached by
 * traversal.
 */
async function topicGraph(event: H3Event): Promise<GraphLayout> {
  const topicId = getRouterParam(event, "id");
  if (!topicId) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }
  const includeDrafts = wantsLatest(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const articleIds = await articleIdsForTopic(db, topicId, includeDrafts);
  const cited = await edgesCitingArticles(db, articleIds, includeDrafts);

  const nodeIds = Array.from(
    new Set(cited.flatMap((edge) => [edge.source, edge.target])),
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

// Whoever is signed in is the one who may have just tagged the article they are
// looking for, so they read through the six hour cache. See the helper.
export default editorFreshCachedEventHandler(topicGraph);
