import type { ExtractionFact } from "~~/shared/model";

/** A Firestore extraction document as the shared model has it: `createdAt` is
 * stored as a Timestamp but travels as an ISO string, and the review state is
 * read off the vote aggregate the `onVoteWritten` trigger keeps on the
 * document — so it costs no read of the votes collection. */
export function toExtractionFact(
  doc: FirebaseFirestore.DocumentSnapshot,
): ExtractionFact {
  const { createdAt, stats, ...data } = doc.data() ?? {};
  return {
    id: doc.id,
    ...data,
    stats,
    createdAt: createdAt?.toDate?.().toISOString() ?? createdAt,
    // One reviewer per fact: a human (not the pipeline) has judged this one.
    reviewed: stats?.votes?.humanVoted === true,
  } as ExtractionFact;
}
