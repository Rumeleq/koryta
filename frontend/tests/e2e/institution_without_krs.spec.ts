import { test, expect } from "@playwright/test";

/** Seeded place with no KRS number, standing in for a ministry or an urząd -
 * none of which are in the register. `chain-person` is its only employee. */
const INSTITUTION = "chain-company";

test("filters the table to an institution with no KRS number", async ({
  page,
}) => {
  // Companies used to be named by their KRS number everywhere - in the filter,
  // in the search results and in the url a place's page redirects to - so an
  // institution outside the register could not be picked at all, and opening
  // one landed on the unfiltered list of every person on the site.
  await page.goto(`/eksploruj/tabela?place=${INSTITUTION}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator(".v-main")).toBeVisible();

  // Selected in the filter, so it can be seen and cleared like any other
  await expect(
    page
      .locator(".v-autocomplete", { hasText: "Instytucje" })
      .locator(".v-chip__content"),
  ).toContainText("Firma Testowa", { timeout: 30_000 });

  // ...and given the summary card that is a place's page on this site
  const card = page.locator(".v-card", { hasText: "Firma Testowa" }).first();
  await expect(card).toBeVisible();
  // Nothing is known about who owns it, and the card says exactly that rather
  // than calling it private on the register's behalf.
  await expect(card).toContainText("Właściciel nieustalony");
});
