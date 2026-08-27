import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * One-time migration: retype the region→company `owns` edges to `seat`.
 *
 * `owns` meant two different things and nobody had to choose, because only one
 * of them was ever written. A region→company edge was the company's *seat* -
 * `regionsByPlaceId` says so outright, and it is what the „Siedziba spółki"
 * filter and the location column on /eksploruj read. Real ownership existed on
 * 115 place→place edges and nowhere else.
 *
 * Ingesting the register's shareholder lists ends that. KRS names a gmina, a
 * powiat or a województwo as the owner of 1,675 companies, and those edges run
 * region→company too. Left as `owns` they would be indistinguishable from a
 * seat, and worse than indistinguishable: `regionsByPlaceId` resolves two
 * claimants by TERYT length, so Gmina Miasta Gdańsk (`teryt2261`, 4 chars)
 * holding 10.7% of Gdynia-seated PKP SKM (`teryt2262`, 4 chars) would tie, and
 * the company's displayed location would depend on which region the loop
 * reached first.
 *
 * So the seat gets its own type and `owns` keeps only its honest meaning.
 *
 * WHAT THIS TOUCHES, and what it deliberately does not:
 *
 *   region→place (3,939)  retyped to `seat`. This is the migration.
 *   region→region (390)   left as `owns`. The hierarchy is not the confusing
 *                         case - a województwo does contain a powiat - and no
 *                         ownership edge will ever be written between two
 *                         regions, so it cannot collide. Retyping it would cost
 *                         390 more documents, another RegionPayloads change and
 *                         another UI branch for nothing. If it is ever retyped
 *                         it must be `contains`, never `seat`: giving the
 *                         hierarchy the seat type puts child regions straight
 *                         back into the bucket `regionsByPlaceId` reads.
 *   place→place (115)     left as `owns`. Already the honest meaning.
 *
 * THE REVISIONS ARE NOT OPTIONAL. 3,900 revisions point at these edges and
 * every one carries `data.type: "owns"`. `applyRevision` layers revision data
 * over the document, so an edge retyped here and left with an `owns` revision
 * silently reverts the next time anybody approves it. Same reasoning as
 * `unwrap-array-fields.ts`.
 *
 * TWO SHAPES OF EDGE, because `edgeDocumentId` derives the id from
 * source+target+type for a state edge:
 *
 *   3,628 carry a random id, from before the ids were derived. Nothing reads
 *     the id - `findEdge` queries on (source, target, type) - so `update` is
 *     enough and the document, its revision pointer, its `published` flag and
 *     its `references` all stay put.
 *   311 carry `edge_<source>_<target>_owns`. Those must move, and not for
 *     tidiness: the KRS work writes `createEdge(region, company, "owns")` for
 *     the 1,192 gmina owners, `edgeDocumentId` computes that same id, `findEdge`
 *     misses on the type, and `createRevisionTransaction` does `batch.set` -
 *     overwriting the seat. The common case, since a gmina usually owns the
 *     company seated in it.
 *
 * ORDER. Deploy the readers first: `computeNodes.post.ts`, `functions/edges.ts`,
 * `nodeFilters.ts` and `companyLocation.ts` all accept `owns` *and* `seat`, so
 * the site is correct before, during and after. Do not narrow them to `seat`
 * until an export shows zero region→place `owns`.
 *
 * `functions/src/edges.ts` deploys by hand. Verify the deployed function
 * queries `type in ["owns","seat"]` BEFORE running this, or every edge write
 * here recomputes a region's stats with the seat missing.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/split-seat-edges.ts            # dry run
 *   npx tsx scripts/migrate/split-seat-edges.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/split-seat-edges.ts --prod --commit
 * To undo:
 *   npx tsx scripts/migrate/split-seat-edges.ts --prod --commit --reverse
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");
const reverse = process.argv.includes("--reverse");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

/** Firestore's own cap is 500; the repo has settled on 400. */
const BATCH_SIZE = 400;

const FROM = reverse ? "seat" : "owns";
const TO = reverse ? "owns" : "seat";

async function main() {
  const db = getFirestore(app, "koryta-pl");

  console.info(`Reading nodes to tell a region from a company...`);
  const nodesSnapshot = await db.collection("nodes").get();
  const nodeType: Record<string, string | undefined> = {};
  for (const doc of nodesSnapshot.docs) {
    nodeType[doc.id] = doc.data().type;
  }
  console.info(`  ${nodesSnapshot.size} nodes`);

  console.info(`Reading ${FROM} edges...`);
  const edgesSnapshot = await db
    .collection("edges")
    .where("type", "==", FROM)
    .get();
  console.info(`  ${edgesSnapshot.size} ${FROM} edges`);

  const seats: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  const counts = {
    regionToRegion: 0,
    placeToPlace: 0,
    otherOrUnknownEndpoint: 0,
  };
  for (const doc of edgesSnapshot.docs) {
    const { source, target } = doc.data();
    const sourceType = nodeType[source];
    const targetType = nodeType[target];
    if (sourceType === "region" && targetType === "place") {
      seats.push(doc);
    } else if (sourceType === "region" && targetType === "region") {
      counts.regionToRegion += 1;
    } else if (sourceType === "place" && targetType === "place") {
      counts.placeToPlace += 1;
    } else {
      // An endpoint that is missing or is neither: reported, never guessed at.
      counts.otherOrUnknownEndpoint += 1;
    }
  }

  console.info(`\nOf the ${edgesSnapshot.size} ${FROM} edges:`);
  console.info(`  region -> place  ${seats.length}  <- retyped to ${TO}`);
  console.info(`  region -> region ${counts.regionToRegion}  left alone`);
  console.info(`  place  -> place  ${counts.placeToPlace}  left alone`);
  console.info(
    `  other/unknown    ${counts.otherOrUnknownEndpoint}  left alone`,
  );

  // The revisions that point at each edge, so `data.type` moves with it.
  console.info(`\nReading revisions for those edges...`);
  const revisionsByNode: Record<
    string,
    FirebaseFirestore.QueryDocumentSnapshot[]
  > = {};
  // Every revision, not `where("collection","==","edges")`: that field is set
  // on 302 of the 47,684 stored revisions, so the narrow query would miss
  // almost all of them. One full read, once.
  const allRevisions = await db.collection("revisions").get();
  for (const doc of allRevisions.docs) {
    const nodeId = doc.data().node_id;
    if (typeof nodeId !== "string") continue;
    (revisionsByNode[nodeId] ??= []).push(doc);
  }

  const seatIds = new Set(seats.map((d) => d.id));
  const revisionsToFix = Object.entries(revisionsByNode)
    .filter(([nodeId]) => seatIds.has(nodeId))
    .flatMap(([, docs]) => docs)
    .filter((doc) => doc.data().data?.type === FROM);
  const seatsWithNoRevision = seats.filter(
    (doc) => !revisionsByNode[doc.id]?.length,
  );

  const derived = seats.filter(
    (doc) =>
      doc.id === `edge_${doc.data().source}_${doc.data().target}_${FROM}`,
  );
  const inPlace = seats.filter((doc) => !derived.includes(doc));

  console.info(`  ${revisionsToFix.length} revisions carry data.type=${FROM}`);
  console.info(`  ${seatsWithNoRevision.length} edges have no revision at all`);
  console.info(`\nOf the ${seats.length} seats:`);
  console.info(`  ${inPlace.length} carry a random id  -> update in place`);
  console.info(`  ${derived.length} carry a derived id -> must move`);

  // A derived id that is already taken would be overwritten, so check first.
  const collisions: string[] = [];
  for (const doc of derived) {
    const { source: s, target: t } = doc.data();
    const targetId = `edge_${s}_${t}_${TO}`;
    const existing = await db.collection("edges").doc(targetId).get();
    if (existing.exists) collisions.push(targetId);
  }
  if (collisions.length) {
    console.error(
      `\n${collisions.length} target ids are already taken; refusing to overwrite:`,
    );
    for (const id of collisions.slice(0, 10)) console.error(`  ${id}`);
    process.exit(1);
  }

  const writes = inPlace.length + derived.length * 2 + revisionsToFix.length;
  console.info(
    `\n${writes} document writes in ~${Math.ceil(writes / BATCH_SIZE)} batches.`,
  );

  if (!commit) {
    console.info("\nDry run. Re-run with --commit to apply.");
    return;
  }

  console.info(`\nRetyping ${FROM} -> ${TO}...`);

  // A. random-id seats: the type is the only thing that changes.
  await inBatches(db, inPlace, (batch, doc) => {
    batch.update(doc.ref, { type: TO });
  });

  // B. derived-id seats: set at the new id, delete the old, repoint the
  // revision. One batch per edge, so an edge is never half-moved - batches are
  // atomic individually, and an interrupted run resumes because the predicate
  // is "still the old type".
  for (const doc of derived) {
    const data = doc.data();
    const newId = `edge_${data.source}_${data.target}_${TO}`;
    const batch = db.batch();
    batch.set(db.collection("edges").doc(newId), { ...data, type: TO });
    batch.delete(doc.ref);
    for (const revision of revisionsByNode[doc.id] ?? []) {
      batch.update(revision.ref, {
        node_id: newId,
        "data.type": TO,
      });
    }
    await batch.commit();
  }
  console.info(`  moved ${derived.length} derived-id edges`);

  // C. every remaining revision, so approving one cannot revert the edge.
  const remaining = revisionsToFix.filter(
    (doc) => !derived.some((edge) => revisionsByNode[edge.id]?.includes(doc)),
  );
  await inBatches(db, remaining, (batch, doc) => {
    batch.update(doc.ref, { "data.type": TO });
  });

  console.info(
    `\nDone. Re-run the dry run: it must report 0 region -> place ${FROM} edges.`,
  );
  console.info(
    "Then recompute stats (POST /api/stats/computeNodes) so seatNodeIds is populated.",
  );
}

async function inBatches<T extends FirebaseFirestore.QueryDocumentSnapshot>(
  db: FirebaseFirestore.Firestore,
  docs: T[],
  apply: (batch: FirebaseFirestore.WriteBatch, doc: T) => void,
) {
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const doc of chunk) apply(batch, doc);
    await batch.commit();
    console.info(`  ${Math.min(i + BATCH_SIZE, docs.length)}/${docs.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
