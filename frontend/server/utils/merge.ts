import type {
  DocumentSnapshot,
  Firestore,
  WriteBatch,
} from "firebase-admin/firestore";
import { edgeIdentity, edgeSemantics, type EdgeLike } from "./edges";
import { createRevisionTransaction, withoutInternalFields } from "./revisions";
import { recordAudit } from "./audit";

/** What becomes of one relation when the page it hangs off is merged away.
 *
 * - `moved`: the survivor does not say this, so the relation is re-pointed at
 *   it and kept. The ordinary case.
 * - `collapsed`: the survivor already says exactly this, and the edge type is
 *   one where saying it twice asserts nothing new. Removed.
 * - `review`: the survivor already says exactly this, and the type is one where
 *   identical fields are *not* evidence of one fact. Kept, and reported - see
 *   `identicalMeansSame` in `server/utils/edges.ts`, which is the same
 *   judgement `scripts/migrate/dedupe-edges.ts` makes.
 * - `self`: both ends were the duplicate, so the merge would leave the survivor
 *   pointing at itself. Removed; a loop is not a fact about anybody.
 */
export type MergeDisposition = "moved" | "collapsed" | "review" | "self";

export type MergeEdgePlan = {
  edge_id: string;
  type: string;
  disposition: MergeDisposition;
  /** Which end of the relation named the duplicate. */
  role: "source" | "target" | "both";
  /** The survivor's relation that already says this, for a `collapsed` or
   * `review` verdict. */
  duplicate_of?: string;
};

export type MergePlan = {
  duplicate_id: string;
  survivor_id: string;
  /** Both names, for a dry run to print something a human can check. */
  duplicate_name?: string;
  survivor_name?: string;
  edges: MergeEdgePlan[];
  counts: Record<MergeDisposition, number>;
};

/** How far `merged_into` is followed before the data is called broken.
 *
 * Merges are resolved on the way in, so a chain should never form. This is what
 * stops a cycle - two pages merged into each other by two admins racing - from
 * hanging a page load rather than failing it.
 */
const MAX_MERGE_HOPS = 8;

/** The page a reader should end up on, following `merged_into` to the end.
 *
 * Returns the id it was given when the page is not a duplicate, which is the
 * usual answer and costs one read.
 */
export async function resolveMergedNode(
  db: Firestore,
  id: string,
): Promise<{ id: string; snapshot: DocumentSnapshot | undefined }> {
  let current = id;
  const seen = new Set<string>([id]);

  for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
    const snapshot = await db.collection("nodes").doc(current).get();
    if (!snapshot.exists) return { id: current, snapshot: undefined };

    const next = snapshot.data()?.merged_into;
    if (typeof next !== "string" || !next) return { id: current, snapshot };

    // A cycle is a bug in whatever wrote the second pointer, and the page it
    // was reached from is still a better answer than a hang.
    if (seen.has(next)) return { id: current, snapshot };
    seen.add(next);
    current = next;
  }

  const snapshot = await db.collection("nodes").doc(current).get();
  return { id: current, snapshot: snapshot.exists ? snapshot : undefined };
}

/** Every relation with the given node at either end. */
export async function edgesTouching(db: Firestore, nodeId: string) {
  const [asSource, asTarget] = await Promise.all([
    db.collection("edges").where("source", "==", nodeId).get(),
    db.collection("edges").where("target", "==", nodeId).get(),
  ]);

  const byId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const doc of [...asSource.docs, ...asTarget.docs]) byId.set(doc.id, doc);
  return [...byId.values()];
}

/** The relation as it would read once the duplicate's id is replaced. */
function remapped(
  stored: Record<string, unknown>,
  duplicateId: string,
  survivorId: string,
): EdgeLike {
  return {
    ...stored,
    source: stored.source === duplicateId ? survivorId : stored.source,
    target: stored.target === duplicateId ? survivorId : stored.target,
  } as EdgeLike;
}

/** Where each of `moving` ends up once its `fromId` end reads `toId` instead.
 *
 * Pure, and shared by the merge and the split: both are the same question -
 * this relation is about to name a different page, does that page already say
 * it - and answering it two ways would let a merge remove what a split had just
 * decided to keep.
 *
 * `destination` is every relation the receiving page already holds, so the
 * count of what it says is the count this reasons against.
 */
export function planEdgeMoves(
  moving: FirebaseFirestore.QueryDocumentSnapshot[],
  destination: FirebaseFirestore.QueryDocumentSnapshot[],
  fromId: string,
  toId: string,
): MergeEdgePlan[] {
  // How many times the receiving page already asserts each thing. An occurrence
  // type may legitimately assert one twice, so this counts rather than just
  // records.
  const held = new Map<string, string[]>();
  for (const doc of destination) {
    const stored = doc.data();
    if (stored.deleted === true) continue;
    const identity = edgeIdentity(stored as EdgeLike);
    held.set(identity, [...(held.get(identity) ?? []), doc.id]);
  }

  const edges: MergeEdgePlan[] = [];
  // Sorted so a dry run predicts the run that follows it, the way
  // `findEdgeMatches` sorts for the same reason.
  for (const doc of [...moving].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    const stored = doc.data();
    if (stored.deleted === true) continue;

    const role: MergeEdgePlan["role"] =
      stored.source === fromId && stored.target === fromId
        ? "both"
        : stored.source === fromId
          ? "source"
          : "target";

    const next = remapped(stored, fromId, toId);
    const type = String(stored.type);

    if (next.source === next.target) {
      edges.push({ edge_id: doc.id, type, role, disposition: "self" });
      continue;
    }

    const identity = edgeIdentity(next);
    const alreadySaid = held.get(identity) ?? [];

    if (alreadySaid.length > 0) {
      const { identicalMeansSame } = edgeSemantics(next.type);
      const duplicate_of = alreadySaid[0];
      if (identicalMeansSame) {
        edges.push({
          edge_id: doc.id,
          type,
          role,
          disposition: "collapsed",
          duplicate_of,
        });
        continue;
      }
      // Kept, and counted as held: two of the moving page's candidacies that
      // look alike are still two, and only the first of them is worth
      // reporting against the receiving page's one.
      held.set(identity, [...alreadySaid, doc.id]);
      edges.push({
        edge_id: doc.id,
        type,
        role,
        disposition: "review",
        duplicate_of,
      });
      continue;
    }

    held.set(identity, [doc.id]);
    edges.push({ edge_id: doc.id, type, role, disposition: "moved" });
  }

  return edges;
}

/** How many of each verdict a plan reached. */
export function countDispositions(
  edges: MergeEdgePlan[],
): Record<MergeDisposition, number> {
  const counts: Record<MergeDisposition, number> = {
    moved: 0,
    collapsed: 0,
    review: 0,
    self: 0,
  };
  for (const edge of edges) counts[edge.disposition]++;
  return counts;
}

/** What merging `duplicateId` into `survivorId` would do, without doing it.
 *
 * Split from the write so the same reasoning backs the endpoint, its dry run
 * and the one-off migration - a merge is not a thing to work out twice.
 *
 * A relation removed earlier (`deleted`) is left where it is: it asserts
 * nothing, so moving it would only add a second dead copy to the survivor, and
 * the reason it was removed was recorded against the page it was removed from.
 */
export async function planNodeMerge(
  db: Firestore,
  duplicateId: string,
  survivorId: string,
): Promise<MergePlan> {
  const [duplicateDoc, survivorDoc] = await db.getAll(
    db.collection("nodes").doc(duplicateId),
    db.collection("nodes").doc(survivorId),
  );

  const [duplicateEdges, survivorEdges] = await Promise.all([
    edgesTouching(db, duplicateId),
    edgesTouching(db, survivorId),
  ]);

  const edges = planEdgeMoves(
    duplicateEdges,
    survivorEdges,
    duplicateId,
    survivorId,
  );

  return {
    duplicate_id: duplicateId,
    survivor_id: survivorId,
    duplicate_name: duplicateDoc?.data()?.name as string | undefined,
    survivor_name: survivorDoc?.data()?.name as string | undefined,
    edges,
    counts: countDispositions(edges),
  };
}

/** Why a merge cannot be made, or nothing. */
export function mergeRefusal(
  plan: { duplicate_id: string; survivor_id: string },
  duplicate: DocumentSnapshot | undefined,
  survivor: DocumentSnapshot | undefined,
): string | undefined {
  if (plan.duplicate_id === plan.survivor_id) {
    return "Nie można scalić strony z nią samą.";
  }
  if (!duplicate?.exists) {
    return `Nie ma strony o id: ${plan.duplicate_id}`;
  }
  if (!survivor?.exists) {
    return `Nie ma strony o id: ${plan.survivor_id}`;
  }

  const duplicateData = duplicate.data() ?? {};
  const survivorData = survivor.data() ?? {};

  if (duplicateData.type !== survivorData.type) {
    return (
      `Strony są różnego rodzaju: ${duplicateData.type} i ` +
      `${survivorData.type}. Scalać można tylko strony tego samego rodzaju.`
    );
  }
  if (typeof duplicateData.merged_into === "string") {
    return `Strona ${plan.duplicate_id} została już scalona z ${duplicateData.merged_into}.`;
  }
  return undefined;
}

/** Carry out the plan: move the relations, then put the duplicate to rest.
 *
 * A moved relation is updated in place rather than rewritten at the document id
 * its new ends would hash to. `findEdgeMatches` looks an edge up by
 * `(source, target, type)` and not by id, so a stale id costs nothing: the next
 * ingest still finds the relation and reuses it. Rewriting it would cost the
 * revisions filed against the old id, which are the only record of who said
 * this and when.
 *
 * A collapsed relation is soft-deleted with a revision, exactly as
 * `/api/edges/delete` removes one - the reason it went is worth keeping, and it
 * is the half of the merge most likely to have been wrong.
 */
export function applyNodeMerge(
  db: Firestore,
  batch: WriteBatch,
  user: { uid: string },
  plan: MergePlan,
  reason: string,
  storedEdges: Map<string, Record<string, unknown>>,
): void {
  const moved: string[] = [];
  const collapsed: string[] = [];

  for (const edge of plan.edges) {
    const edgeRef = db.collection("edges").doc(edge.edge_id);
    const stored = storedEdges.get(edge.edge_id);
    if (!stored) continue;

    if (edge.disposition === "moved" || edge.disposition === "review") {
      const update: Record<string, string> = {};
      if (stored.source === plan.duplicate_id) update.source = plan.survivor_id;
      if (stored.target === plan.duplicate_id) update.target = plan.survivor_id;
      batch.update(edgeRef, update);
      moved.push(edge.edge_id);
      continue;
    }

    // `deleted` and `delete_reason` are withheld from `stored` so this revision
    // is the one that states them; carrying them back would undo the removal on
    // the way out. Same reasoning as /api/edges/delete.
    const {
      deleted: _wasDeleted,
      delete_reason: _oldReason,
      ...carried
    } = stored;
    createRevisionTransaction(
      db,
      batch,
      user,
      edgeRef,
      {
        ...withoutInternalFields(stored),
        deleted: true,
        delete_reason:
          edge.disposition === "self"
            ? `Scalenie stron: powiązanie prowadziło samo do siebie. ${reason}`
            : `Scalenie stron: to samo mówi już powiązanie ${edge.duplicate_of}. ${reason}`,
      },
      // An admin merging two pages *is* the review of what the merge removes.
      { stored: carried, approve: true, published: false },
    );
    collapsed.push(edge.edge_id);
  }

  // The duplicate keeps its document, and keeps pointing at the survivor. Its
  // url still resolves, its votes and revisions still have something to hang
  // off, and `pageIsPublic` already reads `deleted` - so it leaves the public
  // site on the next read without anything else learning a new rule.
  const duplicateRef = db.collection("nodes").doc(plan.duplicate_id);
  batch.update(duplicateRef, {
    deleted: true,
    delete_reason: reason,
    merged_into: plan.survivor_id,
    published: false,
  });

  recordAudit(
    db,
    {
      action: "merge",
      collection: "nodes",
      target_id: plan.duplicate_id,
      user: user.uid,
      reason,
      merge: { into: plan.survivor_id, moved, collapsed },
    },
    batch,
  );
}
