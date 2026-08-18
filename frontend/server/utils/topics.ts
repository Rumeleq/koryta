import type { Firestore } from "firebase-admin/firestore";
import { pageIsPublic } from "~~/shared/model";
import type { Edge } from "~~/shared/model";

/** Firestore's cap on the values in an `in` or `array-contains-any` filter. */
const ANY_CHUNK = 30;

/** The articles tagged into a story.
 *
 * `tagged` edges point article → topic, so this is one equality query. Drafts
 * are included for a signed in caller, which is what lets somebody see the
 * story they are still assembling; for everyone else only what a reviewer has
 * approved.
 */
export async function articleIdsForTopic(
  db: Firestore,
  topicId: string,
  includeDrafts: boolean,
): Promise<string[]> {
  const snapshot = await db
    .collection("edges")
    .where("target", "==", topicId)
    .where("type", "==", "tagged")
    .get();

  const ids = new Set<string>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.deleted === true) continue;
    if (!includeDrafts && !pageIsPublic(data)) continue;
    if (typeof data.source === "string") ids.add(data.source);
  }
  return Array.from(ids);
}

/** Every relation citing any of these articles.
 *
 * This is the step that turns a pile of articles into a graph: an article is
 * not itself a connection between people, it is the evidence for one, and
 * `Edge.references` is where that evidence is recorded.
 *
 * `array-contains-any` takes 30 values, so a story with more articles than that
 * is asked for in several passes and the results merged by edge id - the same
 * shape `fetchEdgesClose` uses for its `in` queries, and for the same limit.
 */
export async function edgesCitingArticles(
  db: Firestore,
  articleIds: string[],
  includeDrafts: boolean,
): Promise<(Edge & { id: string })[]> {
  if (articleIds.length === 0) return [];

  const found = new Map<string, Edge & { id: string }>();
  for (let i = 0; i < articleIds.length; i += ANY_CHUNK) {
    const chunk = articleIds.slice(i, i + ANY_CHUNK);
    const snapshot = await db
      .collection("edges")
      .where("references", "array-contains-any", chunk)
      .get();

    for (const doc of snapshot.docs) {
      if (found.has(doc.id)) continue;
      const data = doc.data() as Edge;
      if (data.deleted === true) continue;
      if (!includeDrafts && !pageIsPublic(data)) continue;
      found.set(doc.id, { ...data, id: doc.id });
    }
  }
  return Array.from(found.values());
}

/** Who these articles name.
 *
 * `mentions` is stored with the article at either end - the article page and
 * `useEdgeTypes.ts` write article -> person, `ingest/person.post.ts` writes
 * person -> article - so both directions are asked for and the far end is
 * whichever one is not an article we asked about.
 *
 * The edges themselves are not returned. An article is not drawn in these
 * graphs, so an edge with one end on it has nowhere to land; what it
 * contributes is the person, who belongs in the story whether or not anybody
 * has yet drawn a relation from them.
 */
export async function nodesMentionedByArticles(
  db: Firestore,
  articleIds: string[],
  includeDrafts: boolean,
): Promise<string[]> {
  if (articleIds.length === 0) return [];

  const articles = new Set(articleIds);
  const found = new Set<string>();
  for (let i = 0; i < articleIds.length; i += ANY_CHUNK) {
    const chunk = articleIds.slice(i, i + ANY_CHUNK);
    // No `type` filter in the query: that would want a composite index on
    // (source, type), and an article has few enough edges that filtering the
    // handful that come back is cheaper than adding one.
    const snapshots = await Promise.all([
      db.collection("edges").where("source", "in", chunk).get(),
      db.collection("edges").where("target", "in", chunk).get(),
    ]);

    for (const snapshot of snapshots) {
      for (const doc of snapshot.docs) {
        const data = doc.data() as Edge;
        if (data.type !== "mentions") continue;
        if (data.deleted === true) continue;
        if (!includeDrafts && !pageIsPublic(data)) continue;
        const far = articles.has(data.source) ? data.target : data.source;
        if (typeof far === "string" && !articles.has(far)) found.add(far);
      }
    }
  }
  return Array.from(found);
}
