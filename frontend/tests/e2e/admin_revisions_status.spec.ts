import { test, expect, type Page } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logIn, USERS } from "./helpers/auth";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

/** The "Status" filter on /admin/rewizje, which is how the queue is worked
 * through: everything the page is for is in the rows whose chip says "Nie".
 *
 * `latest_time` is a real Timestamp here rather than the `{_seconds}` map
 * admin_revisions.spec.ts writes. Firestore sorts a map above a timestamp, so
 * the map-valued node that spec seeds keeps the first row it reads while these
 * two sit below it - the two specs share a table and a default sort.
 */
const RUN = Date.now();
const WAITING = `000-oczekuje-${RUN}`;
const SETTLED = `000-zatwierdzony-${RUN}`;

const db = () =>
  getFirestore(
    getApps().length === 0
      ? initializeApp({ projectId: "demo-koryta-pl" })
      : getApp(),
    "koryta-pl",
  );

const node = (name: string, hasUnapproved: boolean) => ({
  name,
  type: "person",
  published: true,
  revisions: {
    total: 1,
    latest_time: Timestamp.now(),
    has_unapproved: hasUnapproved,
  },
});

test.beforeAll(async () => {
  await db().collection("nodes").doc(WAITING).set(node(WAITING, true));
  await db().collection("nodes").doc(SETTLED).set(node(SETTLED, false));
});

test.afterAll(async () => {
  await db().collection("nodes").doc(WAITING).delete();
  await db().collection("nodes").doc(SETTLED).delete();
});

/** Pick a value from the "Status" select above the table. `.first()` because
 * the footer's rows-per-page control is a `v-select` too. */
async function chooseStatus(page: Page, of: string) {
  await page.locator(".v-select").first().click();
  await page.getByRole("option", { name: of }).click();
}

test("the status filter narrows the list to what is still waiting", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, "/admin/rewizje");
  await page.waitForURL(/\/admin\/rewizje/, { timeout: 30_000 });
  await expect(page.getByText(WAITING).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(SETTLED).first()).toBeVisible();

  await chooseStatus(page, "Oczekujące na akceptację");

  await expect(page).toHaveURL(/status=unapproved/, { timeout: 30_000 });
  await expect(page.getByText(WAITING).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(SETTLED)).toHaveCount(0);

  // Every row on the page, not only the seeded one: the filter is a query the
  // server answers, so a row it let through that says "Tak" would mean the
  // column and the filter disagree about the same field.
  const chips = page.locator("tbody .v-chip");
  expect(await chips.count()).toBeGreaterThan(0);
  for (const chip of await chips.all()) {
    await expect(chip).toHaveText("Nie");
  }

  await chooseStatus(page, "W pełni zaakceptowane");

  await expect(page).toHaveURL(/status=approved/, { timeout: 30_000 });
  await expect(page.getByText(SETTLED).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(WAITING)).toHaveCount(0);
});
