import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "../e2e/helpers/auth";

/** The verification progress bar, which nothing else in this suite draws.
 *
 * It used to be on /eksploruj/tabela for everybody, so the three table
 * captures in pages.spec.ts carried it by accident. Now that it is shown only
 * to a signed-in reader those captures no longer contain it, and the other
 * page that has one - /eksploruj/nowe - is behind the auth middleware. Without
 * this spec the bar has no picture anywhere.
 *
 * One element rather than a full page: the bar sits above a table whose rows
 * arrive separately, and a fullPage shot would be comparing the table.
 */

/** Everything that has to have arrived before a shot is worth taking. */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

/** The bar, once it is showing figures rather than its skeleton.
 *
 * Two fetches fill it and neither is server rendered: the breakdown by status
 * that the stacked bar is drawn from, and the reader's own contribution counts
 * along the bottom. Capturing after only the first leaves a bar with a blank
 * line under the divider. */
async function readyBar(page: Page) {
  const bar = page.getByTestId("explore-progress");
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await expect(bar.getByText(/sprawdzono \d+ z/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(bar.getByText("Twój wkład:")).toBeVisible({ timeout: 30_000 });
  await settled(page);
  return bar;
}

test.describe("Postęp weryfikacji", () => {
  test("postep-weryfikacji", async ({ page }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.normal, "/eksploruj/tabela");

    const bar = await readyBar(page);

    // Clipped to the viewport rather than shot as an element.
    //
    // The bar is a block in a page the table makes wider than the screen - ten
    // columns at 1280px come to 1456 - so it stretches to the table's scroll
    // width. An element shot of it is both cut off at the right, losing the
    // "Pomóż sprawdzać" button this variant exists to show, and pinned to a
    // width that any change to a table column would move, failing this
    // screenshot for a reason that has nothing to do with the bar.
    //
    // What the clip captures is what a reader sees: the bar from its left edge
    // out to the right edge of the window.
    const box = (await bar.boundingBox())!;
    const view = page.viewportSize()!;
    await expect(page).toHaveScreenshot("postep-weryfikacji.png", {
      clip: {
        x: box.x,
        y: box.y,
        width: Math.min(box.width, view.width - box.x),
        height: box.height,
      },
    });
  });

  test("postep-weryfikacji-nowe", async ({ page }) => {
    test.setTimeout(120_000);
    // The `hide-cta` variant. "Pomóż sprawdzać" leads to this very page, so
    // the button is dropped here and the bar is a different shape for it -
    // which is the reason this is a second shot rather than the same one.
    await logIn(page, USERS.normal, "/eksploruj/nowe");

    const bar = await readyBar(page);
    await expect(
      bar.getByRole("link", { name: "Pomóż sprawdzać" }),
    ).toHaveCount(0);
    await expect(bar).toHaveScreenshot("postep-weryfikacji-nowe.png");
  });
});
