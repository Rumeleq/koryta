import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** The phone app bar: a magnifier that hands the whole bar to the search, and
 * an overflow menu carrying the links the bar only draws in full above 960px.
 *
 * Both are decided in CSS rather than by `useDisplay`, because the bar is
 * server rendered - so what this spec is really checking is that the media
 * queries in `app/layouts/default.vue` match the breakpoint the rest of the bar
 * uses, in a real browser at a real width.
 */
const PHONE = { width: 390, height: 780 };
const DESKTOP = { width: 1280, height: 800 };

/** Presses `control` until `settled` is on screen.
 *
 * The same hydration race the omni search helpers ride out, and for the same
 * reason: the whole bar is in the server's markup before Vue has attached a
 * single listener to it, so against the dev server a first click can land on an
 * inert button and do nothing at all. Retrying only while the thing it opens is
 * still shut means a live button is never clicked twice.
 */
async function pressUntil(control: Locator, settled: Locator) {
  await expect(async () => {
    if (!(await settled.isVisible())) await control.click();
    await expect(settled).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}

/** Waits for the bar to be live before anything is asked of it. */
async function loadBar(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator(".v-main")).toBeVisible({ timeout: 30_000 });
}

test.describe("Pasek u góry na telefonie", () => {
  test.use({ viewport: PHONE });

  test("hides the search field behind a magnifier", async ({ page }) => {
    await loadBar(page, "/zrodla");

    const field = page.locator("input#omni-search");
    const magnifier = page.getByTestId("app-bar-search-open");

    await expect(magnifier).toBeVisible();
    await expect(field).toBeHidden();

    await pressUntil(magnifier, field);

    await expect(field).toBeFocused();
    // The bar is the search now, so what it displaced is gone with it.
    await expect(magnifier).toBeHidden();
    await expect(page.getByTestId("app-bar-nav")).toBeHidden();

    await page.getByTestId("app-bar-search-close").click();

    await expect(field).toBeHidden();
    await expect(magnifier).toBeVisible();
  });

  /** The home page sets `hideSearch`, which used to mean no search in the bar
   * at all - and its own field scrolls away, so a phone reader who had scrolled
   * had no way to search from anywhere on the site's most visited page.
   *
   * `#omni-search-bar` rather than `#omni-search`: the home page's own field is
   * the canonical one, and the bar's takes the other id so that the two never
   * collide while both are on screen. */
  test("offers the magnifier on the home page too", async ({ page }) => {
    await loadBar(page, "/");

    const barField = page.locator("input#omni-search-bar");

    // The page's own field is the only one until the magnifier is pressed.
    await expect(barField).toHaveCount(0);
    await expect(page.getByTestId("app-bar-search-open")).toBeVisible();

    await pressUntil(page.getByTestId("app-bar-search-open"), barField);
    await expect(barField).toBeFocused();
  });

  test("carries the navigation the footer used to have to itself", async ({
    page,
  }) => {
    await loadBar(page, "/");

    // None of the three text buttons the desktop bar draws. Scoped to the bar
    // because the footer carries the same links, and does so at every width.
    await expect(
      page.locator("header").getByRole("link", { name: "Działaj z nami" }),
    ).toHaveCount(0);

    const menu = page.locator(".v-overlay--active .v-list");
    await pressUntil(page.getByTestId("app-bar-nav"), menu);

    await expect(menu.getByText("Tematy")).toBeVisible();
    await expect(menu.getByText("Źródła")).toBeVisible();
    await expect(menu.getByText("O nas")).toBeVisible();

    await menu.getByText("Działaj z nami").click();
    await page.waitForURL(/\/pomoc$/);
  });
});

test.describe("Pasek u góry na szerokim ekranie", () => {
  test.use({ viewport: DESKTOP });

  test("draws the field and the links, not the phone controls", async ({
    page,
  }) => {
    await loadBar(page, "/zrodla");

    await expect(page.locator("input#omni-search")).toBeVisible();
    await expect(page.getByTestId("app-bar-search-open")).toBeHidden();
    await expect(page.getByTestId("app-bar-nav")).toBeHidden();
    await expect(
      page.locator("header").getByRole("link", { name: "Tematy" }),
    ).toBeVisible();
  });
});
