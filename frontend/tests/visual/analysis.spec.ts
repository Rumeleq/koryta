import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "../e2e/helpers/auth";

/** The analysis scripts/seed-emulator.ts writes, at a fixed id with fixed
 * timestamps so these baselines do not move day to day. */
const ANALYSIS_ID = "seeded-analysis";

/** The same settling the rest of the visual suite does before capturing: fonts
 * loaded, images decoded, nothing still arriving. */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page
    .waitForFunction(
      () => Array.from(document.images).every((img) => img.complete),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => {});
}

test.describe("Analiza", () => {
  // Both pages print dates with `toLocaleString("pl-PL")`, which takes its
  // offset from the machine. The seeded timestamps are UTC, so without pinning
  // this a baseline made here reads 09:04 and the same page in CI - or on the
  // author's laptop - reads 10:04 and the shot fails for no reason.
  test.use({ timezoneId: "Europe/Warsaw" });

  test("analiza-lista", async ({ page }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.normal, "/eksploruj/analiza");

    await expect(page.getByTestId("analysis-card")).toHaveCount(1, {
      timeout: 30_000,
    });
    await settle(page);

    await expect(page).toHaveScreenshot("analiza-lista.png", {
      fullPage: true,
      timeout: 20_000,
    });
  });

  test("analiza", async ({ page }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.normal, `/eksploruj/analiza/${ANALYSIS_ID}`);

    // The three seeded entities are the last thing the panel draws, so their
    // arrival is what says the document has been read and rendered.
    await expect(page.getByTestId("analysis-entity-row")).toHaveCount(3, {
      timeout: 30_000,
    });
    await expect(
      page.getByTestId("analysis-relation-row").filter({ hasText: "szwagier" }),
    ).toBeVisible({ timeout: 30_000 });
    await settle(page);

    await expect(page).toHaveScreenshot("analiza.png", {
      // The graph is laid out by a d3 force simulation, which settles somewhere
      // slightly different every run - the pixels inside it are not a thing a
      // baseline can assert. Masking it keeps the shot to what is stable and
      // still covers the bug this page has actually had: the mask is painted
      // over the pane's own box, so if the graph collapses to a narrow strip
      // again, or stops filling the height, the screenshot changes.
      mask: [page.locator(".analysis-page__graph")],
      maskColor: "#e0e0e0",
      timeout: 20_000,
    });
  });

  test("analiza-szczegoly", async ({ page }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.normal, `/eksploruj/analiza/${ANALYSIS_ID}`);

    await expect(page.getByTestId("analysis-entity-row")).toHaveCount(3, {
      timeout: 30_000,
    });
    // Jan Kowalski, the entity the seeded note hangs off. Selecting him from
    // the list rather than from the graph keeps this off the simulation.
    await page
      .getByTestId("analysis-entity-row")
      .filter({ hasText: "Jan Kowalski" })
      .click();

    await expect(
      page.getByText("Rozmówca mówi, że to on prowadził negocjacje."),
    ).toBeVisible({ timeout: 30_000 });
    await settle(page);

    await expect(page).toHaveScreenshot("analiza-szczegoly.png", {
      mask: [page.locator(".analysis-page__graph")],
      maskColor: "#e0e0e0",
      timeout: 20_000,
    });
  });
});
