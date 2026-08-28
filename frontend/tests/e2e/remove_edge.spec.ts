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

/** A stamp per run, so a rerun never collides with the last one and the suite's
 * `fullyParallel` workers never read each other's fixtures. */
const stamp = Date.now();

/** No hyphens in a node id. A readable url is `/osoba/<slug>-<id>` and the page
 * takes the id to be the last dash-separated segment, so `rm-person-123` would
 * be read back as `123`. Edge ids never reach a url and may keep theirs. */
const ids = {
  worker: `rmworker${stamp}`,
  friend: `rmfriend${stamp}`,
  company: `rmcompany${stamp}`,
};
const edges = {
  job: `rm-edge-job-${stamp}`,
  friendship: `rm-edge-friendship-${stamp}`,
  colleague: `rm-edge-colleague-${stamp}`,
};

/** Three pages and three relations of this spec's own.
 *
 *   worker ──(job)────────── company     the relation the admin removes
 *   worker ──(friendship)─── friend      must survive it
 *   friend ──(colleague)──── company     keeps the company page populated
 *
 * Its own, and not the seeded Jan Kowalski, because removing a relation is
 * destructive and the seed is shared: entity_page, local_graph, explore_person
 * and home_recent_employments all assert on Jan Kowalski's job at Orlen, and
 * `npm run seed` runs once per dev server rather than once per spec. Written
 * with `set`, so a retry restores the fixture rather than finding it already
 * removed.
 */
async function seed() {
  const batch = db.batch();

  const page = (name: string, type: "person" | "place") => ({
    name,
    type,
    revision_id: `rev-${stamp}`,
    published: true,
    stats: { isApproved: true, nodeGroupSize: 1 },
  });

  batch.set(
    db.collection("nodes").doc(ids.worker),
    page(`Usuwany Pracownik ${stamp}`, "person"),
  );
  batch.set(
    db.collection("nodes").doc(ids.friend),
    page(`Znajomy Pracownika ${stamp}`, "person"),
  );
  batch.set(
    db.collection("nodes").doc(ids.company),
    page(`Spolka Usuwana ${stamp}`, "place"),
  );

  batch.set(db.collection("edges").doc(edges.job), {
    source: ids.worker,
    target: ids.company,
    type: "employed",
    name: "Zarzad",
    start_date: "2019-03-01",
    end_date: "2024-04-12",
    published: true,
  });
  batch.set(db.collection("edges").doc(edges.friendship), {
    source: ids.worker,
    target: ids.friend,
    type: "connection",
    name: `znajomosc-${stamp}`,
    published: true,
  });
  batch.set(db.collection("edges").doc(edges.colleague), {
    source: ids.friend,
    target: ids.company,
    type: "employed",
    name: "Rada Nadzorcza",
    published: true,
  });

  await batch.commit();
}

test.describe("Removing a relation", () => {
  // Per test, not per file. This spec destroys what it reads, so a retry, a
  // `--repeat-each`, or a second local run against a still-running dev server
  // would otherwise start from a fixture the previous attempt already removed
  // and fail on its first assertion, blaming the wrong step. `set` overwrites
  // the whole document, so re-seeding clears `deleted` rather than layering
  // over it.
  test.beforeEach(async () => {
    await seed();
  });

  test("an admin removes one and it stays gone at both ends", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await logIn(page, USERS.admin, `/entity/person/${ids.worker}`);

    const rows = page.getByTestId("relations-history").locator(".history-row");
    const job = rows.filter({ hasText: `Spolka Usuwana ${stamp}` });
    await expect(job).toBeVisible({ timeout: 30_000 });

    await job.getByTestId(`edge-remove-${edges.job}`).click();

    const dialog = page.getByTestId("remove-edge-dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    // Which relation is going, not just an id - the whole point of the caption.
    await expect(dialog).toContainText(`Usuwany Pracownik ${stamp}`);
    await expect(dialog).toContainText(`Spolka Usuwana ${stamp}`);

    // The reason is the only record of why the relation went, so there is no
    // removing one without it.
    const confirm = dialog.getByTestId("remove-edge-confirm");
    await expect(confirm).toBeDisabled();
    // `.first()`: an auto-grow v-textarea renders a second, aria-hidden textarea
    // beside the real one to measure the height against, and a bare locator
    // matches both.
    await dialog
      .getByTestId("remove-edge-reason")
      .locator("textarea")
      .first()
      .fill("Blednie scalona osoba");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(job).toBeHidden({ timeout: 30_000 });
    // The person's other relation is untouched.
    await expect(
      rows.filter({ hasText: `Znajomy Pracownika ${stamp}` }),
    ).toBeVisible();

    // Really stored, not spliced out of the list in the browser.
    await page.reload();
    await expect(page.getByTestId("relations-history")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      rows.filter({ hasText: `Spolka Usuwana ${stamp}` }),
    ).toHaveCount(0);

    // And gone from the company's side of the same relation - a different page,
    // with a detail view of its own, reading the same edge.
    await page.goto(`/entity/place/${ids.company}`);
    await expect(page.getByTestId("relations-history")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(`Usuwany Pracownik ${stamp}`)).toHaveCount(0);
    // Its other employee is still listed, and removable from this end too, so
    // an admin who spots a bad relation on the company is not sent to the
    // person to clear it.
    await expect(
      page.getByTestId(`edge-remove-${edges.colleague}`),
    ).toBeVisible();
  });

  test("a reader who is not an admin is offered no removal", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await logIn(page, USERS.normal, `/entity/person/${ids.friend}`);

    // Signed in, so the rows and their source buttons are there - it is only
    // the removal that is not.
    await expect(page.getByTestId("relations-history")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByTitle("Dodaj źródło powiązania").first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid^="edge-remove-"]')).toHaveCount(0);
  });
});
