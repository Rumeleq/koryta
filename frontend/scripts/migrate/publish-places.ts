import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { pageIsPublic } from "../../shared/model";

/**
 * Publish the company nodes that were never put live.
 *
 * A company is not somebody's unverified claim. The nodes come out of the KRS
 * ingest, the site treats them as reference data, and every path that reaches
 * one assumes it has a page: a person's employer is rendered as a link whether
 * or not the company behind it is published, and `/api/search` returns the hit
 * either way. 136 of the 4024 companies in the export of 2026-08-26 are not
 * published, so all of those links answer "Strona nieznaleziona" to a logged
 * out reader. `PKP Cargotabor` is the one that was reported.
 *
 * That asymmetry is deliberate for people, where an unpublished node is the
 * invitation to log in and help review it. It was never a decision about
 * companies - the ingest simply wrote them without approving a revision, and
 * `pageIsPublic` reads a missing approval as a draft.
 *
 * Which is why publishing one is two writes rather than a flag.
 * `/api/nodes/publish.post.ts` refuses a node with no `revision_id`
 * ("Nie można opublikować strony bez zatwierdzonej rewizji"), and 135 of the
 * 136 have none - each has a revision, written by the ingest and never
 * approved. So this approves that revision and then publishes, which is the
 * pair of decisions an admin would have made through the UI.
 *
 * `stats.isApproved` is written here too. The `onNodeWritten` trigger maintains
 * it, but functions are deployed by hand and it does not run against a local
 * emulator at all - and `/api/nodes` filters every listing on that field, so a
 * node published without it keeps its page and appears in no table, which is
 * the hole `test_a_published_node_is_in_the_listings` exists to catch.
 *
 * What it does **not** do is apply the revision's data over the node. The node
 * is what the site has been serving and what the KRS ingest keeps up to date;
 * the revision is the record of how it got there. `applyRevision` overwrites
 * because a reviewer accepting an edit is choosing that edit - nobody is
 * choosing anything here, and a handful of the companies hold content that
 * differs from the revision being approved (5 of the 134 in the export of
 * 2026-08-23, which is what this was rehearsed against). The dry run counts
 * them so the number is on screen before anyone commits.
 *
 * The cause is not fixed by this script: whatever publishes a company at ingest
 * time still does not, so the count grows back. `test_every_company_is_published`
 * in `data/pipelines/src/tests/pipelines/test_invariants.py` carries the budget
 * and will say so.
 *
 * Usage (against the running dev:prod-data emulator):
 *   npx tsx scripts/migrate/publish-places.ts             # dry run, names every company
 *   npx tsx scripts/migrate/publish-places.ts --commit    # apply
 * Against production:
 *   npx tsx scripts/migrate/publish-places.ts --prod             # dry run
 *   npx tsx scripts/migrate/publish-places.ts --prod --commit    # apply
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

/** Attributed to the pipeline rather than to a person, since no person made
 * this decision - the same distinction `computeVoteStats` draws for votes. */
const AUTHOR = "pipeline";

/** The id a link field points at, whatever shape it was stored in. */
function pointsAt(value: unknown): string | undefined {
  if (typeof value === "string") return value.split("/").pop();
  if (value && typeof value === "object" && "id" in value) {
    return (value as { id: string }).id;
  }
  return undefined;
}

type Candidate = {
  id: string;
  name: string;
  /** The revision to approve first, or undefined if one is already approved. */
  approve?: string;
  /** Whether that revision's data says something other than what is live. */
  drifted: boolean;
};

async function migrate() {
  const db = getFirestore(app, "koryta-pl");
  console.log(
    `Connecting to ${isProd ? "PRODUCTION" : "local emulator"} Firestore` +
      (commit ? "" : " (dry run — pass --commit to apply)"),
  );

  const places = await db
    .collection("nodes")
    .where("type", "==", "place")
    .get();
  console.log(`Read ${places.size} companies.`);

  const candidates: Candidate[] = [];
  /** Companies this script will not touch, and why. */
  const skipped: [string, string][] = [];

  for (const doc of places.docs) {
    const data = doc.data();
    // `pageIsPublic`, not the raw flag: a company retired through an approved
    // removal is meant to have no page, and republishing it would undo a
    // decision somebody made.
    if (pageIsPublic(data)) continue;
    if (data.deleted === true) {
      skipped.push([data.name ?? doc.id, "removed on purpose (deleted)"]);
      continue;
    }

    const name = (data.name ?? "").trim();
    if (!name) {
      skipped.push([doc.id, "no name, so nothing would render"]);
      continue;
    }

    if (pointsAt(data.revision_id)) {
      candidates.push({ id: doc.id, name, drifted: false });
      continue;
    }

    const latest = pointsAt(data.revisions?.latest_id);
    if (!latest) {
      skipped.push([name, "no revision to approve"]);
      continue;
    }

    const revision = await db.collection("revisions").doc(latest).get();
    const stored = revision.data();
    if (!revision.exists || !stored?.data) {
      // The same refusal /api/revisions/approve makes: applying a revision
      // with no data would blank the company.
      skipped.push([name, `revision ${latest} has no data`]);
      continue;
    }

    candidates.push({
      id: doc.id,
      name,
      approve: latest,
      drifted: differs(stored.data as Record<string, unknown>, data),
    });
  }

  report(candidates, skipped);

  if (!commit) {
    console.log("\nDry run — nothing written.");
    return;
  }

  await publish(db, candidates);
  console.log(`\nDone. ${candidates.length} company page(s) are now live.`);
}

/** Whether approving this revision would change what the page says.
 *
 * Only the fields a revision owns are compared: `INTERNAL_FIELDS` are the
 * node's own bookkeeping and a revision never carries them, and
 * `update_time`/`update_user` describe the revision rather than the company.
 */
function differs(
  revision: Record<string, unknown>,
  node: Record<string, unknown>,
): boolean {
  const ignored = new Set([
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
    "update_time",
    "update_user",
    "update_automatic",
  ]);

  for (const key of new Set([...Object.keys(revision), ...Object.keys(node)])) {
    if (ignored.has(key)) continue;
    if (JSON.stringify(revision[key]) !== JSON.stringify(node[key]))
      return true;
  }
  return false;
}

function report(candidates: Candidate[], skipped: [string, string][]) {
  const approving = candidates.filter((c) => c.approve).length;
  const drifted = candidates.filter((c) => c.drifted);

  // Named rather than counted. Publishing a page is the one decision the whole
  // site is downstream of, and 136 is not a number anybody can check - the
  // names are, and a company that does not belong on the site is meant to be
  // spotted here rather than after the write.
  console.log(`\n${candidates.length} company page(s) to publish:`);
  for (const { name, approve, drifted } of [...candidates].sort((a, b) =>
    a.name.localeCompare(b.name, "pl"),
  )) {
    const notes = [
      approve ? `approving ${approve}` : "already approved",
      drifted ? "revision differs from the live node" : "",
    ].filter(Boolean);
    console.log(`  ${name} — ${notes.join(", ")}`);
  }

  console.log(
    `\n${approving} of them need their revision approved first; ` +
      `${candidates.length - approving} already have one.`,
  );
  if (drifted.length > 0) {
    console.log(
      `${drifted.length} hold content that differs from the revision being ` +
        `approved. The node is left as it is - see the docstring.`,
    );
  }

  if (skipped.length > 0) {
    console.log(`\n${skipped.length} left alone:`);
    for (const [name, why] of skipped) console.log(`  ${name} — ${why}`);
  }
}

async function publish(
  db: FirebaseFirestore.Firestore,
  candidates: Candidate[],
) {
  let batch = db.batch();
  let pending = 0;
  let done = 0;

  for (const { id, approve } of candidates) {
    const nodeRef = db.collection("nodes").doc(id);
    const update: Record<string, unknown> = {
      published: true,
      // The trigger would, if it is deployed and if it sees the write. Nothing
      // downstream can find the page without it.
      "stats.isApproved": true,
    };

    if (approve) {
      const revisionRef = db.collection("revisions").doc(approve);
      batch.update(revisionRef, {
        status: "approved",
        review_user: AUTHOR,
        review_time: Timestamp.now(),
      });
      update.revision_id = revisionRef;
      // What `computeRevisionsObj` would work out now that the approved
      // revision is the newest one. Written here so the node is consistent
      // before the next trigger run rather than after it.
      update["revisions.has_unapproved"] = false;
      pending += 1;
    }

    batch.update(nodeRef, update);
    // In the same commit as the change it describes, the way `recordAudit`
    // insists on - inlined rather than imported, because it reaches for a
    // nitro alias that tsx does not resolve.
    batch.set(db.collection("audit").doc(), {
      action: "publish",
      collection: "nodes",
      target_id: id,
      ...(approve ? { revision_id: approve } : {}),
      user: AUTHOR,
      at: new Date().toISOString(),
    });
    pending += 2;
    done += 1;

    if (pending >= BATCH_SIZE) {
      await batch.commit();
      console.log(`published ${done}/${candidates.length}`);
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending > 0) await batch.commit();
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
