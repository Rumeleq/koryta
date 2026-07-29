import { test, expect } from "@playwright/test";
import { waitForLoginFormHydrated } from "./helpers/login";

/** A verdict has to move the queue on. "Błędny" used to hold the card and open
 * the comment box instead, which on a phone opens below the fold and so read as
 * a button that does nothing. */
test.describe("Kategoryzacja - werdykt", () => {
  test('"Błędny" moves on to the next card', async ({ page }) => {
    const target = "/ekstrakcje/kategoryzacja";
    await page.goto(`/login?redirect=${encodeURIComponent(target)}`);

    await waitForLoginFormHydrated(page);
    await page.locator("input#email").fill("admin@koryta.pl");
    await page.locator("input#password").fill("password123");
    await page.locator('button[type="submit"]').click({ force: true });

    await page.waitForURL("**/ekstrakcje/kategoryzacja**", { timeout: 15_000 });

    const quote = page.locator(".swipe-card .extraction-quote");
    await expect(quote).toBeVisible({ timeout: 15_000 });
    const judged = await quote.innerText();

    await page.getByRole("button", { name: "Błędny" }).click();

    // Whatever comes next - another fact or the end of the queue - the card
    // just judged must be off the screen.
    await expect(quote.filter({ hasText: judged })).toHaveCount(0, {
      timeout: 15_000,
    });
    // The comment box is opt-in, so a verdict must not have opened one.
    await expect(page.getByLabel("Komentarz (opcjonalny)")).toHaveCount(0);
  });
});
