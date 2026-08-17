import { test, expect } from "@playwright/test";

/** How a reader reaches an article's page at all.
 *
 * Until this link existed nothing in the app pointed at one: /zrodla sent the
 * title straight out to the publisher, and no other component linked there
 * either, so the page carrying the tag editor and the source composer could
 * only be reached by typing its url. The outbound link did not disappear - it
 * moved to the article's own page, next to the rest of what we know about it.
 */
test("the sources table opens our page for an article, not the publisher's", async ({
  page,
}) => {
  // The dev server compiles a route the first time it is asked for.
  test.setTimeout(120_000);

  await page.goto("/zrodla", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const link = page.getByTestId("zrodla-article-link").first();
  await expect(link).toBeVisible({ timeout: 30_000 });

  // An internal route, not an http(s) address on somebody else's domain.
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/artykul\//);

  await link.click();
  await expect(page).toHaveURL(/\/artykul\//, { timeout: 30_000 });

  // And the page it lands on is the article's, with the way out to the source
  // on it.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.locator('a[target="_blank"][rel="noopener"]').first(),
  ).toBeVisible({ timeout: 30_000 });
});
