import { test, expect } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

/** What /zrodla's title column owes a long headline, asserted as geometry
 * rather than as pixels.
 *
 * The visual suite already screenshots this page and did not catch any of it:
 * `maxDiffPixelRatio` is 0.01, and recolouring every title and moving the date
 * column 88px measured 0.00898 - so the shot passed, and because
 * `--update-snapshots` only rewrites a baseline whose comparison failed, the
 * baseline silently kept describing a page that no longer existed. A tolerance
 * that wide cannot be the only guard on a table's layout.
 *
 * The seeded titles are all short, so the one that has to be clipped is seeded
 * here and removed again afterwards.
 */
const LONG_TITLE = `Bardzo dluga nazwa artykulu ktora nie miesci sie w kolumnie i musi zostac przycieta wielokropkiem zamiast zawijac sie do drugiej linii ${Date.now()}`;
const ID = `zrodla-long-title-${Date.now()}`;

const db = () =>
  getFirestore(
    getApps().length === 0
      ? initializeApp({ projectId: "demo-koryta-pl" })
      : getApp(),
    "koryta-pl",
  );

test.beforeAll(async () => {
  // Same shape as scripts/nodes.json's articles: without publishedDate the row
  // never appears, because /zrodla orders on it and Firestore drops documents
  // that lack the field.
  await db()
    .collection("nodes")
    .doc(ID)
    .set({
      name: LONG_TITLE,
      type: "article",
      sourceURL: "http://example-long-title.test",
      published: true,
      stats: { nodeGroupSize: 1, isApproved: true },
      publishedDate: new Date("2026-02-01T09:00:00.000Z"),
    });
});

test.afterAll(async () => {
  await db().collection("nodes").doc(ID).delete();
});

test("a long source title is clipped to its column, not wrapped", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/zrodla");

  // The table is stacked in the server-rendered markup and becomes columnar
  // once the client knows the width. The header only exists in the second of
  // those, so waiting for it is what keeps this off the pre-hydration layout.
  await page.locator("thead th").first().waitFor({ timeout: 30_000 });

  // `.first()` because the stacked markup the server sent is still in the DOM
  // alongside the columnar one it hydrated into, so the row matches twice.
  const link = page
    .locator('[data-testid="zrodla-article-link"]')
    .filter({ hasText: LONG_TITLE.slice(0, 40) })
    .first();
  await expect(link).toBeVisible({ timeout: 30_000 });

  const m = await link.evaluate((el) => {
    const td = el.closest("td") as HTMLElement;
    const tr = el.closest("tr") as HTMLElement;
    const table = td.closest("table") as HTMLElement;
    return {
      clipped: el.scrollWidth > el.clientWidth,
      rowHeight: Math.round(tr.getBoundingClientRect().height),
      gap: Math.round(
        td.getBoundingClientRect().right - el.getBoundingClientRect().right,
      ),
      titleShare:
        td.getBoundingClientRect().width / table.getBoundingClientRect().width,
      whiteSpace: getComputedStyle(el).whiteSpace,
      textOverflow: getComputedStyle(el).textOverflow,
    };
  });

  // Clipped rather than wrapped: one line, and more text than box to put it in.
  expect(m.whiteSpace).toBe("nowrap");
  expect(m.textOverflow).toBe("ellipsis");
  expect(m.clipped).toBe(true);
  expect(m.rowHeight).toBeLessThan(80);

  // And the column is capped, so what the title does not use goes to the
  // columns beside it instead of sitting as dead space before the date. Capping
  // the text alone left 295px of it here.
  expect(m.gap).toBeLessThan(48);
  expect(m.titleShare).toBeGreaterThan(0.4);
  expect(m.titleShare).toBeLessThan(0.7);
});

test("titles are one colour whether visited or not", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/zrodla");
  await page.locator("thead th").first().waitFor({ timeout: 30_000 });
  const link = page.locator('[data-testid="zrodla-article-link"]').first();
  await expect(link).toBeVisible({ timeout: 30_000 });

  const s = await link.evaluate((el) => {
    // The date beside it: plain table text, and so the colour a title is
    // supposed to match. `document.body` is not the comparison - the cell sets
    // its own on-surface colour and `inherit` picks that up, not the body's.
    const sibling = el.closest("tr")?.querySelectorAll("td")[1] as HTMLElement;
    return {
      color: getComputedStyle(el).color,
      decoration: getComputedStyle(el).textDecorationLine,
      siblingColor: getComputedStyle(sibling).color,
    };
  });

  // The colour of the text around it, not the brand sage (#a8c79f ==
  // rgb(168, 199, 159)), which is near 1.9:1 on white and unreadable as a run
  // of text. Pinned for :visited too, which is the point: a reader who has
  // opened a few rows should not find half the table repainted.
  expect(s.color).toBe(s.siblingColor);
  expect(s.color).not.toBe("rgb(168, 199, 159)");
  expect(s.decoration).toBe("none");
});
