import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

/**
 * Gives every article node a `publishedDate`, and optionally publishes the ones
 * that were never approved.
 *
 * /zrodla asks for its rows with `sortBy=publishedDate` (app/pages/zrodla.vue),
 * which reaches the paginated branch of /api/nodes and becomes a Firestore
 * `orderBy publishedDate`. An `orderBy` does not return documents that lack the
 * field at all - so an article with no date is not sorted last, it is absent,
 * for readers and editors alike. Against the production export of 2026-08-11,
 * of 287 article nodes:
 *
 *     103  approved, published, dated        - in the list
 *     160  approved, published, NO date      - invisible
 *      24  no revision_id, published=false   - invisible, and unapproved
 *
 * None of the 184 has the `meta` blob it was ingested with, so the date cannot
 * be recovered from the database: it has to come back off the page. This
 * re-fetches each `sourceURL` and reads the date out of the ld+json and the
 * `article:published_time` family of meta tags - the second of which
 * `getPageMeta` never looked at, which is a large part of how these arrived
 * dateless.
 *
 * The cause is fixed in `ensureArticleNode` (server/utils/articles.ts), which
 * used to write `publishedDate: undefined` - stripped on the way to Firestore,
 * leaving the field absent - whenever the scraped meta carried no date. It now
 * falls back to the time the article was added, so a new article is always in
 * the list even when its date is unknowable.
 *
 * `--fallback` (on by default, `--no-fallback` turns it off) covers the pages
 * that no longer answer: the earliest `update_time` among the node's own
 * revisions, i.e. when we first recorded it. That is not the publication date
 * and does not pretend to be - it is a lower bound that puts the row somewhere
 * plausible instead of nowhere at all. Every node that gets one is listed.
 *
 * The date is written as a revision rather than straight onto the node, because
 * `publishedDate` is revision-carried data (it is not in `INTERNAL_FIELDS`).
 * A bare field write would leave the node disagreeing with its approved
 * revision, and approving any older revision later - which writes revision data
 * over the node with `set` - would silently erase the date again.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/backfill-article-dates.ts              # dry run
 *   npx tsx scripts/migrate/backfill-article-dates.ts --commit
 *   npx tsx scripts/migrate/backfill-article-dates.ts --publish    # incl. the 24
 * Against production:
 *   npx tsx scripts/migrate/backfill-article-dates.ts --prod --publish --commit
 */

const isProd = process.argv.includes("--prod");
const commit = process.argv.includes("--commit");
/** Also approve and publish the articles that never had a revision approved. */
const publish = process.argv.includes("--publish");
/** Date a page we cannot fetch from its own revision history. */
const fallback = !process.argv.includes("--no-fallback");

if (!isProd) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "koryta-pl";
}

const app = initializeApp({ projectId: "koryta-pl" });

/** Two writes per article - the revision, and the node pointing at it - so this
 * stays well inside Firestore's limit of 500. */
const BATCH_SIZE = 400;
/** Polite against a few hundred urls, and slow enough not to look like a crawl
 * to any one host. */
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 15_000;
/** The same one `getPageMeta` sends: several Polish outlets serve a stub to
 * anything they do not recognise. */
const USER_AGENT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const AUTHOR = "migration:backfill-article-dates";

/** Nothing this site covers was published before the web, and a date in the
 * future is a template that rendered wrong. Either way it is worse than the
 * revision fallback, so it is rejected rather than stored. */
const MIN_DATE = Date.UTC(1990, 0, 1);
const maxDate = () => Date.now() + 24 * 60 * 60 * 1000;

function usableDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  const time = date.getTime();
  if (Number.isNaN(time) || time < MIN_DATE || time > maxDate())
    return undefined;
  return date;
}

/** The first string value stored under any of `keys`, however deeply nested.
 * ld+json is shaped differently by every CMS - sometimes an object, sometimes
 * an `@graph` array, sometimes both - and the date is the only thing wanted
 * out of it. */
function deepFind(value: unknown, keys: string[]): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFind(item, keys);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      if (keys.includes(key) && typeof val === "string" && val) return val;
    }
    for (const val of Object.values(value)) {
      const found = deepFind(val, keys);
      if (found) return found;
    }
  }
  return undefined;
}

/** Reads a publication date out of a page's html.
 *
 * Parsed with regexes rather than cheerio, which is a dependency of
 * `functions/` and not of the app - a one-off script is not worth adding one
 * for, and the two shapes it looks for are both machine-written.
 *
 * Every ld+json block is tried, not just the first: `getPageMeta` takes
 * `.first()`, and on the outlets that lead with an Organization or
 * BreadcrumbList block that is the one without a date.
 */
function extractPublishedDate(html: string): string | undefined {
  const published: string[] = [];
  const modified: string[] = [];

  const ldJson = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of ldJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]!);
    } catch {
      continue; // A block we cannot read is not a reason to give up on the page.
    }
    const p = deepFind(parsed, ["datePublished", "dateCreated"]);
    if (p) published.push(p);
    const m = deepFind(parsed, ["dateModified"]);
    if (m) modified.push(m);
  }

  const metaTags = html.matchAll(/<meta\s+([^>]*?)\/?>/gi);
  for (const match of metaTags) {
    const attrs = match[1]!;
    const name = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(
      attrs,
    )?.[1];
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1];
    if (!name || !content) continue;
    const key = name.toLowerCase();
    if (
      key === "article:published_time" ||
      key === "og:article:published_time" ||
      key === "datepublished" ||
      key === "date" ||
      key === "dc.date.issued"
    ) {
      published.push(content);
    } else if (
      key === "article:modified_time" ||
      key === "og:updated_time" ||
      key === "datemodified"
    ) {
      modified.push(content);
    }
  }

  // Publication before modification: a page edited years later still reports
  // the day it ran, and that is the date the list is sorted by.
  for (const candidate of [...published, ...modified]) {
    const date = usableDate(candidate);
    if (date) return date.toISOString();
  }
  return undefined;
}

/** The date some urls carry in the path.
 *
 * Only the two shapes that are unambiguous: a web.archive.org capture stamp,
 * and a blog's `/2024/09/04/` segments. Worth trying before the revision
 * fallback because both state something about the article rather than about
 * when we noticed it - the archive stamp in particular is the one date a
 * snapshot of a homepage has.
 */
function dateFromUrl(url: string): string | undefined {
  const archived = /\/web\/(\d{4})(\d{2})(\d{2})\d{6}(?:[a-z_]+)?\//i.exec(url);
  const path = /\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(url);
  const match = archived ?? path;
  if (!match) return undefined;
  return usableDate(
    `${match[1]}-${match[2]}-${match[3]}T00:00:00Z`,
  )?.toISOString();
}

type FetchOutcome =
  | { kind: "dated"; date: Date }
  | { kind: "undated" }
  | { kind: "failed"; reason: string };

async function fetchPublishedDate(url: string): Promise<FetchOutcome> {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const response = await fetch(target, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { kind: "failed", reason: `HTTP ${response.status}` };
    }
    const found =
      extractPublishedDate(await response.text()) ?? dateFromUrl(url);
    if (!found) return { kind: "undated" };
    return { kind: "dated", date: new Date(found) };
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Runs `worker` over `items`, `CONCURRENCY` of them at a time. */
async function mapLimit<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from(
    { length: Math.min(CONCURRENCY, items.length) },
    async () => {
      let index = next++;
      while (index < items.length) {
        results[index] = await worker(items[index]!, index);
        index = next++;
      }
    },
  );
  await Promise.all(runners);
  return results;
}

interface Candidate {
  id: string;
  name: string;
  sourceURL?: string;
  /** Fields to carry into the revision - everything but the node's own
   * bookkeeping. */
  revisionData: Record<string, unknown>;
  /** Never had a revision approved, so it is one of the 24. */
  unapproved: boolean;
}

/** Kept in step with `INTERNAL_FIELDS` in server/utils/revisions.ts, which this
 * script cannot import: that module resolves `~~/` aliases that tsx does not
 * know about outside the Nuxt build. */
const INTERNAL_FIELDS = new Set([
  "stats",
  "revision_id",
  "published",
  "revisions",
  "votes",
  "id",
  "deleted",
  "delete_reason",
  "visibility",
  "nameChunksLower",
]);

/** When this node was first written down, as a lower bound on when the article
 * ran. `undefined` when it has no revisions - a node created before the
 * revisions collection existed has nothing to date it by. */
async function earliestRevisionTime(
  db: FirebaseFirestore.Firestore,
  nodeId: string,
): Promise<Date | undefined> {
  const snap = await db
    .collection("revisions")
    .where("node_id", "==", nodeId)
    .orderBy("update_time", "asc")
    .limit(1)
    .get();
  const time = snap.docs[0]?.data().update_time;
  if (!time?.toDate) return undefined;
  return usableDate(time.toDate().toISOString());
}

async function migrate() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  const snap = await db
    .collection("nodes")
    .where("type", "==", "article")
    .get();
  console.log(`Read ${snap.size} article nodes.`);

  const candidates: Candidate[] = [];
  let alreadyDated = 0;
  let deferred = 0;
  let removed = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.deleted === true) {
      removed += 1;
      continue;
    }
    if (data.publishedDate) {
      alreadyDated += 1;
      continue;
    }
    const unapproved = !data.revision_id;
    // Approving an article's content and putting it on the site is a bigger
    // claim than filling in a date, so it takes the extra flag. Without it
    // these are reported and left alone rather than half-repaired into
    // "approved but still hidden".
    if (unapproved && !publish) {
      deferred += 1;
      continue;
    }
    const revisionData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!INTERNAL_FIELDS.has(key)) revisionData[key] = value;
    }
    candidates.push({
      id: doc.id,
      name: (data.name as string | undefined) ?? "(bez nazwy)",
      sourceURL: data.sourceURL as string | undefined,
      revisionData,
      unapproved,
    });
  }

  console.log(
    `\n${alreadyDated} already dated, ${removed} removed, ` +
      `${candidates.length} to date` +
      (deferred
        ? `, ${deferred} never approved and left alone (pass --publish to include them)`
        : ""),
  );
  if (candidates.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  console.log(
    `\nFetching ${candidates.length} page(s), ${CONCURRENCY} at a time…`,
  );
  const outcomes = await mapLimit(candidates, async (candidate, index) => {
    if ((index + 1) % 25 === 0) {
      console.log(`  fetched ${index + 1}/${candidates.length}`);
    }
    if (!candidate.sourceURL) {
      return { kind: "failed", reason: "no sourceURL" } as FetchOutcome;
    }
    const outcome = await fetchPublishedDate(candidate.sourceURL);
    // A url that no longer answers may still say when it was captured, and
    // that beats dating the article by when we wrote it down.
    if (outcome.kind !== "dated") {
      const fromUrl = dateFromUrl(candidate.sourceURL);
      if (fromUrl) return { kind: "dated", date: new Date(fromUrl) };
    }
    return outcome;
  });

  const writes: { candidate: Candidate; date: Date; source: string }[] = [];
  const skipped: { candidate: Candidate; reason: string }[] = [];
  const fallbacks: { candidate: Candidate; date: Date; reason: string }[] = [];

  for (const [index, candidate] of candidates.entries()) {
    const outcome = outcomes[index]!;
    if (outcome.kind === "dated") {
      writes.push({ candidate, date: outcome.date, source: "page" });
      continue;
    }
    const reason =
      outcome.kind === "failed" ? outcome.reason : "no date in the page";
    if (!fallback) {
      skipped.push({ candidate, reason });
      continue;
    }
    const earliest = await earliestRevisionTime(db, candidate.id);
    if (!earliest) {
      skipped.push({
        candidate,
        reason: `${reason}; no revision to date it by`,
      });
      continue;
    }
    fallbacks.push({ candidate, date: earliest, reason });
    writes.push({ candidate, date: earliest, source: "revision" });
  }

  const toPublish = writes.filter((w) => w.candidate.unapproved).length;
  console.log(
    `\n${writes.length} article(s) to date: ` +
      `${writes.length - fallbacks.length} from the page, ` +
      `${fallbacks.length} from their first revision` +
      (fallback ? "" : " (--no-fallback)") +
      `\n${toPublish} of them also approved and published` +
      `\n${skipped.length} left without a date`,
  );

  if (fallbacks.length > 0) {
    console.log("\nDated from their first revision, not from the page:");
    for (const { candidate, date, reason } of fallbacks) {
      console.log(
        `  ${candidate.id}  ${date.toISOString().slice(0, 10)}  ` +
          `${candidate.name.slice(0, 60)}  (${reason})`,
      );
    }
  }
  if (skipped.length > 0) {
    console.log("\nStill undated, and so still absent from /zrodla:");
    for (const { candidate, reason } of skipped) {
      console.log(
        `  ${candidate.id}  ${candidate.name.slice(0, 60)}  (${reason})`,
      );
    }
  }

  if (!commit) {
    console.log("\nDry run — nothing written.");
    return;
  }

  let batch = db.batch();
  let pending = 0;
  let done = 0;

  for (const { candidate, date } of writes) {
    const publishedDate = Timestamp.fromDate(date);
    const revisionRef = db.collection("revisions").doc();
    const now = Timestamp.now();

    batch.set(revisionRef, {
      node_id: candidate.id,
      collection: "nodes",
      data: { ...candidate.revisionData, publishedDate },
      update_time: now,
      update_user: AUTHOR,
      update_automatic: true,
      // Written already reviewed, and pointed at below, so `computeRevisionsObj`
      // does not read the node as having a change still waiting for approval.
      status: "approved",
      review_user: AUTHOR,
      review_time: now,
    });

    const nodeUpdate: Record<string, unknown> = {
      publishedDate,
      revision_id: revisionRef,
    };
    if (candidate.unapproved) {
      nodeUpdate.published = true;
      // `onNodeWritten` derives this from `pageIsPublic` and would set it a
      // moment later anyway, but /api/nodes filters anonymous listings on
      // `stats.isApproved == true` and a Firestore equality matches no document
      // that lacks the field - so writing it here is what keeps the article out
      // of a window where it is published and still unlisted.
      nodeUpdate["stats.isApproved"] = true;
    }
    batch.update(db.collection("nodes").doc(candidate.id), nodeUpdate);

    pending += 2;
    done += 1;
    if (pending >= BATCH_SIZE) {
      await batch.commit();
      console.log(`committed ${done}/${writes.length}`);
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  console.log(`\n${done} article(s) updated. Done.`);
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});
