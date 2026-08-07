import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** v-network-graph draws labels as SVG text, which `getByText` will not find -
 * it reads innerText, and SVG elements have none. */
const label = (page: Page, name: string) =>
  page.locator("svg text").filter({ hasText: name });

/** Creates an analysis through the UI and lands on it. Returns its title, which
 * is unique per run so that a re-run does not pick up the previous one - the
 * emulator keeps whatever the last run wrote until it is reseeded. */
async function createAnalysis(page: Page, prefix: string) {
  const title = `${prefix} ${process.hrtime.bigint()}`;

  await page.goto("/eksploruj/analiza", { waitUntil: "domcontentloaded" });
  await page.getByTestId("analysis-new").click();
  await page.getByTestId("analysis-new-title").locator("input").fill(title);
  await page.getByTestId("analysis-new-save").click();

  await page.waitForURL(/\/eksploruj\/analiza\/.+/, { timeout: 30_000 });
  return title;
}

/** Types into the entity picker and takes the matching result.
 *
 * `term` is one word rather than the whole name on purpose: /api/search matches
 * against `nameChunksLower`, and the chunks the emulator's data carries are per
 * word - "Kowalski" finds him, "Jan Kowalski" finds nothing.
 *
 * The fill is retried as a whole, the way tests/e2e/add_relation.spec.ts does
 * it: the suite runs against the dev server, and until the picker has hydrated
 * a `fill` writes the DOM value without it reaching the component, so no search
 * is ever issued and no option appears. `exact` keeps it off the "Dodaj … do
 * bazy" row, which carries the same name.
 */
async function addEntity(page: Page, name: string, term: string) {
  const input = page.getByTestId("analysis-entity-picker").locator("input");
  const option = page.getByRole("option", { name, exact: true });

  await expect(async () => {
    await input.fill(term);
    await expect(option).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await option.click();

  await expect(
    page.getByTestId("analysis-entity-row").filter({ hasText: name }),
  ).toBeVisible({ timeout: 30_000 });
}

/** Picks a value in one of the two relation-end selects. */
async function pickEnd(page: Page, testId: string, name: string) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name, exact: true }).click();
}

test.describe("Analysis", () => {
  test.beforeEach(async ({ page }) => {
    await logIn(page, USERS.normal, "/eksploruj/analiza");
  });

  test("builds a scene from the base and draws it", async ({ page }) => {
    test.setTimeout(120_000); // The force directed layout takes a while to settle

    await createAnalysis(page, "Sprawa");

    await page.getByTestId("analysis-tab-scene").click();
    await addEntity(page, "Jan Kowalski", "Kowalski");

    await expect(label(page, "Jan Kowalski").first()).toBeVisible({
      timeout: 60_000,
    });
    // One hop by default, so his seeded employer comes along.
    await expect(label(page, "Orlen").first()).toBeVisible({ timeout: 60_000 });
  });

  test("records somebody who is not in the base, and a relation to them", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await createAnalysis(page, "Rozmowa");
    await page.getByTestId("analysis-tab-scene").click();
    await addEntity(page, "Jan Kowalski", "Kowalski");

    // The interview case: a name nobody has a page for yet.
    await page.getByTestId("analysis-add-local").click();
    await page
      .getByTestId("analysis-local-name")
      .locator("input")
      .fill("Kuzyn Zenek");
    await page.getByTestId("analysis-local-save").click();

    await expect(
      page
        .getByTestId("analysis-entity-row")
        .filter({ hasText: "Kuzyn Zenek" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(label(page, "Kuzyn Zenek").first()).toBeVisible({
      timeout: 60_000,
    });

    // ...and what the interviewee said about how the two are connected.
    await page.getByTestId("analysis-tab-scene").click();
    await pickEnd(page, "analysis-relation-source", "Jan Kowalski");
    await pickEnd(page, "analysis-relation-target", "Kuzyn Zenek");

    await page
      .getByTestId("analysis-relation-name")
      .locator("input")
      .fill("szwagier");
    await page
      .getByTestId("analysis-relation-note")
      .locator("textarea")
      .first()
      .fill("Tak twierdzi rozmówca z 5 sierpnia.");
    await page.getByTestId("analysis-relation-save").click();

    await expect(
      page.getByTestId("analysis-relation-row").filter({ hasText: "szwagier" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(label(page, "szwagier").first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test("shares with another account, which then sees it in its list", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);

    const title = await createAnalysis(page, "Wspólna");

    await page.getByTestId("analysis-share-open").click();
    await page
      .getByTestId("analysis-share-email")
      .locator("input")
      .fill(USERS.admin.email);
    await page.getByTestId("analysis-share-submit").click();

    // Listed by the display name the seed gives the account, which is what the
    // panel prefers over the address it was invited by.
    await expect(
      page.getByTestId("analysis-member-row").filter({ hasText: "Admin User" }),
    ).toBeVisible({ timeout: 30_000 });

    // The other account, in its own browser context so the two sessions do not
    // share auth state.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    try {
      await logIn(otherPage, USERS.admin, "/eksploruj/analiza");
      await expect(
        otherPage.getByTestId("analysis-card").filter({ hasText: title }),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await other.close();
    }
  });

  test("gives the graph the width the window has", async ({ page }) => {
    test.setTimeout(120_000);

    await page.setViewportSize({ width: 1600, height: 900 });
    await createAnalysis(page, "Szerokość");

    const graph = page.locator(".analysis-page__graph");
    const panel = page.locator(".analysis-page__panel");
    await expect(graph).toBeVisible();

    const graphBox = (await graph.boundingBox())!;
    const panelBox = (await panel.boundingBox())!;

    // The page used to render as a ~450px column against the left edge, with
    // the graph squeezed into ~190px of it, because `.v-container.fill-height`
    // in the default layout sizes a plain child to its content. The two panes
    // together have to span the window, and the graph has to be the larger.
    expect(graphBox.width + panelBox.width).toBeGreaterThan(1500);
    expect(graphBox.width).toBeGreaterThan(panelBox.width);
    expect(graphBox.x).toBeLessThan(10);

    // And it has to fill the height rather than sit centred in a short band -
    // `align-items: center` on that container is the other half of the bug.
    expect(graphBox.height).toBeGreaterThan(600);
    expect(graphBox.y).toBeLessThan(200);
  });

  test("refuses an address with no account here", async ({ page }) => {
    test.setTimeout(60_000);

    await createAnalysis(page, "Nieznany");

    await page.getByTestId("analysis-share-open").click();
    await page
      .getByTestId("analysis-share-email")
      .locator("input")
      .fill("nikt@example.com");
    await page.getByTestId("analysis-share-submit").click();

    await expect(
      page.getByText("Nie ma użytkownika o adresie nikt@example.com"),
    ).toBeVisible({ timeout: 30_000 });
  });
});
