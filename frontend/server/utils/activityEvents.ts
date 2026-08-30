import type { Firestore, Query } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import type { ActivityKind } from "~~/shared/activity";
import { normalizeUpdateTime } from "~~/shared/revisions";
import type { ActivityEvent } from "~~/server/utils/activityStats";

/** Per-collection ceiling on how many documents one scan may pull.
 *
 * Scans are bounded by a date, not by volume, so a busy quarter or a runaway
 * import could otherwise turn one page view into a full-collection scan. When a
 * scan hits the cap its kind is reported as truncated rather than quietly
 * short — the page says so instead of drawing a dip that never happened. */
const SCAN_CAP = 20_000;

export type CollectedEvents = {
  events: ActivityEvent[];
  /** Kinds whose scan hit `SCAN_CAP`, so their counts are a lower bound. */
  truncated: ActivityKind[];
};

/** The half-open instant range a scan covers: `[since, until)`.
 *
 * `until` is what lets one day be read on its own, which is what the daily
 * rollup in `activityRollup.ts` is built out of. Leaving it off reads everything
 * from `since` to now, which is what a live read of the current day wants — it
 * has no end yet.
 */
export type EventWindow = {
  sinceIso: string;
  /** Exclusive. Omit for "up to now". */
  untilIso?: string;
};

/** Applies the window to a query on `field`.
 *
 * Both bounds are on the same field, so this stays a single-field range scan
 * and needs no composite index — which is the reason every collection is read
 * on one timestamp rather than on a filter plus a date.
 */
function windowed(
  query: Query,
  field: string,
  window: EventWindow,
  asTimestamp = false,
): Query {
  const value = (iso: string) =>
    asTimestamp ? Timestamp.fromDate(new Date(iso)) : iso;

  let scoped = query.where(field, ">=", value(window.sinceIso));
  if (window.untilIso) {
    scoped = scoped.where(field, "<", value(window.untilIso));
  }
  return scoped.orderBy(field, "desc");
}

/** Read every human interaction recorded inside `window`, from each of the
 * collections that records one, and flatten them into a single event list.
 *
 * The five reads are independent, so they run together; each is a range scan
 * on a single field, which Firestore indexes without a composite. */
export async function collectActivityEvents(
  db: Firestore,
  window: EventWindow,
): Promise<CollectedEvents> {
  const [votes, notes, revisions, comments, decisions] = await Promise.all([
    collectVotes(db, window),
    collectNoteSources(db, window),
    collectRevisions(db, window),
    collectComments(db, window),
    collectAdminDecisions(db, window),
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

/** What an administrator settled: pages made public, and everything else.
 *
 * Read from `audit` rather than from `review_user` on the revisions: that field
 * is overwritten by the next verdict, so counting it would lose every decision
 * an admin later revisited - which is exactly the history worth showing. It
 * also cannot see a publication, which touches no revision at all.
 *
 * This does not double-count against `revision`: that kind counts a change
 * being *proposed* (`update_time`), and this one counts it being settled.
 *
 * **One click is one event.** Publishing a person publishes their relations
 * with them, and `publishEdgeInBatch` files an `approve` and a `publish` per
 * edge - so one person with a dozen relations left twenty-five rows here and
 * twenty-five marks on the chart. Hiding a page cascades the same way through
 * `cascadeUnpublishEdges`, and /admin/krawedzie publishes a whole selection at
 * once. The rows are the audit trail doing its job and they stay in the
 * collection; what they are not is twenty-five decisions.
 *
 * They cannot be told apart one row at a time - `applyRevision` files exactly
 * the same `{approve, edges}` row for a single proposal somebody reviewed by
 * hand, and dropping edge rows wholesale would score that as nothing. What does
 * tell them apart is the clock: a cascade writes its rows inside one commit,
 * microseconds apart, and a person cannot make two separate decisions in the
 * same second. So rows are folded together per (who, what, which collection,
 * second). A bulk publish of fifty relations becomes one event; fifty proposals
 * reviewed one at a time over an afternoon stay fifty.
 *
 * The fold is deliberately coarse in one direction only: a batch that happens to
 * straddle a second boundary counts twice instead of once, which is the right
 * way round to be wrong.
 *
 * What survives is then split in two, because the two answer different
 * questions. `publication` is a page reaching the public, which is the outcome
 * the whole review pipeline exists to produce and the number worth watching.
 * `adminDecision` is the rest of the queue work - approving, rejecting, hiding,
 * removing - which says how much reviewing is happening, not how much of it
 * landed.
 */
async function collectAdminDecisions(
  db: Firestore,
  window: EventWindow,
): Promise<CollectedEvents> {
  const snap = await windowed(db.collection("audit"), "at", window)
    .select("user", "at", "action", "collection")
    .limit(SCAN_CAP)
    .get();

  const events: ActivityEvent[] = [];
  const seen = new Set<string>();
  for (const doc of snap.docs) {
    const uid = doc.get("user");
    const at = doc.get("at");
    if (typeof uid !== "string" || typeof at !== "string") continue;

    const action = doc.get("action");
    const collection = doc.get("collection");

    // Second precision: `at` is `recordAudit`'s ISO instant, so cutting the
    // milliseconds off is what collapses one commit into one decision.
    const commit = `${uid}|${String(action)}|${String(collection)}|${at.slice(0, 19)}`;
    if (seen.has(commit)) continue;
    seen.add(commit);

    events.push({
      uid,
      at,
      kind:
        action === "publish" && collection === "nodes"
          ? "publication"
          : "adminDecision",
    });
  }

  const truncated: ActivityKind[] =
    snap.size >= SCAN_CAP ? ["adminDecision", "publication"] : [];
  return { events, truncated };
}

/** A vote document is one per (target, voter), merged in place, so `updatedAt`
 * is the last time that voter touched that target rather than the moment of
 * any single click. Which id field is set is the only thing telling a rating of
 * a person apart from a rating of an extracted fact. */
async function collectVotes(
  db: Firestore,
  window: EventWindow,
): Promise<CollectedEvents> {
  const snap = await windowed(db.collection("votes"), "updatedAt", window)
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
 * and never edited has no `updatedAt` at all.
 *
 * **And both of the two types they are stored in**, which is why this column
 * was reading a small fraction of the truth. `saveNote` stamps with
 * `serverTimestamp()` — deliberately, so one contributor's wrong clock cannot
 * pin their note to the top of the admin queue — and it has done since about
 * 2026-08-02; before that the field held an ISO string. Firestore orders values
 * by type before it orders them by value, so one range bound can only ever
 * match one of the two, and a scan bounded by a string skipped every note
 * written since the changeover. In the export of 2026-08-30 that is 173 notes
 * carrying 254 sources unseen, against the 16 notes and 18 sources the string
 * bound did find inside a 30-day window.
 *
 * So each field is asked for twice, once per type, and the four results are
 * folded by document id the way the two already were. The mixture is not
 * permanent — the last string-dated note is from 2026-08-01, so it falls out of
 * even the 90-day window during October — but until then dropping either half
 * loses real entries. `normalizeUpdateTime` reads both back the same way.
 *
 * Notes are the one kind here that is not append-only, which is also why the
 * daily rollup does not trust a day until it has settled — see
 * `SETTLE_HOURS` in `activityRollup.ts`. */
async function collectNoteSources(
  db: Firestore,
  window: EventWindow,
): Promise<CollectedEvents> {
  const fields = ["userUid", "createdAt", "updatedAt", "sources"] as const;
  const scan = (field: string, asTimestamp: boolean) =>
    windowed(db.collection("notes"), field, window, asTimestamp)
      .select(...fields)
      .limit(SCAN_CAP)
      .get();

  const snapshots = await Promise.all([
    scan("createdAt", true),
    scan("updatedAt", true),
    scan("createdAt", false),
    scan("updatedAt", false),
  ]);

  const events: ActivityEvent[] = [];
  const seen = new Set<string>();
  for (const doc of snapshots.flatMap((snapshot) => snapshot.docs)) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);

    const uid = doc.get("userUid");
    const at = normalizeUpdateTime(
      doc.get("updatedAt") ?? doc.get("createdAt"),
    );
    const sources = doc.get("sources");
    if (typeof uid !== "string" || !at) continue;
    const count = Array.isArray(sources) ? sources.length : 0;
    if (count === 0) continue;

    events.push({ uid, at, kind: "noteSource", count });
  }

  const truncated: ActivityKind[] = snapshots.some(
    (snapshot) => snapshot.size >= SCAN_CAP,
  )
    ? ["noteSource"]
    : [];
  return { events, truncated };
}

/** Manually proposed changes.
 *
 * Two kinds of write are dropped here, and they are dropped for the same
 * reason: neither is somebody deciding that the data should say something
 * different.
 *
 * **The ingest's own revisions.** `createRevisionTransaction` now writes
 * `update_automatic` whichever way it goes, but it wrote nothing at all for a
 * human change until 2026-08-21, and 1,760 revisions in production still carry
 * no flag. An absent field therefore still means a human made the change, and
 * the filter has to stay "not true" rather than "equals false" — which is also
 * why it cannot be pushed into the query. `/api/revisions/queue` draws the same
 * line and explains what it costs.
 *
 * **Article nodes the ingest opened for itself.** `ensureArticleNode` writes one
 * revision per page that is crawled, captured from the extension or pasted into
 * /zrodla, and writes it with `update_automatic: false` because the same
 * endpoint serves all three. It is bookkeeping either way: the node is the url,
 * the title and the date lifted off the page, and nothing about it was ever
 * proposed. Counting it as a change is what put the ingest at the top of the
 * ranking - in the 30 days before this was written, 48 of the 51 revisions
 * credited to the busiest contributor were article nodes.
 *
 * The test is not "is this an article" but "was this ever offered for review".
 * `article` is a `proposableNodeType`, so somebody can edit an article's title
 * through the propose-edit dialog like any other page, and that is real work
 * that has to keep counting. `wasNeverProposed` is what separates the two; see
 * it for how each era of the collection is recognised.
 *
 * Reading the type off `data.type` on the revision rather than from the node it
 * points at costs one projected field instead of a lookup per row, and applies
 * to the history as much as to what the ingest writes from here on.
 */
async function collectRevisions(
  db: Firestore,
  window: EventWindow,
): Promise<CollectedEvents> {
  const snap = await windowed(
    db.collection("revisions"),
    "update_time",
    window,
    true,
  )
    .select(
      "update_user",
      "update_time",
      "update_automatic",
      "review_time",
      "status",
      "data.type",
    )
    .limit(SCAN_CAP)
    .get();

  const events: ActivityEvent[] = [];
  for (const doc of snap.docs) {
    if (doc.get("update_automatic") === true) continue;
    const uid = doc.get("update_user");
    const at = normalizeUpdateTime(doc.get("update_time"));
    if (typeof uid !== "string" || !at) continue;
    if (doc.get("data.type") === "article" && wasNeverProposed(doc, at)) {
      continue;
    }
    events.push({ uid, at, kind: "revision" });
  }

  const truncated: ActivityKind[] = snap.size >= SCAN_CAP ? ["revision"] : [];
  return { events, truncated };
}

/** Whether a revision was written straight into the data rather than offered to
 * a reviewer — which is what `ensureArticleNode` does and what a person using
 * the propose-edit dialog never does.
 *
 * Two signatures, one per era of the collection:
 *
 * - **No `status` at all.** `/api/revisions/create` has always written
 *   `status: "pending"` on a human proposal, so a revision without the field
 *   predates it, and every article revision from that era came from the ingest.
 *   All 292 in the export of 2026-07-20 carry exactly four fields — `data`,
 *   `node_id`, `update_time`, `update_user` — and nothing else.
 * - **Approved in its own commit.** `createRevisionTransaction` with
 *   `approve: true` stamps `review_time` from the same variable as
 *   `update_time`, so the two are identical to the nanosecond. A proposal that
 *   a person reviewed was reviewed in a later request and never matches.
 */
function wasNeverProposed(
  doc: { get(field: string): unknown },
  updatedAt: string,
): boolean {
  if (doc.get("status") === undefined) return true;
  return normalizeUpdateTime(doc.get("review_time")) === updatedAt;
}

async function collectComments(
  db: Firestore,
  window: EventWindow,
): Promise<CollectedEvents> {
  const snap = await windowed(db.collection("comments"), "createdAt", window)
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
