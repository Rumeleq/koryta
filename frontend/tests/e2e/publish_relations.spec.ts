import { test, expect } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logIn, USERS } from "./helpers/auth";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "demo-koryta-pl";

const app =
  getApps().length === 0
    ? initializeApp({ projectId: "demo-koryta-pl" })
    : getApp();
const db = getFirestore(app, "koryta-pl");

/** A stamp per run, so specs that run in parallel never read each other's
 * fixtures and a rerun never collides with the last one. */
const stamp = Date.now();
const ids = {
  draft: `pub-draft-${stamp}`,
  live: `pub-live-${stamp}`,
  other: `pub-other-${stamp}`,
  hidden: `pub-hidden-${stamp}`,
  cascadeA: `pub-cascade-a-${stamp}`,
  cascadeB: `pub-cascade-b-${stamp}`,
};

/** Six nodes and four relations, laid out to exercise every case the publish
 * rules have - and so that no spec depends on another having run, because the
 * suite is `fullyParallel`:
 *
 *   draft    ──(ready)──    live       the relation both ends of which go live
 *   draft    ──(blocked)──  hidden     the one whose other end stays a draft
 *   live     ──(queued)──   other      already publishable: belongs in the queue
 *   cascadeA ──(cascade)──  cascadeB   seeded live, to be taken down with a page
 */
async function seed() {
  const batch = db.batch();
  const node = (name: string, published: boolean) => ({
    name,
    type: "person" as const,
    revision_id: `rev-${stamp}`,
    published,
    stats: { isApproved: published },
  });

  batch.set(
    db.collection("nodes").doc(ids.draft),
    node(`Draft ${stamp}`, false),
  );
  batch.set(db.collection("nodes").doc(ids.live), node(`Live ${stamp}`, true));
  batch.set(
    db.collection("nodes").doc(ids.other),
    node(`Other ${stamp}`, true),
  );
  batch.set(
    db.collection("nodes").doc(ids.hidden),
    node(`Hidden ${stamp}`, false),
  );
  batch.set(
    db.collection("nodes").doc(ids.cascadeA),
    node(`CascadeA ${stamp}`, true),
  );
  batch.set(
    db.collection("nodes").doc(ids.cascadeB),
    node(`CascadeB ${stamp}`, true),
  );

  batch.set(db.collection("edges").doc(`edge-ready-${stamp}`), {
    source: ids.draft,
    target: ids.live,
    type: "connection",
    name: `gotowe-${stamp}`,
    published: false,
  });
  batch.set(db.collection("edges").doc(`edge-blocked-${stamp}`), {
    source: ids.draft,
    target: ids.hidden,
    type: "connection",
    name: `zablokowane-${stamp}`,
    published: false,
  });
  batch.set(db.collection("edges").doc(`edge-queued-${stamp}`), {
    source: ids.live,
    target: ids.other,
    type: "connection",
    name: `kolejka-${stamp}`,
    published: false,
  });
  batch.set(db.collection("edges").doc(`edge-cascade-${stamp}`), {
    source: ids.cascadeA,
    target: ids.cascadeB,
    type: "connection",
    name: `kaskada-${stamp}`,
    published: true,
  });

  await batch.commit();
}

test.describe("Publishing relations", () => {
  test.beforeAll(async () => {
    await seed();
  });

  test("an admin publishes a page and picks which relations go with it", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await logIn(page, USERS.admin, `/admin/rewizje/${ids.draft}`);

    await page.getByTestId("publish-toggle").click();

    const dialog = page.getByTestId("publish-node-dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });

    // Both relations are offered, but only the one whose other end is already
    // live may be ticked - that is the "gray them out" rule, on screen.
    const ready = dialog.getByTestId(
      `publish-relation-check-edge-ready-${stamp}`,
    );
    const blocked = dialog.getByTestId(
      `publish-relation-check-edge-blocked-${stamp}`,
    );
    await expect(ready.locator("input")).toBeEnabled();
    await expect(blocked.locator("input")).toBeDisabled();

    // "Select all" means "all the ones that can go", not "all of them".
    await dialog.getByTestId("publish-select-all").click();
    await expect(ready.locator("input")).toBeChecked();
    await expect(blocked.locator("input")).not.toBeChecked();

    await dialog.getByTestId("publish-confirm").click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    await expect
      .poll(
        async () => {
          const [node, edge] = await Promise.all([
            db.collection("nodes").doc(ids.draft).get(),
            db.collection("edges").doc(`edge-ready-${stamp}`).get(),
          ]);
          return [node.data()?.published, edge.data()?.published];
        },
        { timeout: 30_000 },
      )
      .toEqual([true, true]);

    // The blocked one is untouched: its other end is still a draft.
    const blockedDoc = await db
      .collection("edges")
      .doc(`edge-blocked-${stamp}`)
      .get();
    expect(blockedDoc.data()?.published).not.toBe(true);
  });

  test("the admin queue lists relations whose pages are both live, and publishes them", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await logIn(page, USERS.admin, "/admin/krawedzie");

    const row = page.getByRole("row", { name: new RegExp(`kolejka-${stamp}`) });
    await expect(row).toBeVisible({ timeout: 60_000 });

    // The one still waiting on a draft page must not be offered here.
    await expect(page.locator("body")).not.toContainText(
      `zablokowane-${stamp}`,
    );

    await row.getByRole("checkbox").check();
    await page.getByTestId("edges-publish-selected").click();

    await expect
      .poll(
        async () =>
          (
            await db.collection("edges").doc(`edge-queued-${stamp}`).get()
          ).data()?.published,
        { timeout: 30_000 },
      )
      .toBe(true);

    // Published, so it drops out of the queue it was in.
    await expect(page.locator("body")).not.toContainText(`kolejka-${stamp}`, {
      timeout: 30_000,
    });
  });

  test("hiding a page hides the relations that lean on it", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await logIn(page, USERS.admin, `/admin/rewizje/${ids.cascadeA}`);

    // Both this page and the one at the other end are live, and so is the
    // relation between them. Hiding this one has to take the relation down
    // too, or the graph keeps an edge pointing at a page nobody can open.
    await page.getByTestId("publish-toggle").click();

    await expect
      .poll(
        async () => {
          const [node, edge] = await Promise.all([
            db.collection("nodes").doc(ids.cascadeA).get(),
            db.collection("edges").doc(`edge-cascade-${stamp}`).get(),
          ]);
          return [node.data()?.published, edge.data()?.published];
        },
        { timeout: 30_000 },
      )
      .toEqual([false, false]);

    // The page at the other end is not touched - it is still a perfectly good
    // page, it just has one fewer relation on it.
    const other = await db.collection("nodes").doc(ids.cascadeB).get();
    expect(other.data()?.published).toBe(true);
  });
});
