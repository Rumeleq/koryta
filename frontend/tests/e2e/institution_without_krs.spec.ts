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

  // Named on the query bar, so it can be seen and cleared like any other
  // filter. It used to be a chip inside the always-open „Instytucje”
  // autocomplete; that control is behind the „Filtry” button now and is not in
  // the dom until the panel is opened, and the rail is what stands in for it.
  // Scoped to the rail because the table's own „Firmy” column draws a chip
  // with this same name on every matching row.
  await expect(
    page.locator(".tabela-query-bar__rail .v-chip", {
      hasText: "Firma Testowa",
    }),
  ).toBeVisible({ timeout: 30_000 });

  // ...and given the summary card that is a place's page on this site. Located
  // by the REGON rather than by the name: the card sits below the table now,
  // and the table's own card carries the company's name on every row, so
  // `.first()` on the name would answer with the table.
  const card = page.locator(".v-card", { hasText: "REGON: 123456785" }).first();
  await expect(card).toContainText("Firma Testowa");
  await expect(card).toBeVisible();
  // Named by the registers it *is* in. KRS has no entry for a ministry, an
  // urząd or a wojewódzki fundusz, so REGON and NIP are all a reader has to
  // check who the institution is.
  await expect(card).toContainText("REGON: 123456785");
  await expect(card).toContainText("NIP: 5260250274");
  await expect(card).not.toContainText("KRS:");
  // Nothing is known about who owns it, and the card says exactly that rather
  // than calling it private on the register's behalf.
  await expect(card).toContainText("Właściciel nieustalony");
});
