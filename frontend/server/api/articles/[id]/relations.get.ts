import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { fetchEdgesForNode } from "~~/server/utils/edgePublication";
import { pageIsPublic } from "~~/shared/model";
import type { NodeType } from "~~/shared/model";

/** The far end of one of an article's own edges. */
export type ArticleRelation = {
  /** The edge, which is what a "remove" acts on. */
  edgeId: string;
  nodeId: string;
  name: string | null;
  nodeType: NodeType | null;
  /** Whether the relation is live for the public, as opposed to a draft only
   * signed in readers are shown. */
  published: boolean;
};

export type ArticleRelations = {
  /** `tagged` edges: the stories this article belongs to. */
  topics: ArticleRelation[];
  /** `mentions` edges: who the article talks about. */
  mentions: ArticleRelation[];
};

/** What an article points at.
 *
 * `/api/graph/local/[id]` cannot answer this. It keeps only the edges whose
 * both ends it drew, and it draws people, places and regions - never an article
 * or a topic - so every edge touching an article is dropped before it is
 * returned. That is why `useEdges` on an article page has always come back
 * empty, and why this endpoint exists rather than the page reusing the graph.
 *
 * A signed in reader is shown drafts, everyone else only what is published -
 * the same rule as the graph endpoint, and what makes an unapproved tag visible
 * to the person who just added it.
 */
export default editorFreshCachedEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }
  const includeDrafts = wantsLatest(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const edges = (await fetchEdgesForNode(db, id))
    .filter((edge) => edge.deleted !== true)
    .filter((edge) => edge.type === "tagged" || edge.type === "mentions")
    // An article is the source of both kinds; an edge pointing the other way
    // would put the article itself on the far end.
    .filter((edge) => edge.source === id)
    .filter((edge) => (includeDrafts ? true : pageIsPublic(edge)));

  const farIds = Array.from(new Set(edges.map((edge) => edge.target)));
  const snaps = farIds.length
    ? await db.getAll(
        ...farIds.map((nodeId) => db.collection("nodes").doc(nodeId)),
      )
    : [];
  const nodes = new Map(snaps.map((snap) => [snap.id, snap.data()]));

  const toRelation = (edge: (typeof edges)[number]): ArticleRelation => {
    const node = nodes.get(edge.target);
    return {
      edgeId: edge.id,
      nodeId: edge.target,
      name: typeof node?.name === "string" ? node.name : null,
      nodeType: (node?.type as NodeType | undefined) ?? null,
      published: pageIsPublic(edge),
    };
  };

  const byName = (a: ArticleRelation, b: ArticleRelation) =>
    (a.name ?? "").localeCompare(b.name ?? "", "pl");

  return {
    topics: edges
      .filter((edge) => edge.type === "tagged")
      .map(toRelation)
      .sort(byName),
    mentions: edges
      .filter((edge) => edge.type === "mentions")
      .map(toRelation)
      .sort(byName),
  } satisfies ArticleRelations;
});
