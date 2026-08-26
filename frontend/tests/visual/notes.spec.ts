import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "../e2e/helpers/auth";

/** The notes section, which nothing else in this suite draws.
 *
 * `note/Editor.vue` renders under `v-if="user || otherSources.length > 0"`,
 * and the seed creates no notes at all - so every logged out capture in
 * pages.spec.ts omits it entirely, and restyling it from a raised card to a
 * plain section changed no baseline in the suite. Signing in is what puts it
 * on the page.
 *
 * One element rather than a full page: a person's page ends in a
 * force-directed graph that settles somewhere slightly different every run,
 * and a company's page carries one too.
 *
 * Both viewports get a shot from the same spec. The phone one is the point of
 * having it - the report that prompted the restyle was about how the section
 * sits among the cards on a phone.
 */

/** Everything that has to have arrived before a shot is worth taking. */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

test.describe("Notatki", () => {
  test("notatki-sekcja", async ({ page }) => {
    test.setTimeout(120_000);
    // A person, where the section sits directly under "Historia powiązań" and
    // above the graph - the arrangement the restyle was judged against.
    await logIn(page, USERS.normal, "/entity/person/1");

    const notes = page.getByTestId("note-editor");
    await expect(notes).toBeVisible({ timeout: 30_000 });
    // The prompt is the last thing to resolve: it is behind `userNote`, which
    // is not known until the note collection for this person has answered.
    await expect(
      notes.getByText("Wiesz więcej na temat tej osoby?"),
    ).toBeVisible({ timeout: 30_000 });
    await settled(page);

    await expect(notes).toHaveScreenshot("notatki-sekcja.png");
  });

  test("notatki-sekcja-spolka", async ({ page }) => {
    test.setTimeout(120_000);
    // The same component with a different subject line, on the page where it
    // is the only section of its kind - worth its own shot because a company
    // page frames it differently from a person's.
    await logIn(page, USERS.normal, "/entity/place/2");

    const notes = page.getByTestId("note-editor");
    await expect(notes).toBeVisible({ timeout: 30_000 });
    await expect(
      notes.getByText("Wiesz więcej na temat tej spółki?"),
    ).toBeVisible({ timeout: 30_000 });
    await settled(page);

    await expect(notes).toHaveScreenshot("notatki-sekcja-spolka.png");
  });
});
