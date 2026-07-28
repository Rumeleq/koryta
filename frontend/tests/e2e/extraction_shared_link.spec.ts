import { test, expect } from "@playwright/test";
import { waitForLoginFormHydrated } from "./helpers/login";

/** Seeded by scripts/seed-emulator.ts with `humanVoted: true`, so the review
 * queue - which asks the API for unreviewed facts only - never hands it out. */
const REVIEWED = {
  id: "seed-reviewed-employment",
  quote: "Fakt oceniony wczesniej przez innego recenzenta.",
};

test.describe("Kategoryzacja - udostepniony link", () => {
  test("opens a fact somebody has already reviewed", async ({ page }) => {
    const target = `/ekstrakcje/kategoryzacja?fact=${REVIEWED.id}`;
    await page.goto(`/login?redirect=${encodeURIComponent(target)}`);

    await waitForLoginFormHydrated(page);
    await page.locator("input#email").fill("admin@koryta.pl");
    await page.locator("input#password").fill("password123");
    await page.locator('button[type="submit"]').click({ force: true });

    await page.waitForURL("**/ekstrakcje/kategoryzacja**", { timeout: 15_000 });

    // The queue could only have offered an unreviewed fact, so this quote on
    // screen is the deep link's by-id fetch having reached past the filter.
    await expect(page.getByText(REVIEWED.quote)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(new RegExp(`fact=${REVIEWED.id}`));
  });
});
