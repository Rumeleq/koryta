import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import type { ActivityKind } from "~~/shared/activity";
import { normalizeUpdateTime } from "~~/shared/revisions";
import type { ActivityEvent } from "~~/server/utils/activityStats";

/** Per-collection ceiling on how many documents one window may pull.
 *
 * Windows are bounded by a date, not by volume, so a busy quarter or a runaway
 * import could otherwise turn one page view into a full-collection scan. When a
 * scan hits the cap its kind is reported as truncated rather than quietly
 * short — the page says so instead of drawing a dip that never happened. */
const SCAN_CAP = 20_000;

export type CollectedEvents = {
  events: ActivityEvent[];
  /** Kinds whose scan hit `SCAN_CAP`, so their counts are a lower bound. */
  truncated: ActivityKind[];
};

/** Read every human interaction recorded on or after `sinceIso`, from each of
 * the collections that records one, and flatten them into a single event list.
 *
 * The five reads are independent, so they run together; each is a range scan
 * on a single field, which Firestore indexes without a composite. */
export async function collectActivityEvents(
  db: Firestore,
  sinceIso: string,
): Promise<CollectedEvents> {
  const [votes, notes, revisions, comments, decisions] = await Promise.all([
    collectVotes(db, sinceIso),
    collectNoteSources(db, sinceIso),
    collectRevisions(db, sinceIso),
    collectComments(db, sinceIso),
    collectAdminDecisions(db, sinceIso),
  ]);

  return {
    events: [
      ...votes.events,
      ...notes.events,
      ...revisions.events,
      ...comments.events,
      ...decisions.events,
    ],
    truncated: [
      ...votes.truncated,
      ...notes.truncated,
      ...revisions.truncated,
      ...comments.truncated,
      ...decisions.truncated,
    ],
  };
}

/** Approvals, rejections and changes of visibility.
 *
 * Read from `audit` rather than from `review_user` on the revisions: that field
 * is overwritten by the next verdict, so counting it would lose every decision
 * an admin later revisited - which is exactly the history worth showing. It
 * also cannot see a publication, which touches no revision at all.
 *
 * This does not double-count against `revision`: that kind counts a change
 * being *proposed* (`update_time`), and this one counts it being settled.
 */
async function collectAdminDecisions(
  db: Firestore,
  sinceIso: string,
): Promise<CollectedEvents> {
  const snap = await db
    .collection("audit")
    .where("at", ">=", sinceIso)
    .orderBy("at", "desc")
    .select("user", "at")
    .limit(SCAN_CAP)
    .get();

  const events: ActivityEvent[] = [];
  for (const doc of snap.docs) {
    const uid = doc.get("user");
    const at = doc.get("at");
    if (typeof uid !== "string" || typeof at !== "string") continue;
    events.push({ uid, at, kind: "adminDecision" });
  }

  const truncated: ActivityKind[] =
    snap.size >= SCAN_CAP ? ["adminDecision"] : [];
  return { events, truncated };
}

/** A vote document is one per (target, voter), merged in place, so `updatedAt`
 * is the last time that voter touched that target rather than the moment of
 * any single click. Which id field is set is the only thing telling a rating of
 * a person apart from a rating of an extracted fact. */
async function collectVotes(
  db: Firestore,
  sinceIso: string,
): Promise<CollectedEvents> {
  const snap = await db
    .collection("votes")
    .where("updatedAt", ">=", sinceIso)
    .orderBy("updatedAt", "desc")
    .select("userUid", "updatedAt", "nodeId", "extractionId")
    .limit(SCAN_CAP)
    .get();

  const events: ActivityEvent[] = [];
  for (const doc of snap.docs) {
    const uid = doc.get("userUid");
    const at = doc.get("updatedAt");
    if (typeof uid !== "string" || typeof at !== "string") continue;
    events.push({
      uid,
      at,
      kind: doc.get("extractionId") ? "extractionVote" : "nodeVote",
    });
  }

  const truncated: ActivityKind[] =
    snap.size >= SCAN_CAP ? ["nodeVote", "extractionVote"] : [];
  return { events, truncated };
}

/** Note entries, counted one per source rather than one per document.
 *
 * A note is a single document per (author, node) that gains sources over time,
 * and only the document carries a timestamp — so every source it holds is
 * attributed to the last time its note was written. For a recent window that
 * reads as "entries this person added"; over a long one it drags older sources
 * forward onto the day their note was last edited.
 *
 * Both timestamps have to be queried: a note written long ago and edited
 * yesterday has `createdAt` outside the window, and a note written yesterday
 * and never edited has no `updatedAt` at all. */
async function collectNoteSources(
  db: Firestore,
  sinceIso: string,
): Promise<CollectedEvents> {
  const [created, updated] = await Promise.all([
    db
      .collection("notes")
      .where("createdAt", ">=", sinceIso)
      .orderBy("createdAt", "desc")
      .select("userUid", "createdAt", "updatedAt", "sources")
      .limit(SCAN_CAP)
      .get(),
    db
      .collection("notes")
      .where("updatedAt", ">=", sinceIso)
      .orderBy("updatedAt", "desc")
      .select("userUid", "createdAt", "updatedAt", "sources")
      .limit(SCAN_CAP)
      .get(),
  ]);

  const events: ActivityEvent[] = [];
  const seen = new Set<string>();
  for (const doc of [...created.docs, ...updated.docs]) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);

    const uid = doc.get("userUid");
    const at = doc.get("updatedAt") ?? doc.get("createdAt");
    const sources = doc.get("sources");
    if (typeof uid !== "string" || typeof at !== "string") continue;
    const count = Array.isArray(sources) ? sources.length : 0;
    if (count === 0) continue;

    events.push({ uid, at, kind: "noteSource", count });
  }

  const truncated: ActivityKind[] =
    created.size >= SCAN_CAP || updated.size >= SCAN_CAP ? ["noteSource"] : [];
  return { events, truncated };
}

/** Manually proposed changes.
 *
 * `createRevisionTransaction` now writes `update_automatic` whichever way it
 * goes, but it wrote nothing at all for a human change until 2026-08-21, and
 * 1,760 revisions in production still carry no flag. An absent field therefore
 * still means a human made the change, and the filter has to stay "not true"
 * rather than "equals false" — which is also why it cannot be pushed into the
 * query. `/api/revisions/queue` draws the same line and explains what it costs. */
async function collectRevisions(
  db: Firestore,
  sinceIso: string,
): Promise<CollectedEvents> {
  const snap = await db
    .collection("revisions")
    .where("update_time", ">=", Timestamp.fromDate(new Date(sinceIso)))
    .orderBy("update_time", "desc")
    .select("update_user", "update_time", "update_automatic")
    .limit(SCAN_CAP)
    .get();

  const events: ActivityEvent[] = [];
  for (const doc of snap.docs) {
    if (doc.get("update_automatic") === true) continue;
    const uid = doc.get("update_user");
    const at = normalizeUpdateTime(doc.get("update_time"));
    if (typeof uid !== "string" || !at) continue;
    events.push({ uid, at, kind: "revision" });
  }

  const truncated: ActivityKind[] = snap.size >= SCAN_CAP ? ["revision"] : [];
  return { events, truncated };
}

async function collectComments(
  db: Firestore,
  sinceIso: string,
): Promise<CollectedEvents> {
  const snap = await db
    .collection("comments")
    .where("createdAt", ">=", sinceIso)
    .orderBy("createdAt", "desc")
    .select("authorId", "createdAt")
    .limit(SCAN_CAP)
    .get();

  const events: ActivityEvent[] = [];
  for (const doc of snap.docs) {
    const uid = doc.get("authorId");
    const at = doc.get("createdAt");
    if (typeof uid !== "string" || typeof at !== "string") continue;
    events.push({ uid, at, kind: "comment" });
  }

  const truncated: ActivityKind[] = snap.size >= SCAN_CAP ? ["comment"] : [];
  return { events, truncated };
}
