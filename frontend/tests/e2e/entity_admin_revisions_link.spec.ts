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

  test("a signed in reader without the claim never sees it", async ({
    page,
  }) => {
    await logIn(page, USERS.normal, PERSON_URL);

    // Anchored on something the page renders for everybody, so an assertion
    // about what is absent cannot pass on a page that never loaded.
    await expect(page.getByText("Jan Kowalski").first()).toBeVisible();
    await expect(page.getByTestId("admin-revisions-link")).toHaveCount(0);
  });
});
