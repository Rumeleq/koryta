import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** Pick `name` in one of the two entity pickers on the relation form.
 *
 * Retried as a whole because the suite runs against the dev server: until the
 * form has hydrated a `fill` writes the DOM value without it reaching the
 * component, so no search is ever issued and no option appears. */
async function pick(page: Page, side: "source" | "target", name: string) {
  const input = page.getByTestId(`entity-picker-${side}`).locator("input");
  const option = page.getByRole("option", { name, exact: true });
  await expect(async () => {
    await input.fill(name);
    await expect(option).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await option.click();
}

/** Adding a relation from a person's page - the two kinds a reader can add:
 * a tie to another person, and a job at a company.
 *
 * The node ids are the ones scripts/seed-emulator.ts writes. Both specs pick
 * pairs the seed leaves unconnected, so what the page shows afterwards can
 * only have come from the form. */
test.describe("Add a relation", () => {
  test("a reader can connect two people", async ({ page }) => {
    test.setTimeout(180_000);
    // Jan Kowalski (1) and Piotr Wiśniewski (4).
    await logIn(page, USERS.normal, "/entity/person/1");

    const section = page.getByTestId("add-relation");
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("body")).not.toContainText("Piotr Wiśniewski");

    await section.getByTestId("edge-picker-connection").click();

    // Jan is fixed as the source; only the other end is picked.
    await expect(page.getByTestId("entity-picker-source")).toContainText(
      "Jan Kowalski",
    );
    await pick(page, "target", "Piotr Wiśniewski");

    await page.getByTestId("edge-name-field").locator("input").fill("żona");

    const submit = page.getByTestId("submit-edge-button");
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByTestId("add-relation-success")).toBeVisible({
      timeout: 30_000,
    });

    // Really stored: an edge awaiting approval is still shown to a logged in
    // reader, so a reload lists it.
    await page.reload();
    await expect(page.locator("body")).toContainText("Piotr Wiśniewski", {
      timeout: 30_000,
    });
    await expect(page.locator("body")).toContainText("żona");
  });

  test("a reader can record where somebody works", async ({ page }) => {
    test.setTimeout(180_000);
    // Krzysztof Wójcik (5) has no relations in the seed at all.
    await logIn(page, USERS.normal, "/entity/person/5");

    const section = page.getByTestId("add-relation");
    await expect(section).toBeVisible({ timeout: 30_000 });
    await section.getByTestId("edge-picker-employed").click();

    await pick(page, "target", "Orlen");
    await page
      .getByTestId("edge-name-field")
      .locator("input")
      .fill("prezes zarządu");

    await page.getByTestId("submit-edge-button").click();

    await expect(page.getByTestId("add-relation-success")).toBeVisible({
      timeout: 30_000,
    });

    await page.reload();
    await expect(page.locator("body")).toContainText("prezes zarządu", {
      timeout: 30_000,
    });
  });

  test("a logged out reader is asked to sign in", async ({ page }) => {
    await page.goto("/entity/person/1");
    const section = page.getByTestId("add-relation");
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect(section.getByTestId("add-relation-login")).toBeVisible();
    await expect(
      section.getByTestId("edge-picker-connection"),
    ).not.toBeVisible();
  });
});
