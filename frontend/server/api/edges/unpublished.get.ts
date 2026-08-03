import { getFirestore, FieldPath } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { resolveEdgeEndpoints } from "~~/server/utils/edgePublication";
import type { Edge, EdgeType } from "~~/shared/model";
import { z } from "zod";

export type UnpublishedEdgeRow = {
  id: string;
  type: EdgeType;
  name: string | null;
  sourceId: string;
  sourceName: string | null;
  targetId: string;
  targetName: string | null;
  start_date: string | null;
  end_date: string | null;
};

export type UnpublishedEdges = {
  edges: UnpublishedEdgeRow[];
  /** Where the next page starts. Null once the collection is exhausted. */
  nextCursor: string | null;
  /** How many edge documents were read to fill this page. Shown to the admin
   * because the ratio is the interesting number: a page that cost 2000 reads
   * says most unpublished relations are still waiting on their nodes. */
  scanned: number;
  /** Whether the scan stopped on its own budget rather than on the data. */
  truncated: boolean;
};

const queryValidator = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

/** How many edges to read per round trip while filling a page. */
const SCAN_PAGE = 300;

/** The most documents one request will read. Firestore cannot join, so
 * "unpublished edge between two published nodes" is a scan plus a lookup, and
 * the honest way to bound it is to stop and say so - `truncated` and `scanned`
 * are in the response for exactly that reason.
 */
const MAX_SCAN = 3000;

/** Relations that are ready to go live: not published themselves, but with
 * published pages at both ends.
 *
 * This is the queue the publish rule creates. An edge added next to a draft
 * cannot be published, so it waits; the moment somebody publishes that draft
 * the edge becomes eligible and nothing else would ever tell a reviewer that
 * it had.
 */
export default defineEventHandler(async (event): Promise<UnpublishedEdges> => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  await requireAdmin(event);

  const db = getFirestore(getApp(), "koryta-pl");

  const rows: UnpublishedEdgeRow[] = [];
  let cursor = query.cursor ?? null;
  let scanned = 0;
  let exhausted = false;

  while (rows.length < query.limit && scanned < MAX_SCAN && !exhausted) {
    let q = db
      .collection("edges")
      // An equality filter ordered by document id is served by the automatic
      // single-field index; anything else on `edges` would need a composite
      // index declared, and there are none.
      .where("published", "==", false)
      .orderBy(FieldPath.documentId())
      .limit(SCAN_PAGE);
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    scanned += snap.size;
    if (snap.empty) {
      exhausted = true;
      break;
    }

    const edges = snap.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Edge),
    }));
    const endpoints = await resolveEdgeEndpoints(
      db,
      edges.filter((edge) => edge.source && edge.target),
    );

    // The cursor follows what was *examined*, not what was returned. Filling
    // the page halfway through a batch and then skipping to the end of it
    // would drop every eligible relation behind the break - and silently, so
    // the queue would look complete while holding back work.
    let consumed = 0;
    for (const edge of edges) {
      consumed += 1;
      cursor = edge.id;
      if (edge.deleted === true || !edge.source || !edge.target) continue;

      const state = endpoints.get(edge.id);
      if (state?.publishable !== true) continue;
      rows.push({
        id: edge.id,
        type: edge.type,
        name: typeof edge.name === "string" && edge.name ? edge.name : null,
        sourceId: edge.source,
        sourceName: state.sourceName,
        targetId: edge.target,
        targetName: state.targetName,
        start_date: edge.start_date ?? null,
        end_date: edge.end_date ?? null,
      });
      if (rows.length >= query.limit) break;
    }

    // Only a batch read to its end, and short of what was asked for, means
    // there is nothing behind it.
    if (consumed === snap.size && snap.size < SCAN_PAGE) exhausted = true;
  }

  return {
    edges: rows,
    nextCursor: exhausted ? null : cursor,
    scanned,
    truncated: !exhausted && rows.length < query.limit,
  };
});
