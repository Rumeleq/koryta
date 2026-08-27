import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** Jan Kowalski, seeded with an approved revision. */
const PERSON_URL = "/osoba/jan-kowalski-1";
const PERSON_ID = "1";

test.describe("Admin shortcut from an entity page", () => {
  test("an admin reaches the node's revision list from the page", async ({
    page,
  }) => {
    await logIn(page, USERS.admin, PERSON_URL);

    const link = page.getByTestId("admin-revisions-link");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `/admin/rewizje/${PERSON_ID}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/admin/rewizje/${PERSON_ID}$`));
    await expect(
      page.getByRole("heading", { name: /Szczegóły rewizji/ }),
    ).toBeVisible();
  });

  /** Only that it is there. Clicking it opens a browser tab per query - what
   * the tabs are is settled in `tests/composables/usePersonSearch.test.ts`,
   * and driving half a dozen popups here would test the pop-up blocker. */
  test("the explore shortcut sits alongside it", async ({ page }) => {
    await logIn(page, USERS.admin, PERSON_URL);
    await expect(page.getByTestId("admin-explore-link")).toBeVisible();
  });

  test("a signed in reader without the claim never sees it", async ({
    page,
  }) => {
    await logIn(page, USERS.normal, PERSON_URL);

    // Anchored on something the page renders for everybody, so an assertion
    // about what is absent cannot pass on a page that never loaded.
    await expect(page.getByText("Jan Kowalski").first()).toBeVisible();
    await expect(page.getByTestId("admin-revisions-link")).toHaveCount(0);
    await expect(page.getByTestId("admin-explore-link")).toHaveCount(0);
  });
});

/** The table is the other way into a person, and it never leaves the page: the
 * name opens a drawer. Asked for after the page shortcut shipped - 'możnaby
 * dodać ten sam przycisk w widoku eksploruj/tabela w sidepanelu osoby'. */
test.describe("Admin shortcut from the table's side panel", () => {
  /** Opens the drawer on whoever the table lists first and hands it back.
   * Which person that is does not matter here - what is under test is that the
   * shortcut is in the drawer and points at the node the drawer is showing. */
  const openFirstPerson = async (page: import("@playwright/test").Page) => {
    await expect(page.locator(".v-data-table__progress")).not.toBeVisible({
      timeout: 30000,
    });
    const firstRowName = page
      .locator("tbody tr:first-child .text-primary.cursor-pointer")
      .first();
    await expect(firstRowName).toBeVisible({ timeout: 30000 });
    await firstRowName.click();
    const drawer = page.locator(".v-navigation-drawer--active");
    await expect(drawer).toBeVisible();
    return drawer;
  };

  test("an admin reaches the revision list without leaving the table", async ({
    page,
  }) => {
    test.setTimeout(90000);
    await logIn(page, USERS.admin, "/eksploruj/tabela");
    const drawer = await openFirstPerson(page);

    const link = drawer.getByTestId("drawer-admin-revisions-link");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /^\/admin\/rewizje\/.+$/);
    await link.click();
    await expect(page).toHaveURL(/\/admin\/rewizje\/.+$/);
    await expect(
      page.getByRole("heading", { name: /Szczegóły rewizji/ }),
    ).toBeVisible();
  });

  test("a signed in reader without the claim never sees it", async ({
    page,
  }) => {
    test.setTimeout(90000);
    await logIn(page, USERS.normal, "/eksploruj/tabela");
    const drawer = await openFirstPerson(page);

    // Anchored on a control the drawer renders for everybody, so an assertion
    // about what is absent cannot pass on a drawer that never filled in.
    await expect(
      drawer.locator("button", { hasText: "Zaproponuj zmianę" }),
    ).toBeVisible();
    await expect(drawer.getByTestId("drawer-admin-revisions-link")).toHaveCount(
      0,
    );
  });
});
