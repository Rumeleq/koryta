/**
 * Snapshots what a re-ingest is not allowed to damage, for a named set of people.
 *
 * Run it once before submitting payloads and once after, then diff the two
 * files. It records three things per person:
 *
 *   - the node document, including the fields no revision carries (`published`,
 *     `stats`, `votes`, `revision_id`) - a revision is written to its target
 *     with `set` rather than `merge`, so anything the ingest does not carry
 *     across is erased rather than left alone;
 *   - every revision ever written against that node or its edges, by id, so a
 *     revision that disappears or is rewritten shows up as a diff rather than
 *     as a number that happens to still add up;
 *   - the person's edges, with the fields the pipeline has an opinion about.
 *
 * Usage, against a stack started by `devns npm run dev:prod-data`:
 *
 *   node scripts/reingest-check.mjs before.json "Jan Kowalski" "Anna Nowak"
 *   ...submit the payloads...
 *   node scripts/reingest-check.mjs after.json  "Jan Kowalski" "Anna Nowak"
 *   node scripts/reingest-check.mjs --diff before.json after.json
 *
 * FIRESTORE_EMULATOR_HOST defaults to the relay `devns` prints for guest 8080.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Set before the first `getFirestore`, which is when the admin SDK reads it.
// An `import` is hoisted above any statement written over it, so this cannot
// go at the top of the file however much it reads like configuration.
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:3103";

const args = process.argv.slice(2);

if (args[0] === "--diff") {
  diff(
    JSON.parse(readFileSync(args[1], "utf8")),
    JSON.parse(readFileSync(args[2], "utf8")),
  );
  process.exit(0);
}

const [outPath, ...names] = args;
if (!outPath || names.length === 0) {
  console.error(
    "usage: reingest-check.mjs <out.json> <name>... | --diff <a> <b>",
  );
  process.exit(64);
}

const db = getFirestore(initializeApp({ projectId: "koryta-pl" }), "koryta-pl");

const snapshot = {};
for (const name of names) {
  const nodes = await db.collection("nodes").where("name", "==", name).get();
  if (nodes.empty) {
    snapshot[name] = { missing: true };
    continue;
  }
  const doc = nodes.docs[0];
  const data = doc.data();

  const edgeDocs = [
    ...(await db.collection("edges").where("source", "==", doc.id).get()).docs,
    ...(await db.collection("edges").where("target", "==", doc.id).get()).docs,
  ];

  // Revisions are keyed by the document they describe, which is the node for a
  // node revision and the edge for an edge one.
  const targetIds = [doc.id, ...edgeDocs.map((e) => e.id)];
  const revisions = {};
  for (const targetId of targetIds) {
    for (const rev of (
      await db.collection("revisions").where("node_id", "==", targetId).get()
    ).docs) {
      const r = rev.data();
      revisions[rev.id] = {
        node_id: r.node_id,
        collection: r.collection ?? null,
        status: r.status ?? null,
        update_user: r.update_user ?? null,
        update_automatic: r.update_automatic ?? null,
        update_time: String(r.update_time?.toDate?.() ?? r.update_time ?? ""),
        data: r.data ?? null,
      };
    }
  }

  snapshot[name] = {
    nodeId: doc.id,
    published: data.published ?? null,
    revision_id: data.revision_id?.id ?? data.revision_id ?? null,
    stats: data.stats ?? null,
    votes: data.votes ?? null,
    parties: data.parties ?? null,
    rejestrIo: data.rejestrIo ?? null,
    wikipedia: data.wikipedia ?? null,
    content: data.content ?? null,
    edges: Object.fromEntries(
      edgeDocs.map((e) => {
        const d = e.data();
        return [
          e.id,
          {
            type: d.type,
            start_date: String(d.start_date ?? ""),
            position: d.position ?? null,
            committee: d.committee ?? null,
            party: d.party ?? null,
            published: d.published ?? null,
          },
        ];
      }),
    ),
    revisions,
  };
}

writeFileSync(outPath, JSON.stringify(snapshot, null, 1));
console.log(`wrote ${outPath} for ${names.length} people`);
process.exit(0);

function diff(before, after) {
  let problems = 0;
  const note = (msg) => {
    problems++;
    console.log(`  LOST  ${msg}`);
  };

  for (const [name, b] of Object.entries(before)) {
    const a = after[name];
    console.log(`\n=== ${name}`);
    if (b.missing || !a) {
      console.log("  (absent from one of the snapshots)");
      continue;
    }

    // Visibility must survive untouched: it is the one thing a scraper re-run
    // is never entitled to decide.
    if (b.published !== a.published) {
      note(`published: ${b.published} -> ${a.published}`);
    }

    // A moved `revision_id` is fine - an approved update is exactly that - so
    // what is checked is that it still lands on an approved revision rather
    // than on nothing.
    if (b.revision_id !== a.revision_id) {
      const target = a.revisions[a.revision_id];
      if (!target) note(`revision_id now points at nothing (${a.revision_id})`);
      else if (target.status !== "approved") {
        note(`revision_id points at a ${target.status} revision`);
      } else {
        console.log(`  revision_id moved to a new approved revision (ok)`);
      }
    }

    // `stats` and `votes` belong to the node and are in no revision, so a
    // `set` that does not carry them across silently drops them. Losing
    // `stats.isApproved` in particular takes the person out of every listing
    // that filters on it, because a Firestore equality filter does not match a
    // document missing the field.
    for (const field of ["stats", "votes"]) {
      const bv = JSON.stringify(b[field]);
      const av = JSON.stringify(a[field]);
      if (bv !== av) note(`${field}: ${bv} -> ${av}`);
    }
    // Fields a reviewer may have written by hand.
    for (const field of ["parties", "rejestrIo", "wikipedia", "content"]) {
      const bv = JSON.stringify(b[field]);
      const av = JSON.stringify(a[field]);
      if (bv !== av) console.log(`  changed ${field}: ${bv} -> ${av}`);
    }

    for (const [id, rev] of Object.entries(b.revisions)) {
      if (!a.revisions[id]) note(`revision ${id} disappeared`);
      else if (JSON.stringify(a.revisions[id]) !== JSON.stringify(rev)) {
        note(`revision ${id} was rewritten`);
      }
    }
    const addedRevisions = Object.keys(a.revisions).filter(
      (id) => !b.revisions[id],
    );
    console.log(
      `  revisions: ${Object.keys(b.revisions).length} -> ${Object.keys(a.revisions).length} (+${addedRevisions.length} new)`,
    );

    for (const [id, edge] of Object.entries(b.edges)) {
      const now = a.edges[id];
      if (!now) note(`edge ${id} disappeared`);
      else if (now.published !== edge.published) {
        note(`edge ${id} published: ${edge.published} -> ${now.published}`);
      }
    }
    const addedEdges = Object.keys(a.edges).filter((id) => !b.edges[id]);
    console.log(
      `  edges: ${Object.keys(b.edges).length} -> ${Object.keys(a.edges).length} (+${addedEdges.length} new)`,
    );
  }

  console.log(`\n${problems === 0 ? "nothing lost" : `${problems} losses`}`);
}
