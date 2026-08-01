import { test, expect } from "@playwright/test";

/** `settled` is what has to be on the page before it is worth capturing, for
 * the pages that draw themselves from an api response rather than from the
 * document the server sent. `viewports` narrows a page to some of the projects,
 * for the ones a phone-sized shot says nothing about. */
const pages: {
  name: string;
  path: string;
  settled?: (string | RegExp)[];
  viewports?: string[];
}[] = [
  { name: "home", path: "/" },
  { name: "login", path: "/login" },
  { name: "zrodla", path: "/zrodla" },
  { name: "o-nas", path: "/o-nas" },
  { name: "pomoc", path: "/pomoc" },
  // Not a page: the path is deliberately unroutable, so this captures
  // app/error.vue's 404 branch. Keep it single-segment - two segments would
  // match pages/[seoType]/[slug].vue and render an entity instead.
  { name: "not-found", path: "/nie-ma-takiej-strony" },
  {
    // A place's page is the table filtered to it. `chain-company` is the seeded
    // institution with no KRS number, so this is where the identifiers a
    // ministry, an urząd or a wojewódzki fundusz does have - REGON and NIP -
    // are actually drawn.
    name: "instytucja",
    path: "/eksploruj/tabela?place=chain-company",
    // Rendered entirely client side, so none of it exists until two separate
    // responses have arrived: the place list the card is drawn from, and the
    // people the table is filtered to. Capturing before both leaves a card
    // with no identifiers and a table still spinning.
    settled: [/REGON:\s*123456785/, "Osoba Testowa"],
    // Desktop only. The table's ten columns cannot fit a phone, so the page
    // scrolls sideways and a fullPage shot comes out 1180px wide - most of it
    // the closed end-drawer sitting off canvas, with the card and its
    // identifiers behind it. It captures the overflow, not this page.
    viewports: ["visual-desktop"],
  },
];

for (const { name, path, settled, viewports } of pages) {
  test(name, async ({ page }, testInfo) => {
    test.skip(
      !!viewports && !viewports.includes(testInfo.project.name),
      `captured only in ${viewports?.join(", ")}`,
    );
    await page.goto(path);
    await page.locator(".v-main").waitFor();
    for (const text of settled ?? []) {
      await page.getByText(text).first().waitFor({ timeout: 30_000 });
    }
    // Images below the fold are lazy-loaded, so a fullPage screenshot would
    // otherwise request them mid-capture and keep growing the page height
    // (see /o-nas). Scroll through the page to trigger them, then wait until
    // they have all settled.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
        window.scrollTo(0, y);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      window.scrollTo(0, 0);
    });
    await page.evaluate(() => document.fonts.ready);
    await page
      .waitForFunction(
        () => Array.from(document.images).every((img) => img.complete),
        undefined,
        { timeout: 10_000 },
      )
      // An image that never settles is not worth failing on here —
      // toHaveScreenshot retries until two consecutive captures match.
      .catch(() => {});
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      timeout: 20_000,
    });
  });
}
