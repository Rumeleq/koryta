import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { pageIsPublic } from "../../shared/model";

/**
 * One-time migration: give every node the counters that make it reachable.
 *
 * `/api/search` orders its hits by `stats.nodeGroupSize`, and Firestore's
 * `orderBy` returns no document that lacks the field it is ordered on. Only
 * `/api/stats/computeNodes` writes that field, it writes it for every node at
 * once, and it is an admin endpoint somebody runs by hand — so every node
 * created between two runs had no `stats` at all and was silently absent from
 * search. The pages worked, the entries could be linked and voted on, and
 * typing the name found nothing: that is how a person the scrapers ingested on
 * 2026-08-21 (`/osoba/ZJNaVX4vvTNAiKfSLj8f`) came to be reported as unfindable.
 *
 * Measured against production on 2026-08-23: 474 people and 204 companies were
 * invisible to search this way, plus 55 articles, which search does not read.
 * A further 473 people had no `stats.isApproved` — the same absence one filter
 * over, since `/api/nodes` filters every listing on it; none of those were
 * published yet, so this is preventive rather than a repair.
 *
 * Zero is the honest seed: it means "nobody has counted yet", and the next
 * `computeNodes` run replaces it with the real group size. Being ranked last
 * among the hits for a name is what search is for; being absent from them is
 * not.
 *
 * The cause is fixed in `withSeededNodeStats` in `server/utils/revisions.ts`,
 * which seeds the same two fields on every node written through a revision —
 * the ingest endpoints and the proposal form alike — so the count cannot grow
 * back.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/backfill-node-group-size.ts            # dry run
 *   npx tsx scripts/migrate/backfill-node-group-size.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/backfill-node-group-size.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

function tally(counts: Record<string, number>, type: string) {
  counts[type] = (counts[type] ?? 0) + 1;
}

function describe(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => `${count} ${type}`);
  return parts.length > 0 ? parts.join(", ") : "none";
}

async function backfill() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  // Only the two fields the predicate needs, plus what decides `isApproved`.
  // The whole collection is read either way, but not the whole of every
  // document: the node bodies are the bulk of it and none of them is used.
  const snapshot = await db
    .collection("nodes")
    .select(
      "type",
      "published",
      "deleted",
      "stats.nodeGroupSize",
      "stats.isApproved",
    )
    .get();
  console.log(`Scanning ${snapshot.docs.length} node(s).`);

  let batch = db.batch();
  let pending = 0;
  const seededSize: Record<string, number> = {};
  const seededApproved: Record<string, number> = {};
  let unchanged = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const stats = (data.stats ?? {}) as Record<string, unknown>;
    const type = typeof data.type === "string" ? data.type : "(no type)";

    // Field paths rather than a whole `stats` object: the counters this does
    // not know about — the vote aggregate, the edge summaries, the note count —
    // are maintained by triggers and by `computeNodes`, and writing the map
    // would delete every one of them.
    const update: Record<string, unknown> = {};
    if (stats.nodeGroupSize === undefined) {
      update["stats.nodeGroupSize"] = 0;
      tally(seededSize, type);
    }
    if (stats.isApproved === undefined) {
      update["stats.isApproved"] = pageIsPublic(data);
      tally(seededApproved, type);
    }

    if (Object.keys(update).length === 0) {
      unchanged++;
      continue;
    }

    if (commit) {
      batch.update(doc.ref, update);
      pending++;
      if (pending === 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }

  if (commit && pending > 0) await batch.commit();

  console.log(`stats.nodeGroupSize seeded: ${describe(seededSize)}`);
  console.log(`stats.isApproved seeded: ${describe(seededApproved)}`);
  console.log(`Already complete: ${unchanged}`);
  if (!commit) console.log("Dry run — nothing written.");
}

backfill()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
