import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** What "trzeba przescrollować 3 razy, żeby coś można było zobaczyć" means as
 * something a test can hold: on a phone the first row of the table has to be
 * within reach of the top of the page, and the page must not scroll sideways.
 *
 * Measured rather than screenshotted, because the number is the complaint. On
 * koryta.pl at 375x667 the first row sat 1316px down - two screens of heading,
 * login banner and six stacked filter selects - and the document was 5px wider
 * than the viewport.
 */
const PHONE = { width: 375, height: 667 };

/** One screen of chrome above the table is fair: the heading and the filter
 * button have to go somewhere. Two is what the report was about. */
const MAX_ROW_OFFSET = PHONE.height + 250;

test.describe("the table on a phone", () => {
  test.use({ viewport: PHONE });

  test("opens near the table and does not scroll sideways", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.goto("/eksploruj/tabela", { waitUntil: "load" });
    await expect(
      page.locator("tbody tr:first-child .text-primary.cursor-pointer").first(),
    ).toBeVisible({ timeout: 60000 });

    const { firstRowOffset, scrollWidth, clientWidth } = await page.evaluate(
      () => {
        const row = document.querySelector("tbody tr");
        return {
          firstRowOffset: row
            ? Math.round(row.getBoundingClientRect().top + window.scrollY)
            : Number.POSITIVE_INFINITY,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      },
    );

    expect(firstRowOffset).toBeLessThan(MAX_ROW_OFFSET);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("keeps the filters one tap away, and says when they are on", async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.goto("/eksploruj/tabela?party=PiS", { waitUntil: "load" });

    // The count is the point: a folded panel that is quietly narrowing the
    // table would leave the reader with a short list and no reason for it.
    const toggle = page.getByRole("button", { name: /^Filtry/ });
    await expect(toggle).toBeVisible({ timeout: 60000 });
    await expect(toggle).toHaveText(/Filtry \(1\)/);

    // Folded to begin with, and the filters are there once it is tapped.
    // Exact: the autocomplete also renders a "Clear Partia" icon button, and
    // a loose match picks up both.
    const party = page.getByLabel("Partia", { exact: true });
    await expect(party).toBeHidden();
    await toggle.click();
    await expect(party).toBeVisible();
  });

  // Absence, which is what the reports asked for and what a screenshot states
  // only by omission. The bar counts how much of the base has been checked and
  // links to the screen where checking happens; a reader who is not signed in
  // can act on neither, and on a phone it took most of the space above the
  // first row. The signed-in half is here too, so that "hidden" cannot be
  // passed by a bar that stopped rendering for everybody.
  test("shows the progress bar only once signed in", async ({ page }) => {
    test.setTimeout(120000);
    const bar = page.getByTestId("explore-progress");

    await page.goto("/eksploruj/tabela", { waitUntil: "load" });
    await expect(
      page.locator("tbody tr:first-child .text-primary.cursor-pointer").first(),
    ).toBeVisible({ timeout: 60000 });
    await expect(bar).toHaveCount(0);

    await logIn(page, USERS.normal, "/eksploruj/tabela");
    await expect(bar).toBeVisible({ timeout: 60000 });
  });
});
