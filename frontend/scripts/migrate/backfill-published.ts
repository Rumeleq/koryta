import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * The `published` backfill that /api/nodes/migratePublished was supposed to
 * have done, and did not.
 *
 * `pageIsPublic` used to answer `!!revision_id` when `published` was absent.
 * That fallback was removed on the stated grounds that every document had been
 * backfilled. Against the production export of 2026-07-27 that is not true of a
 * single one:
 *
 *     nodes: 0 published of 10707
 *     edges: 0 published of 28349
 *
 * With the fallback gone that left every page and relation reading as a draft.
 * A `published = !!revision_id` backfill has since been run against production
 * - the export of 2026-08-03T19:55Z has the field on all 10759 nodes and all
 * 28465 edges - so the first half of this script is now a no-op there and is
 * kept for any environment that has not had it.
 *
 * Two rules, not one:
 *
 *   nodes  published = !!revision_id            (what the fallback said)
 *   edges  published = !!revision_id AND both endpoints published
 *
 * The extra clause on edges is the invariant this branch introduces - no
 * relation is visible unless both the pages it joins are. Far more edges carry
 * a revision_id than the nodes at their ends do, so a straight `!!revision_id`
 * publishes relations pointing at pages nobody can open. That is what the
 * production run did, and `--repair` is the cleanup: it hides the 161 edges
 * that went live against a draft. Kept behind a flag because taking relations
 * off the site is a bigger claim than filling in a missing field.
 *
 * Otherwise only documents with no `published` field are touched, so the script
 * is idempotent and can never hide something an admin has published by hand.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/backfill-published.ts             # dry run
 *   npx tsx scripts/migrate/backfill-published.ts --repair    # incl. cleanup
 *   npx tsx scripts/migrate/backfill-published.ts --commit    # apply
 * Against production:
 *   npx tsx scripts/migrate/backfill-published.ts --prod --repair --commit
 *
 * `scripts/check-published-state.ts` reports the same numbers without writing.
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");
/** Also hide edges that are already live with an endpoint that is not. */
const repair = process.argv.includes("--repair");

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

  const nodesSnap = await db.collection("nodes").get();
  console.log(`Read ${nodesSnap.size} nodes.`);

  /** Which nodes are, or are about to be, public. The edge pass needs this for
   * both of its endpoints, so it is built before anything is written. */
  const nodePublic = new Map<string, boolean>();
  const nodeWrites: { id: string; published: boolean }[] = [];
  for (const doc of nodesSnap.docs) {
    const data = doc.data();
    const already = data.published;
    const published =
      already === undefined ? !!data.revision_id : already === true;
    nodePublic.set(doc.id, published && data.deleted !== true);
    if (already === undefined) nodeWrites.push({ id: doc.id, published });
  }

  const edgesSnap = await db.collection("edges").get();
  console.log(`Read ${edgesSnap.size} edges.`);

  const edgeWrites: { id: string; published: boolean }[] = [];
  let blockedByEndpoint = 0;
  let repaired = 0;
  for (const doc of edgesSnap.docs) {
    const data = doc.data();
    const endpointsPublic =
      nodePublic.get(data.source) === true &&
      nodePublic.get(data.target) === true;

    if (data.published === undefined) {
      const published = !!data.revision_id && endpointsPublic;
      if (!!data.revision_id && !endpointsPublic) blockedByEndpoint += 1;
      edgeWrites.push({ id: doc.id, published });
      continue;
    }

    // Already carries the flag, so the backfill has nothing to say about it -
    // unless it is live with an endpoint that is not, which is the rule this
    // branch enforces and which a `!!revision_id` backfill run on its own will
    // have left behind. Hiding them is opt-in: it takes relations off the site,
    // which is a bigger claim than filling in a missing field.
    if (repair && data.published === true && !endpointsPublic) {
      repaired += 1;
      edgeWrites.push({ id: doc.id, published: false });
    }
  }

  const nodesLive = nodeWrites.filter((w) => w.published).length;
  const edgesLive = edgeWrites.filter((w) => w.published).length;
  console.log(
    `\nnodes: ${nodeWrites.length} to write, ${nodesLive} of them published\n` +
      `edges: ${edgeWrites.length} to write, ${edgesLive} of them published\n` +
      `       ${blockedByEndpoint} edge(s) have an approved revision but stay ` +
      `hidden because an endpoint is not public\n` +
      (repair
        ? `       ${repaired} already-live edge(s) hidden by --repair`
        : `       (pass --repair to also hide edges already live against a draft)`),
  );

  if (!commit) {
    console.log("\nDry run — nothing written.");
    return;
  }

  await write(db, "nodes", nodeWrites);
  await write(db, "edges", edgeWrites);
  console.log("\nDone.");
}

async function write(
  db: FirebaseFirestore.Firestore,
  collection: string,
  writes: { id: string; published: boolean }[],
) {
  let batch = db.batch();
  let pending = 0;
  let done = 0;

  for (const { id, published } of writes) {
    batch.update(db.collection(collection).doc(id), { published });
    pending += 1;
    done += 1;
    if (pending >= BATCH_SIZE) {
      await batch.commit();
      console.log(`${collection}: committed ${done}/${writes.length}`);
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();
  console.log(`${collection}: ${done} document(s) updated.`);
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});
