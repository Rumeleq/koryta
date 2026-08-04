import { expect, type Page } from "@playwright/test";

/** One page worth capturing.
 *
 * `settled` is what has to be on the page before the shot is worth taking, for
 * the pages that draw themselves from an api response rather than from the
 * document the server sent. `mask` names the parts whose pixels are not the
 * same twice - a force-directed graph settles wherever it settles - and are
 * painted over rather than compared. `viewports` narrows a page to some of the
 * projects, for the ones a phone-sized shot says nothing about. */
export type VisualPage = {
  name: string;
  path: string;
  settled?: (string | RegExp)[];
  mask?: string[];
  viewports?: string[];
};

/** Waits for the page to stop moving, then compares it against `${name}.png`.
 *
 * Everything here is about the shot being the same twice: lazy images that only
 * load once scrolled past would otherwise keep growing the page height while
 * the capture is in flight, and a webfont that lands late reflows every line. */
export async function capture(page: Page, { name, settled, mask }: VisualPage) {
  await page.locator(".v-main").waitFor();
  for (const text of settled ?? []) {
    await page.getByText(text).first().waitFor({ timeout: 30_000 });
  }

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
    mask: (mask ?? []).map((selector) => page.locator(selector)),
  });
}
