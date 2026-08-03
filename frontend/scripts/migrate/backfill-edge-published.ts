import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * One-time migration: write `published: false` onto every edge that has no
 * `published` field at all.
 *
 * The two readings are identical to `pageIsPublic`, which asks for the flag to
 * be exactly `true` — so this changes nothing about who can see what. What it
 * changes is whether the edge can be *found*: Firestore matches no filter
 * against a field a document does not have, so `where("published", "==",
 * false)` skips them, and /admin/krawedzie — the queue of relations waiting on
 * their pages — is built on exactly that query. Without this backfill, an edge
 * written before the flag existed stays invisible to the review queue forever.
 *
 * /api/nodes/migratePublished did this for nodes and edges once, and was
 * deleted afterwards; anything created since by /api/edges/create was written
 * without the field, which that endpoint now also sets. This is the catch-up
 * for the documents in between.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/backfill-edge-published.ts            # dry run
 *   npx tsx scripts/migrate/backfill-edge-published.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/backfill-edge-published.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

/** Firestore's limit is 500 writes; well under it leaves room to grow. */
const BATCH_SIZE = 400;

async function migrate() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  const snap = await db.collection("edges").get();
  console.log(`Scanning ${snap.docs.length} edge documents.`);

  let batch = db.batch();
  let pending = 0;
  let migrated = 0;

  for (const doc of snap.docs) {
    // `undefined` is the only case worth touching. An edge already carrying
    // `false` is fine, and one carrying `true` is live — rewriting either
    // would cost a write and fire onEdgeWritten for nothing.
    if (doc.data().published !== undefined) continue;

    migrated += 1;
    if (!commit) continue;

    batch.update(doc.ref, { published: false });
    pending += 1;
    if (pending >= BATCH_SIZE) {
      await batch.commit();
      console.log(`Committed ${migrated} updates so far.`);
      batch = db.batch();
      pending = 0;
    }
  }

  if (commit && pending > 0) await batch.commit();

  console.log(
    commit
      ? `Done. ${migrated} edge(s) now carry published: false.`
      : `Dry run. ${migrated} edge(s) would be given published: false.`,
  );
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});
