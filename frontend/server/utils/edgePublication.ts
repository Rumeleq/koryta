import type {
  Firestore,
  DocumentReference,
  WriteBatch,
} from "firebase-admin/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Edge, Revision } from "~~/shared/model";
import {
  approvedRevisionId,
  pageIsPublic,
  revisionIsPending,
} from "~~/shared/model";
import { recordAudit } from "~~/server/utils/audit";

/** What an edge needs before it can be shown to the public.
 *
 * An edge is a claim about two pages, so publishing it publishes a statement
 * about both. Where one of them is still a draft the claim points at a page
 * nobody can open, which is why `publishable` is the conjunction rather than
 * the edge's own state alone.
 */
export interface EdgeEndpoints {
  id: string;
  source: string;
  target: string;
  sourceName: string | null;
  targetName: string | null;
  sourcePublished: boolean;
  targetPublished: boolean;
  /** Whether both ends are live, and so whether this edge may be published. */
  publishable: boolean;
  /** The end that is holding it back, for a message that says which. */
  blockedBy: { id: string; name: string | null }[];
}

/** The state of every node an edge in `edges` touches, in one round trip per
 * 100 ids.
 *
 * Firestore has no join, so the endpoints have to be read separately whatever
 * we do; what it does have is `getAll`, which the node fetch path already
 * chunks at 100 (see `fetchNodesByIds`). Resolving the whole batch at once is
 * what keeps the admin views off an N+1.
 */
export async function resolveEdgeEndpoints(
  db: Firestore,
  edges: Pick<Edge, "id" | "source" | "target">[],
): Promise<Map<string, EdgeEndpoints>> {
  const nodeIds = new Set<string>();
  for (const edge of edges) {
    if (edge.source) nodeIds.add(edge.source);
    if (edge.target) nodeIds.add(edge.target);
  }

  const nodes = new Map<string, { name: string | null; published: boolean }>();
  const ids = Array.from(nodeIds);
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const refs = chunk.map((id) => db.collection("nodes").doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      const data = snap.data();
      nodes.set(snap.id, {
        name: typeof data?.name === "string" ? data.name : null,
        // A node that was never created is not published, which is the answer
        // that keeps a dangling edge out of the public graph.
        published: snap.exists ? pageIsPublic(data ?? {}) : false,
      });
    }
  }

  const result = new Map<string, EdgeEndpoints>();
  for (const edge of edges) {
    if (!edge.id) continue;
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    const sourcePublished = source?.published === true;
    const targetPublished = target?.published === true;
    const blockedBy: { id: string; name: string | null }[] = [];
    if (!sourcePublished) {
      blockedBy.push({ id: edge.source, name: source?.name ?? null });
    }
    if (!targetPublished && edge.target !== edge.source) {
      blockedBy.push({ id: edge.target, name: target?.name ?? null });
    }

    result.set(edge.id, {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceName: source?.name ?? null,
      targetName: target?.name ?? null,
      sourcePublished,
      targetPublished,
      publishable: sourcePublished && targetPublished,
      blockedBy,
    });
  }
  return result;
}

/** Every revision written against `edgeId`, newest first.
 *
 * Edge revisions carry the edge's id in `node_id` - the field is named after
 * the collection it was invented for, not after what it holds - so this is the
 * same query the node review page runs, pointed at the other collection.
 */
export async function edgeRevisions(
  db: Firestore,
  edgeId: string,
): Promise<(Revision & { id: string })[]> {
  const snap = await db
    .collection("revisions")
    .where("node_id", "==", edgeId)
    .get();

  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Revision) }))
    .sort((a, b) => revisionTime(b) - revisionTime(a));
}

/** Revisions are timestamped by three different writers, so `update_time` is a
 * Firestore Timestamp, an ISO string or missing depending on its age. */
function revisionTime(revision: Revision): number {
  const value = revision.update_time as unknown;
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "string") return Date.parse(value) || 0;
  if (value && typeof value === "object" && "_seconds" in value) {
    return (value as { _seconds: number })._seconds * 1000;
  }
  return 0;
}

/** The newest revision still waiting for a verdict, if there is one. */
export function newestPendingRevision(
  revisions: (Revision & { id: string })[],
): (Revision & { id: string }) | undefined {
  return revisions.find((revision) => revisionIsPending(revision));
}

/** Publishes one edge, and settles its outstanding proposal while it is there.
 *
 * Publishing a relation *is* the review of it: the reviewer looked at the claim
 * and decided the public should see it. Leaving its revision on "pending" would
 * mean the queue still shows work on an edge that is already live, so an edge
 * with nothing approved yet has its newest proposal approved in the same
 * commit. An edge that predates the revision machinery has neither pointer nor
 * proposal, and is published on the strength of the document itself - refusing
 * would hide relations that were never written through a revision at all.
 *
 * Writes into `batch`; the caller decides how many edges share a commit.
 */
export function publishEdgeInBatch(
  db: Firestore,
  batch: WriteBatch,
  edgeRef: DocumentReference,
  stored: Record<string, unknown>,
  pending: (Revision & { id: string }) | undefined,
  user: { uid: string },
): { approvedRevision: string | null } {
  const update: Record<string, unknown> = { published: true };
  let approvedRevision: string | null = null;

  if (!approvedRevisionId(stored.revision_id) && pending) {
    const revisionRef = db.collection("revisions").doc(pending.id);
    const timestamp = Timestamp.now();
    batch.update(revisionRef, {
      status: "approved",
      review_user: user.uid,
      review_time: timestamp,
      reject_reason: FieldValue.delete(),
    });
    update.revision_id = revisionRef;
    approvedRevision = pending.id;
    recordAudit(
      db,
      {
        action: "approve",
        collection: "edges",
        target_id: edgeRef.id,
        revision_id: pending.id,
        user: user.uid,
      },
      batch,
    );
  }

  // `update`, not `set`: unlike applying a revision this changes who may see
  // the edge, not what it says, and the stored document already holds the
  // approved snapshot. A full overwrite here would drop `votes` and `stats`.
  batch.update(edgeRef, update);
  recordAudit(
    db,
    {
      action: "publish",
      collection: "edges",
      target_id: edgeRef.id,
      ...(approvedRevision ? { revision_id: approvedRevision } : {}),
      user: user.uid,
    },
    batch,
  );

  return { approvedRevision };
}

/** Hides one edge. The proposal it was published from is left alone - taking a
 * relation off the site says nothing about whether the claim was right. */
export function unpublishEdgeInBatch(
  db: Firestore,
  batch: WriteBatch,
  edgeRef: DocumentReference,
  user: { uid: string },
): void {
  batch.update(edgeRef, { published: false });
  recordAudit(
    db,
    {
      action: "unpublish",
      collection: "edges",
      target_id: edgeRef.id,
      user: user.uid,
    },
    batch,
  );
}

/** Every edge with `nodeId` at either end. */
export async function fetchEdgesForNode(
  db: Firestore,
  nodeId: string,
): Promise<(Edge & { id: string })[]> {
  const [bySource, byTarget] = await Promise.all([
    db.collection("edges").where("source", "==", nodeId).get(),
    db.collection("edges").where("target", "==", nodeId).get(),
  ]);

  // A self-edge comes back from both queries.
  const edges = new Map<string, Edge & { id: string }>();
  for (const doc of [...bySource.docs, ...byTarget.docs]) {
    if (!edges.has(doc.id)) {
      edges.set(doc.id, { id: doc.id, ...(doc.data() as Edge) });
    }
  }
  return Array.from(edges.values());
}

/** How many edges share one commit.
 *
 * Each edge costs an update plus an audit row, and approving its proposal adds
 * two more, so 100 edges stay under Firestore's 500-write batch limit in the
 * worst case.
 */
export const EDGE_PUBLISH_CHUNK = 100;

/** Takes every published edge of a node off the site, because the node is
 * going off it.
 *
 * The rule that no edge outlives its endpoints has to hold in this direction
 * too. Nothing a reader sees changes - the graph endpoint already drops an edge
 * whose node was filtered out - but the flag would otherwise survive the node
 * being hidden, and republishing the node months later would bring back
 * relations nobody reviewed in the meantime.
 *
 * Returns the ids it hid, for the caller's audit trail and response.
 */
export async function cascadeUnpublishEdges(
  db: Firestore,
  nodeId: string,
  user: { uid: string },
): Promise<string[]> {
  const edges = await fetchEdgesForNode(db, nodeId);
  const live = edges.filter((edge) => pageIsPublic(edge));
  if (live.length === 0) return [];

  for (let i = 0; i < live.length; i += EDGE_PUBLISH_CHUNK) {
    const chunk = live.slice(i, i + EDGE_PUBLISH_CHUNK);
    const batch = db.batch();
    for (const edge of chunk) {
      unpublishEdgeInBatch(
        db,
        batch,
        db.collection("edges").doc(edge.id),
        user,
      );
    }
    await batch.commit();
  }

  console.info(
    `Unpublished ${live.length} edge(s) alongside node=${nodeId} by=${user.uid}`,
  );
  return live.map((edge) => edge.id);
}
