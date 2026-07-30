import { test, expect } from "@playwright/test";

/** The Cypress specs this replaces clicked three buttons on the entity page -
 * "Zaproponuj zmianę", "Zaproponuj usunięcie" and "Dodaj artykuł" - and
 * expected each to bounce a signed out visitor to /login. Only the first is
 * still on the page, and it no longer navigates: the activator opens a login
 * dialog in place (components/dialog/ProposeEditNode.vue, handleActivatorClick).
 * Same intent, asserted against what the app does now. */
test.describe("Proposing a change while signed out", () => {
  // Every Playwright test gets a fresh context, so this starts signed out.
  test("'Zaproponuj zmianę' asks you to log in first", async ({ page }) => {
    await page.goto("/osoba/jan-kowalski-1", { waitUntil: "domcontentloaded" });

    const propose = page.getByRole("button", { name: "Zaproponuj zmianę" });
    const dialog = page.locator(".v-dialog");

    // The page arrives server rendered, so the button is on screen before Vue
    // has attached its handler and an early click is dropped without a trace.
    await expect(async () => {
      if (await dialog.isVisible()) return;
      await propose.first().click({ force: true });
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });

    await expect(dialog.locator("input#email")).toBeVisible({
      timeout: 15_000,
    });

    // And it stays on the entity page rather than navigating away
    await expect(page).toHaveURL(/\/osoba\/jan-kowalski-1/);
  });
});
