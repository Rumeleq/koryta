import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** The Cypress specs this replaces drove a "Dodaj nowe" menu in the signed in
 * toolbar - "Dodaj artykuł", "Dodaj osobę", "Audyt". None of those entries
 * exist any more; the toolbar in layouts/default.vue offers Rewizje to
 * everyone and Admin plus Notatki to admins. The intent - the toolbar is for
 * signed in users, and it takes them where it says - ports over; the entries
 * themselves do not. */
const toolbar = "header .user-toolbar, .user-toolbar";

test.describe("User toolbar", () => {
  test("is hidden until you sign in", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(toolbar)).toHaveCount(0);

    await logIn(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(toolbar).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("'Rewizje' opens the revisions list", async ({ page }) => {
    await logIn(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const rewizje = page.locator(toolbar).getByRole("link", {
      name: "Rewizje",
    });

    // The toolbar renders as soon as auth resolves, but the link only routes
    // once Vue has attached it, so an early click navigates nowhere.
    await expect(async () => {
      await rewizje.first().click();
      await page.waitForURL(/\/admin\/rewizje/, { timeout: 2000 });
    }).toPass({ timeout: 30_000 });

    await expect(page.locator(".v-data-table")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("hides the admin entries from a normal user", async ({ page }) => {
    await logIn(page, USERS.normal);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const bar = page.locator(toolbar).first();
    await expect(bar).toBeVisible({ timeout: 30_000 });
    await expect(bar.getByRole("link", { name: "Rewizje" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "Admin" })).toHaveCount(0);
    await expect(bar.getByRole("link", { name: "Notatki" })).toHaveCount(0);
  });

  test("shows the admin entries to an admin", async ({ page }) => {
    await logIn(page, USERS.admin);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const bar = page.locator(toolbar).first();
    await expect(bar.getByRole("link", { name: "Admin" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(bar.getByRole("link", { name: "Notatki" })).toBeVisible();
  });
});
