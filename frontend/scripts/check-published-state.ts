import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { pageIsPublic } from "../shared/model";

/** Reports whether the `published` backfill has reached everything, and whether
 * the data satisfies the rule that no relation outlives its endpoints.
 *
 *   npx tsx scripts/check-published-state.ts [nodeId]
 */
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "koryta-pl";

const app = initializeApp({ projectId: "koryta-pl" });
const nodeId = process.argv[2];

async function main() {
  const db = getFirestore(app, "koryta-pl");

  const nodes = await db.collection("nodes").get();
  const nodePublic = new Map<string, boolean>();
  let nodesMissing = 0;
  let nodesLive = 0;
  for (const doc of nodes.docs) {
    const data = doc.data();
    if (data.published === undefined) nodesMissing += 1;
    const live = pageIsPublic(data);
    if (live) nodesLive += 1;
    nodePublic.set(doc.id, live);
  }

  const edges = await db.collection("edges").get();
  let edgesMissing = 0;
  let edgesLive = 0;
  let violations = 0;
  let readyToPublish = 0;
  for (const doc of edges.docs) {
    const data = doc.data();
    if (data.published === undefined) edgesMissing += 1;
    const live = pageIsPublic(data);
    const endpointsLive =
      nodePublic.get(data.source) === true &&
      nodePublic.get(data.target) === true;
    if (live) {
      edgesLive += 1;
      // The rule this branch enforces, measured against what is stored.
      if (!endpointsLive) violations += 1;
    } else if (endpointsLive && data.deleted !== true) {
      // What /admin/krawedzie would offer.
      readyToPublish += 1;
    }
  }

  console.log("=== published flag ===");
  console.log(
    `nodes: ${nodesLive} live of ${nodes.size}` +
      `  (${nodesMissing} still have no published field)`,
  );
  console.log(
    `edges: ${edgesLive} live of ${edges.size}` +
      `  (${edgesMissing} still have no published field)`,
  );

  console.log("\n=== the invariant, as stored ===");
  console.log(
    `${violations} published edge(s) with an endpoint that is not published` +
      (violations === 0 ? "  ✓" : "  ← these would need hiding"),
  );
  console.log(
    `${readyToPublish} unpublished edge(s) between two published pages` +
      " (the /admin/krawedzie queue)",
  );

  if (!nodeId) return;

  const snap = await db.collection("nodes").doc(nodeId).get();
  console.log(`\n=== node ${nodeId} ===`);
  console.log(
    `name=${snap.data()?.name}  published=${JSON.stringify(snap.data()?.published)}`,
  );
  const [bySource, byTarget] = await Promise.all([
    db.collection("edges").where("source", "==", nodeId).get(),
    db.collection("edges").where("target", "==", nodeId).get(),
  ]);
  const seen = new Map<string, Record<string, unknown>>();
  for (const doc of [...bySource.docs, ...byTarget.docs]) {
    if (!seen.has(doc.id)) seen.set(doc.id, doc.data());
  }
  let offered = 0;
  for (const [id, edge] of seen) {
    const other = edge.source === nodeId ? edge.target : edge.source;
    const otherLive = nodePublic.get(String(other)) === true;
    if (otherLive && !pageIsPublic(edge)) offered += 1;
    console.log(
      `edge=${id} type=${edge.type} published=${JSON.stringify(edge.published)}` +
        ` other=${other} otherPublished=${otherLive}`,
    );
  }
  console.log(
    `→ ${offered} of ${seen.size} relation(s) would be tickable in the dialog`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
