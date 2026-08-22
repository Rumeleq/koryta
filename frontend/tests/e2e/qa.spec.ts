import { test, expect } from "@playwright/test";
import { logIn } from "./helpers/auth";
import { QA_ITEMS } from "../../shared/qa";

/** The newest entry is the one the page opens on, whatever it happens to be. */
const NEWEST = QA_ITEMS[0]!;

test.describe("QA changelog", () => {
  test("a contributor checks a change and reports what is wrong", async ({
    page,
  }) => {
    test.setTimeout(180_000); // Logs in, then writes to firestore

    // Lands straight on /qa, so the spec does not race a second navigation.
    await logIn(page, undefined, "/qa");

    const card = page.locator(`[data-qa-item="${NEWEST.id}"]`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(NEWEST.title);
    // An unchecked entry opens with its instructions showing.
    await expect(card).toContainText(NEWEST.steps[0]!);

    const feedback = `nie działa ${Date.now()}`;
    await card.getByLabel("Uwagi", { exact: false }).fill(feedback);
    await card.getByRole("button", { name: "Coś nie działa" }).click();

    await expect(page.getByText("Zapisane: zgłoszony problem")).toBeVisible({
      timeout: 30_000,
    });

    // Reported problems leave the default list and turn up under "Problemy".
    await expect(card).toBeHidden({ timeout: 30_000 });
    await page.getByRole("button", { name: "Problemy" }).click();
    await expect(card).toBeVisible();

    // The verdict is stored, not just held on the page. Reading it back waits
    // on firebase restoring the session, and until that lands the filter
    // buttons are markup with no listeners on them - a click on one would be
    // dropped and the page would sit on the default filter forever.
    await page.reload();
    await expect(page.locator('[data-qa-loaded="true"]')).toBeVisible({
      timeout: 60_000,
    });

    await page.getByRole("button", { name: "Problemy" }).click();
    await expect(card).toContainText("Twoja ocena: Coś nie działa", {
      timeout: 60_000,
    });
    // By label, not by tag: `auto-grow` renders a second, hidden textarea to
    // measure against, and a bare tag selector matches both.
    await expect(card.getByLabel("Uwagi", { exact: false })).toHaveValue(
      feedback,
    );
  });

  test("the toolbar counts what is left to check", async ({ page }) => {
    test.setTimeout(120_000);

    // Lands straight on /qa, so the spec does not race a second navigation.
    await logIn(page, undefined, "/qa");

    const qaButton = page.getByRole("link", { name: "QA" }).first();
    await expect(qaButton).toBeVisible({ timeout: 30_000 });
    // Nothing in a fresh emulator has been checked, so the badge counts them
    // all - a number, not an empty badge.
    await expect(qaButton).toContainText(/\d+/);
  });
});
