import { test, expect } from "@playwright/test";

// The Cypress suite these come from also cross-checked the "Łącznie N" figure
// against /api/nodes. Both ends of that check are gone: the home page no longer
// carries a totals card, and app/composables/stats/useStats.ts returns
// constants rather than anything the api could disagree with.
test.describe("Home", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
  });

  test("displays at least four cards", async ({ page }) => {
    await expect
      .poll(() => page.locator(".v-card").count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(4);
  });

  test("the table card leads to the table", async ({ page }) => {
    const card = page.locator(".v-card").filter({ hasText: "TABELA POWIĄZAŃ" });
    await expect(card).toHaveAttribute("href", "/eksploruj/tabela");

    // The card is in the markup before Vue attaches its router link, so an
    // early click navigates nowhere. Retry until one takes.
    await expect(async () => {
      await card.click();
      await page.waitForURL(/\/eksploruj\/tabela/, { timeout: 2000 });
    }).toPass({ timeout: 30_000 });
  });

  test("the 'PRZEGLĄDAJ NOWE' card leads to the unpublished people", async ({
    page,
  }) => {
    const card = page.locator(".v-card").filter({ hasText: "PRZEGLĄDAJ NOWE" });
    await expect(card).toHaveAttribute("href", "/eksploruj/nowe");

    await expect(async () => {
      await card.click();
      await page.waitForURL(/\/eksploruj\/nowe/, { timeout: 2000 });
    }).toPass({ timeout: 30_000 });
  });

  test("the call to action leads to pomoc", async ({ page }) => {
    const cta = page.getByRole("link", { name: "Działaj z nami" }).first();
    await expect(cta).toHaveAttribute("href", "/pomoc");

    await expect(async () => {
      await cta.click();
      await page.waitForURL(/\/pomoc/, { timeout: 2000 });
    }).toPass({ timeout: 30_000 });
  });
});
