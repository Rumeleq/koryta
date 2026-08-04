/**
 * Checks that server/utils/firestoreLogging.ts still counts every kind of
 * Firestore operation. It hooks methods and reads fields that the SDK does not
 * document, so an upgrade could stop it working without failing a build - the
 * logs would just go quiet again, which is the state the instrumentation
 * exists to end. Run it after bumping firebase-admin:
 *
 *   devns npx firebase emulators:exec --project demo-koryta-pl --only firestore \
 *     "npx tsx scripts/check-firestore-logging.ts"
 *
 * Exits non-zero, naming what went unlogged.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { instrumentFirestore } from "../server/utils/firestoreLogging";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
initializeApp({ projectId: "demo-koryta-pl" });

const db = getFirestore("koryta-pl");
const patched = instrumentFirestore(db);

interface Entry {
  func: string;
  kind: string;
  collection: string;
  size: number;
  billed: number;
  matched?: number;
  offset?: number;
  collectionGroup?: boolean;
}

// firebase-functions/logger writes structured entries to stdout as JSON.
const logged: Entry[] = [];
const stdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
  const text =
    typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.func && entry.kind) logged.push(entry);
    } catch {
      // Not one of ours.
    }
  }
  return stdoutWrite(chunk as string, ...(rest as []));
}) as typeof process.stdout.write;

const collection = `check_${Date.now()}`;
const doc = (id: string) => db.collection(collection).doc(id);

async function exercise() {
  const batch = db.batch();
  for (const id of ["a", "b", "c"]) batch.set(doc(id), { type: "person" });
  await batch.commit();

  await doc("d").set({ type: "place" });
  await db.collection(collection).add({ type: "person" });

  await db.collection(collection).where("type", "==", "person").get();
  await db.collection(collection).orderBy("type").offset(2).limit(1).get();
  await doc("a").get();
  await db.getAll(doc("b"), doc("c"));
  await db.collection(collection).where("type", "==", "person").count().get();
  await db.collectionGroup(collection).limit(2).get();

  await db.runTransaction(async (tx) => {
    await tx.get(doc("a"));
    await tx.getAll(doc("b"), doc("c"));
    await tx.get(db.collection(collection).where("type", "==", "place"));
    tx.update(doc("a"), { touched: true });
  });

  await doc("d").delete();
}

/** What each call above should have produced. */
const expected: [string, (e: Entry) => boolean][] = [
  ["a multi-document batch", (e) => e.func === "batch.commit" && e.size === 3],
  [
    "doc.set as a one-op batch",
    (e) => e.func === "batch.commit" && e.size === 1,
  ],
  ["a filtered query", (e) => e.func === "query.get" && e.size === 4],
  [
    "an offset query billed for the documents it skipped",
    (e) => e.func === "query.get" && e.size === 1 && e.billed === 3,
  ],
  ["doc.get", (e) => e.func === "doc.get" && e.size === 1],
  ["getAll of several documents", (e) => e.func === "getAll" && e.size === 2],
  [
    "count(), with the documents it matched",
    (e) => e.func === "aggregate.get" && e.matched === 4,
  ],
  [
    "a collection group query",
    (e) => e.func === "query.get" && e.collectionGroup === true,
  ],
  ["a transactional doc read", (e) => e.func === "tx.doc.get"],
  ["a transactional getAll", (e) => e.func === "tx.getAll" && e.size === 2],
  ["a transactional query", (e) => e.func === "tx.query.get"],
];

async function main() {
  await exercise();

  const ours = logged.filter((e) => e.collection === collection);
  const missing = expected
    .filter(([, matches]) => !ours.some(matches))
    .map(([what]) => what);

  console.log(`\npatched: ${patched.join(", ")}`);
  console.log(`logged ${ours.length} operations`);

  if (missing.length) {
    console.error("\nnot logged:");
    for (const what of missing) console.error(`  - ${what}`);
    process.exit(1);
  }
  console.log("every operation was logged");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
