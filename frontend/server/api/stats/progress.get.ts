import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { buildStructuralFilterOps } from "~~/server/utils/nodeFilters";
import {
  countProgress,
  tallyProgress,
  ZERO_PROGRESS,
  type ProgressStats,
} from "~~/server/utils/progressCounts";

const queryValidator = z.object({
  party: z.string().optional(),
  parties: z.union([z.string(), z.array(z.string())]).optional(),
  teryt: z.string().optional(),
  companyTeryt: z.string().optional(),
  krs: z.union([z.string(), z.array(z.string())]).optional(),
  place: z.union([z.string(), z.array(z.string())]).optional(),
  category: z.string().optional(),
  currentlyEmployed: z.enum(["all", "any", "selected"]).optional(),
  minEmploymentDate: z.string().optional(),
  minVotes: z.coerce.number().optional(),
});

export type { ProgressStats };

/** What the counters below read, on top of whatever the filters ask for. */
const COUNTER_FIELDS = [
  "stats.isApproved",
  "stats.votes.humanVoted",
  "stats.notesCount",
];

/** Aggregate tagging-progress counts for the people matching the current
 * table filters. Status filters (visibility, hideVoted) are deliberately not
 * accepted: the response breaks people down by exactly those statuses.
 *
 * The response does not depend on the requesting user, so it is cached
 * briefly and shared, under a key built from the parsed query - see
 * `queryCacheKey`.
 */
export default defineCachedEventHandler(
  async (event): Promise<ProgressStats> => {
    const query = await getValidatedQuery(event, (q) =>
      queryValidator.parse(q),
    );
    const db = getFirestore("koryta-pl");

    const { ops, fields, empty } = await buildStructuralFilterOps(
      db,
      { ...query, type: "person" },
      "all",
    );
    if (empty) return { ...ZERO_PROGRESS };

    // Eight aggregation queries where Firestore can answer them, which is the
    // unfiltered case the explore table and the home page ask for. See
    // countProgress for what it costs and when it declines.
    const counted = await countProgress(db, ops);
    if (counted) return counted;

    // Otherwise fetch all people once and filter in memory: the counts need
    // several overlapping predicates, and the in-memory ops never hit
    // missing-index or multiple-array-filter limits of Firestore queries.
    //
    // Projected down to the leaf fields actually read, because that scan is
    // the whole cost of this endpoint - 6077 documents as of the July 2026
    // export, on every cache miss, for every distinct combination of filters.
    // Asking for the `stats` map whole pulled 4.18 MB; the counters alone are
    // 0.55 MB, and a place filter, which needs the target-id arrays too, 2.0
    // MB. Against the emulator over loopback that was ~600 ms down to ~350;
    // the read count does not change, but the bytes do.
    const snapshot = await db
      .collection("nodes")
      .where("type", "==", "person")
      .select(...new Set([...COUNTER_FIELDS, ...fields]))
      .get();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let nodes: any[] = snapshot.docs.map((doc) => doc.data());
    for (const op of ops) {
      nodes = op.applyMem(nodes);
    }

    return tallyProgress(nodes);
  },
  {
    maxAge: 300,
    swr: true,
    getKey: (event) =>
      validatedQueryCacheKey(event, (q) => queryValidator.parse(q)),
  },
);
