import { test, expect } from "@playwright/test";
import { waitForLoginFormHydrated } from "./helpers/login";

test.describe("Suggest node edits", () => {
  test("User can suggest an edit and admin can see it", async ({ page }) => {
    test.setTimeout(60000); // This test goes through a long flow
    // 1. Go to login page
    await page.goto("/login");

    // Wait for Vue hydration to complete before interacting
    await waitForLoginFormHydrated(page);

    // 2. Switch to register mode
    await page.locator("text=Nie masz konta? Zarejestruj się").click();
    await expect(page.locator('button:has-text("Stwórz konto")')).toBeVisible();

    // 3. Fill credentials
    const timestamp = Date.now();
    await page.locator("input#email").fill(`edituser${timestamp}@example.com`);
    await page.locator("input#password").fill("password123");

    // Handle the alert window that says "Wysłano email weryfikacyjny"
    page.on("dialog", (dialog) => dialog.accept());

    // 4. Submit registration
    await page.locator('button:has-text("Stwórz konto")').click();

    // Wait for the redirect from login page to home
    await page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 15000,
    });

    // Wait for the user avatar to appear
    await page.waitForSelector(
      'a[href="/profil"], button[to="/profil"], .v-avatar',
      { timeout: 15000 },
    );

    // 5. Navigate to a page with people
    await page.goto("/lista");

    // Wait for the list of people to load
    await page.waitForSelector(".v-card");

    // Find the first person link and click it
    const firstPersonCard = page
      .locator(".v-card[href^='/entity/person/']")
      .first();
    // /admin/rewizje/:id is keyed on the node, so remember which one this is
    // rather than going hunting for it in the list later.
    const nodeId = (await firstPersonCard.getAttribute("href"))!.split("/")[3]!;
    await firstPersonCard.click();

    // Wait to navigate to the person page (which might redirect to /osoba/...)
    await page.waitForSelector("h2.text-h5", { timeout: 15000 });

    // 6. Wait for the propose edit button
    const proposeEditButton = page.locator(
      'button:has-text("Zaproponuj zmianę")',
    );
    await expect(proposeEditButton).toBeVisible();

    // The page may still be mid-hydration - the button is in the markup but
    // Vue hasn't attached its listener yet, so the click is silently dropped
    // (`force` skips the actionability wait that would otherwise hide this).
    // Retry until the dialog actually opens.
    const dialog = page.locator(".v-dialog");
    await expect(async () => {
      if (await dialog.isVisible()) return;
      await proposeEditButton.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });

    // Fill the new content
    const newContent = `Testowa edycja contentu ${timestamp}`;
    await page.getByLabel("Treść (opcjonalnie)").fill(newContent);

    // Submit edit
    await page.locator('.v-dialog button:has-text("Zaproponuj")').click();

    // Wait for dialog to close
    await page.waitForSelector(".v-dialog", { state: "hidden" });

    // 7. Read the edit back on the node's revisions page.
    //
    // Addressed by node rather than by walking /admin/rewizje and clicking the
    // first row: that list is not ordered by recency, so "first row" was the
    // seeded revision as often as not. The retry is for onRevisionWritten -
    // the revision only joins the node's map once that Cloud Function has run,
    // and there is no event to wait for from here.
    await expect(async () => {
      await page.goto(`/admin/rewizje/${nodeId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.locator(`.comparison-table:has-text("${newContent}")`),
      ).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 60_000 });
  });
});
