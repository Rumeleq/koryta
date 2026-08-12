/**
 * Checks that the aggregation queries behind /api/stats/progress return the
 * same six numbers as counting the documents by hand.
 *
 * The endpoint answers "how much of the database has anybody looked at" from
 * eight `count()` queries instead of reading all 6,115 person nodes, and four
 * of the eight are intersections that exist only to subtract an overlap - the
 * kind of arithmetic that stays plausible while being wrong. So the same seed
 * is counted both ways and the answers compared:
 *
 *   devns npx firebase emulators:exec --project demo-koryta-pl --only firestore \
 *     "npx tsx scripts/check-progress-counts.ts"
 *
 * Exits non-zero, naming the filter and the two answers.
 *
 * Note that the emulator serves any query, indexed or not, so this checks the
 * arithmetic rather than which shapes production can actually aggregate. A
 * missing index there is caught at runtime and falls back to the scan.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  countProgress,
  tallyProgress,
  type ProgressStats,
} from "../server/utils/progressCounts";
import type { NodeFilterOp } from "../server/utils/nodeFilters";

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
initializeApp({ projectId: "demo-koryta-pl" });
const db = getFirestore("koryta-pl");

interface Seed {
  type: string;
  parties?: string[];
  stats: {
    isApproved?: boolean;
    notesCount?: number;
    votes?: { humanVoted?: boolean };
    edges?: { all?: { currentlyEmployed?: boolean } };
  };
}

/** Every combination of the three statuses the counters read, plus the
 * documents that carry none of the fields at all - which is what an
 * unprocessed node looks like, and the case `== false` would silently miss. */
function seeds(): Seed[] {
  const rows: Seed[] = [];
  for (const isApproved of [true, false, undefined]) {
    for (const humanVoted of [true, false, undefined]) {
      for (const notesCount of [0, 2, undefined]) {
        for (const currentlyEmployed of [true, false]) {
          const party = rows.length % 3 === 0 ? "PO" : "PiS";
          rows.push({
            type: "person",
            parties: [party],
            stats: {
              ...(isApproved === undefined ? {} : { isApproved }),
              ...(notesCount === undefined ? {} : { notesCount }),
              votes: humanVoted === undefined ? {} : { humanVoted },
              edges: { all: { currentlyEmployed } },
            },
          });
        }
      }
    }
  }
  // A place must never be counted, whatever its stats say.
  rows.push({ type: "place", stats: { isApproved: true, notesCount: 5 } });
  return rows;
}

const typeOp: NodeFilterOp = {
  applyFs: (query) => query.where("type", "==", "person"),
  applyMem: (nodes) => nodes.filter((node) => node.type === "person"),
};

const partyOp = (party: string): NodeFilterOp => ({
  applyFs: (query) => query.where("parties", "array-contains-any", [party]),
  applyMem: (nodes) => nodes.filter((node) => node.parties?.includes(party)),
});

const employedOp: NodeFilterOp = {
  applyFs: (query) =>
    query.where("stats.edges.all.currentlyEmployed", "==", true),
  applyMem: (nodes) =>
    nodes.filter((node) => node.stats?.edges?.all?.currentlyEmployed === true),
};

const CASES: { name: string; ops: NodeFilterOp[] }[] = [
  { name: "unfiltered", ops: [typeOp] },
  { name: "parties=PO", ops: [typeOp, partyOp("PO")] },
  { name: "currentlyEmployed=any", ops: [typeOp, employedOp] },
  { name: "parties=PO+employed", ops: [typeOp, partyOp("PO"), employedOp] },
  { name: "no matches", ops: [typeOp, partyOp("Nonexistent")] },
];

async function seed(rows: Seed[]) {
  // Written in one batch per 400 so the whole seed lands before anything reads
  // it; the aggregations are not run inside a transaction.
  for (let i = 0; i < rows.length; i += 400) {
    const batch = db.batch();
    for (const [offset, row] of rows.slice(i, i + 400).entries()) {
      batch.set(db.collection("nodes").doc(`check_${i + offset}`), row);
    }
    await batch.commit();
  }
}

function differences(a: ProgressStats, b: ProgressStats): string[] {
  return (Object.keys(a) as (keyof ProgressStats)[])
    .filter((key) => a[key] !== b[key])
    .map((key) => `${key}: aggregated ${a[key]}, counted ${b[key]}`);
}

async function main() {
  const rows = seeds();
  await seed(rows);

  const failures: string[] = [];
  for (const { name, ops } of CASES) {
    const aggregated = await countProgress(db, ops);
    if (!aggregated) {
      failures.push(`${name}: countProgress declined to answer`);
      continue;
    }
    const expected = tallyProgress(
      ops.reduce<Seed[]>((nodes, op) => op.applyMem(nodes), rows),
    );
    const diff = differences(aggregated, expected);
    if (diff.length) failures.push(`${name}: ${diff.join("; ")}`);
    else console.info(`ok  ${name}: ${JSON.stringify(aggregated)}`);
  }

  // A filter that only runs in memory has to be declined rather than answered
  // wrongly - that is what keeps the caller's fallback correct.
  const memOnly: NodeFilterOp = {
    applyFs: () => {
      throw new Error("index: filter not supported in Firestore query");
    },
    applyMem: (nodes) => nodes,
  };
  if ((await countProgress(db, [typeOp, memOnly])) !== null) {
    failures.push("a memory-only filter was answered instead of declined");
  }

  if (failures.length) {
    console.error(`\n${failures.length} failure(s):`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.info("\nprogress counters agree with the documents");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
