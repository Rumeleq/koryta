import type { NodeFilterOp } from "~~/server/utils/nodeFilters";

export type ProgressStats = {
  /** People matching the structural filters, regardless of status. */
  total: number;
  /** Published (approved) people. */
  approved: number;
  /** Not published yet, but already looked at: voted on or annotated.
   *
   * Deliberately not "or has a revision waiting for approval". Every person
   * the scrapers ingest arrives as an unapproved revision, so
   * `revisions.has_unapproved` is set on all 5190 unpublished people and on
   * none of the published ones - counting it would restate `toCheck` under a
   * second name. Only 30 of those 5190 have a hand-written latest revision,
   * and telling them apart costs a read of every one of the revisions. If
   * that number is ever wanted, /api/admin/summary already computes it as
   * `unapprovedManual`. */
  reviewed: number;
  /** Not published and untouched by the community. */
  toCheck: number;
  /** People at least one human voted on. */
  withVotes: number;
  /** People with at least one note. */
  withNotes: number;
};

export const ZERO_PROGRESS: ProgressStats = {
  total: 0,
  approved: 0,
  reviewed: 0,
  toCheck: 0,
  withVotes: 0,
  withNotes: 0,
};

/** Counts the six figures in memory, from documents already read. */
export function tallyProgress(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nodes: any[],
): ProgressStats {
  const stats = { ...ZERO_PROGRESS, total: nodes.length };
  for (const node of nodes) {
    const isApproved = node.stats?.isApproved === true;
    const hasVotes = node.stats?.votes?.humanVoted === true;
    const hasNotes = (node.stats?.notesCount ?? 0) > 0;

    if (isApproved) stats.approved++;
    else if (hasVotes || hasNotes) stats.reviewed++;
    else stats.toCheck++;

    if (hasVotes) stats.withVotes++;
    if (hasNotes) stats.withNotes++;
  }
  return stats;
}

type Q = FirebaseFirestore.Query;

const approvedOnly = (query: Q) => query.where("stats.isApproved", "==", true);
const votedOnly = (query: Q) =>
  query.where("stats.votes.humanVoted", "==", true);
const notedOnly = (query: Q) => query.where("stats.notesCount", ">", 0);

async function count(query: Q): Promise<number> {
  return (await query.count().get()).data().count;
}

/** Whether Firestore refused a query for want of an index, rather than
 * failing for a reason that should propagate. Matches how /api/nodes decides
 * to degrade a filter to the in-memory path. */
function isMissingIndex(error: unknown): boolean {
  const { code, message } = (error ?? {}) as {
    code?: number;
    message?: string;
  };
  return code === 9 || !!message?.toLowerCase().includes("index");
}

/**
 * The progress counters from aggregation queries rather than from a scan.
 *
 * Reading every person to count them is what this endpoint used to cost: 6,115
 * documents per cache miss, which over 10-11 August 2026 was 637,122 of the
 * 892,382 reads the whole site made - 71% of them, for six integers. An
 * aggregation is billed per 1,000 index entries it scans instead, so the same
 * six numbers cost about 30 reads.
 *
 * Returns null when the answer cannot be trusted to Firestore - a filter that
 * only runs in memory, or a combination no index covers - and the caller falls
 * back to the scan. That makes an absent index a lost saving rather than a
 * broken endpoint, which matters because the structural filters combine into
 * more shapes than are worth indexing up front.
 *
 * The counts overlap, so four of the eight are intersections: `reviewed` is
 * "not approved, but voted on or annotated", and neither the union nor the
 * negation can be asked of Firestore directly.
 */
export async function countProgress(
  db: FirebaseFirestore.Firestore,
  ops: NodeFilterOp[],
): Promise<ProgressStats | null> {
  let base: Q;
  try {
    base = ops.reduce<Q>(
      (query, op) => op.applyFs(query),
      db.collection("nodes"),
    );
  } catch {
    // memOnly ops throw from applyFs on purpose.
    return null;
  }

  try {
    const [total, approved, withVotes, withNotes, av, an, vn, avn] =
      await Promise.all([
        count(base),
        count(approvedOnly(base)),
        count(votedOnly(base)),
        count(notedOnly(base)),
        count(votedOnly(approvedOnly(base))),
        count(notedOnly(approvedOnly(base))),
        count(notedOnly(votedOnly(base))),
        count(notedOnly(votedOnly(approvedOnly(base)))),
      ]);

    // |V ∪ N| minus the part of it that is already approved.
    const reviewed = withVotes + withNotes - vn - (av + an - avn);

    return {
      total,
      approved,
      reviewed,
      toCheck: total - approved - reviewed,
      withVotes,
      withNotes,
    };
  } catch (error) {
    if (isMissingIndex(error)) return null;
    throw error;
  }
}
