import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  categoriesFromActivity,
  companyCategories,
} from "../../shared/companyCategories";

/**
 * Re-derive `categories` on company nodes from the PKD codes already stored.
 *
 * The category filter on /eksploruj reads `categories` off the place node, and
 * that field is written once, by `/api/ingest/company`, from the `activity`
 * codes in the payload. So the list of categories is effectively frozen at the
 * moment a company was last ingested: adding an entry to
 * `shared/companyCategories.ts` changes what the filter *offers* immediately,
 * and what it *finds* only after the next full company upload, which is a
 * manual pipeline run. Between the two the new category reads as empty and
 * looks broken.
 *
 * This closes that gap without a re-ingest — every code the mapping needs is
 * already in the database, on the same document. It is deliberately not
 * specific to any one category: it recomputes the whole set from
 * `categoriesFromActivity`, so it is the script to run after *any* change to
 * the category list, including narrowing a prefix or dropping a category. Not
 * a one-off, and re-running it when nothing changed writes nothing.
 *
 * Revisions are included for the same reason `unwrap-array-fields.ts` includes
 * them: a revision is written over its node wholesale when approved, so a
 * pending one carrying the old set would undo this the first time somebody
 * approves it.
 *
 * What it will not do:
 *   - touch a document with no `activity`. Companies from the associations
 *     register (SPZOZ hospitals) have no PKD codes in KRS, so an empty
 *     recomputed set there means "cannot tell", not "no categories", and
 *     clearing what is stored would lose whatever put it there.
 *   - keep a stored category the PKD codes no longer support. Those are
 *     removed and counted separately in the report, so a dry run shows the
 *     removals before they happen.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/recompute-company-categories.ts            # dry run
 *   npx tsx scripts/migrate/recompute-company-categories.ts --commit   # apply
 * Against production:
 *   npx tsx scripts/migrate/recompute-company-categories.ts --prod --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

/** Node data written through sanitizeFirestoreData stored arrays as objects
 * with numbered keys, so array fields have to be read tolerantly - the same
 * rule `asArray` in server/utils/nodeFilters.ts follows on the read path.
 * `unwrap-array-fields.ts` repairs the shape; this only has to survive it. */
function asArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, v]) => v)
      .filter((v): v is string => typeof v === "string");
  }
  return [];
}

/** Same members, in any order: the stored order carries no meaning, and
 * rewriting a document to reorder it would cost a write for nothing. */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((value) => seen.has(value));
}

type Stats = {
  /** Documents that would change. */
  documents: number;
  /** Category -> how many documents gained it. */
  added: Record<string, number>;
  /** Category -> how many documents lost it. */
  removed: Record<string, number>;
  /** Places with no PKD codes stored, so nothing to derive from. */
  noActivity: number;
  /** Places whose stored set already matches. */
  unchanged: number;
};

function newStats(): Stats {
  return { documents: 0, added: {}, removed: {}, noActivity: 0, unchanged: 0 };
}

function tally(counts: Record<string, number>, category: string) {
  counts[category] = (counts[category] ?? 0) + 1;
}

function describe(counts: Record<string, number>): string {
  return (
    Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([category, count]) => `${category} ${count}`)
      .join(", ") || "none"
  );
}

async function recompute(
  db: FirebaseFirestore.Firestore,
  collection: string,
  /** Where the node's own fields live; revisions nest them under `data`. */
  prefix = "",
): Promise<Stats> {
  const field = (name: string) => (prefix ? `${prefix}.${name}` : name);
  const stats = newStats();

  // Only the three fields the mapping needs. The whole collection is read
  // either way, but the node bodies are the bulk of it and none is used.
  const snapshot = await db
    .collection(collection)
    .select(field("type"), field("activity"), field("categories"))
    .get();
  console.log(`Scanning ${snapshot.docs.length} ${collection}.`);

  let batch = db.batch();
  let pending = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const container = (prefix ? data[prefix] : data) as
      Record<string, unknown> | undefined;
    if (!container || container.type !== "place") continue;

    const activity = asArray(container.activity);
    if (activity.length === 0) {
      stats.noActivity++;
      continue;
    }

    const stored = asArray(container.categories);
    const derived: string[] = categoriesFromActivity(activity);
    if (sameSet(stored, derived)) {
      stats.unchanged++;
      continue;
    }

    for (const category of derived) {
      if (!stored.includes(category)) tally(stats.added, category);
    }
    for (const category of stored) {
      if (!derived.includes(category)) tally(stats.removed, category);
    }
    stats.documents++;

    if (commit) {
      // A field path rather than a whole-document set: everything else on the
      // node - the vote aggregates, the edge summaries, whether it is
      // published - belongs to other writers.
      batch.update(doc.ref, { [field("categories")]: derived });
      pending++;
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }

  if (commit && pending > 0) await batch.commit();

  console.log(
    `  ${commit ? "Updated" : "Would update"} ${stats.documents} ${collection}.`,
  );
  console.log(`  Categories gained: ${describe(stats.added)}`);
  console.log(`  Categories dropped: ${describe(stats.removed)}`);
  console.log(
    `  Already correct: ${stats.unchanged}; no PKD codes stored: ${stats.noActivity}`,
  );
  return stats;
}

async function migrate() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );
  console.log(
    `Categories in shared/companyCategories.ts: ` +
      companyCategories
        .map((c) => `${c.value} (${c.pkdPrefixes.join(", ")})`)
        .join("; "),
  );

  const nodes = await recompute(db, "nodes");
  const revisions = await recompute(db, "revisions", "data");

  console.log(
    `${commit ? "Updated" : "Would update"} ` +
      `${nodes.documents + revisions.documents} document(s) in total.`,
  );
  if (!commit) console.log("Dry run — nothing written.");
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
