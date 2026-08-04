import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** The logged in toolbar (Rewizje, Nowy bug w GitHubie, ...) does not fit on a
 * phone. Vuetify clips `.v-toolbar__content`, which used to leave the trailing
 * buttons unreachable - no scrolling, no overflow menu. The layout now lets
 * that strip scroll sideways, so the test asserts both halves of the fix: the
 * content really does overflow, and it can be scrolled to the last button. */

const PHONE = { width: 320, height: 700 };

test.describe("Logged in toolbar on a phone", () => {
  test.use({ viewport: PHONE });

  test("overflowing buttons can be scrolled into view", async ({ page }) => {
    // As an admin, whose toolbar carries five buttons rather than two. It used
    // to register a fresh non-admin, on the grounds that even two overflowed
    // 320px - which stopped being true when the root font size came down to
    // 14px. The admin strip is the one that overflows, and the one this is
    // about; leaning on a width the type scale can drift past again is what
    // made the assertion below quietly stop meaning anything.
    await logIn(page, USERS.admin);

    const content = page.locator(".user-toolbar .v-toolbar__content");
    await expect(content).toBeVisible();

    // Without overflow the rest of the test would pass vacuously.
    const { scrollWidth, clientWidth } = await content.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);

    await expect(content).toHaveCSS("overflow-x", /auto|scroll/);

    // The last button starts off screen and becomes reachable after scrolling.
    const lastButton = page.locator(".user-toolbar .v-btn").last();
    await lastButton.scrollIntoViewIfNeeded();

    const scrolled = await content.evaluate((el) => el.scrollLeft);
    expect(scrolled).toBeGreaterThan(0);

    const box = await lastButton.boundingBox();
    const contentBox = await content.boundingBox();
    expect(box).not.toBeNull();
    expect(contentBox).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(contentBox!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      contentBox!.x + contentBox!.width + 1,
    );

    // The strip must not have grown a vertical scrollbar or spilled over the
    // page - the fix is horizontal only.
    await expect(content).toHaveCSS("overflow-y", "hidden");
  });
});
