import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, getValidatedQuery, setResponseHeader } from "h3";
import { getUser } from "~~/server/utils/auth";
import { describeRevisions } from "~~/server/utils/revisionQueue";
import {
  emptyProposalCounts,
  matchesStoredStatus,
  type Proposal,
  type ProposalCounts,
} from "~~/shared/proposals";

const queryValidator = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  page: z.coerce.number().int().min(1).default(1),
  status: z.enum(["pending", "approved", "rejected", "all"]).default("all"),
});

/** How far back one person's own record is read. The largest human revision
 * count in production is 94 and the whole human corpus is 1,814 across ten
 * uids, so this covers every real contributor with room to spare while capping
 * what a pipeline account could pull by opening its profile. */
export const MINE_SCAN_CAP = 300;

export type MyProposals = {
  revisions: Proposal[];
  /** The status-filtered set, which is what paging walks through. */
  total: number;
  /** Over everything scanned, before the status filter and before the page
   * slice, so the chips do not move while the reader pages. */
  counts: ProposalCounts;
  truncated: boolean;
};

/**
 * What the signed-in user proposed, and what came of it.
 *
 * The uid comes from the verified token and there is no parameter for it, so
 * this cannot be turned into a way to read somebody else's record. Authors are
 * not resolved: the caller is the author, and the reviewing side is `redakcja`
 * here as it is in the notification emails - a contributor does not learn which
 * individual turned them down.
 *
 * `update_automatic !== true` is applied in memory rather than as a `where`,
 * for the same reason `/api/revisions/queue` does it on its per-author path:
 * 1,760 revisions carry no flag at all, and those are exactly the older history
 * a person's own record has to include. One scan on the composite index
 * `(update_user, update_time)`, which already exists.
 */
export default defineEventHandler(async (event): Promise<MyProposals> => {
  const user = await getUser(event);
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const db = getFirestore("koryta-pl");

  setResponseHeader(event, "Cache-Control", "private, no-store");

  const snapshot = await db
    .collection("revisions")
    .where("update_user", "==", user.uid)
    .orderBy("update_time", "desc")
    .limit(MINE_SCAN_CAP)
    .get();

  const mine = snapshot.docs.filter(
    (doc) => doc.get("update_automatic") !== true,
  );

  const described = await describeRevisions(db, mine, { withAuthors: false });

  const counts = described.reduce<ProposalCounts>((acc, row) => {
    acc[row.status] += 1;
    return acc;
  }, emptyProposalCounts());

  const matching = described.filter((row) =>
    matchesStoredStatus(row.status, query.status),
  );
  const offset = (query.page - 1) * query.limit;

  return {
    revisions: matching.slice(offset, offset + query.limit),
    total: matching.length,
    counts,
    truncated: snapshot.size >= MINE_SCAN_CAP,
  };
});
