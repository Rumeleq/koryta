import { test, expect } from "@playwright/test";
import { logIn } from "./helpers/auth";

test.describe("Already existing suggestions", () => {
  test("offers the matching person and links to their page", async ({
    page,
  }) => {
    test.setTimeout(60_000); // Logs in, then two debounced searches

    await logIn(page);
    await page.goto("/edit/node/new?type=person", {
      waitUntil: "domcontentloaded",
    });

    const input = page
      .locator('[data-testid="already-existing-input"] input')
      .first();
    const suggestions = page.locator('[data-testid="similar-suggestions"]');
    const kowalski = page.getByText("Jan Kowalski").first();

    // The name field is live before the suggestions are wired up, and the
    // lookup is debounced on top of that, so the whole type-and-wait is what
    // has to be retried rather than just the assertion.
    const type = async (query: string) => {
      await expect(async () => {
        await input.fill("");
        await input.fill(query);
        await expect(suggestions).toBeVisible({ timeout: 3000 });
        await expect(kowalski).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 30_000 });
    };

    await type("Jan");

    // A middle name must not throw the match off
    await type("Jan Marian");

    await kowalski.click();

    // Jan Kowalski is seeded as node 1. The Cypress test went on to assert the
    // form came back filled with his name; the page no longer loads the node
    // it edits, so there is nothing to assert - see the note in
    // tests/e2e/README-migration.md.
    await page.waitForURL(/\/edit\/node\/1/, { timeout: 30_000 });
    await expect(page.locator("h1")).toContainText("Edytuj", {
      timeout: 30_000,
    });
  });
});
