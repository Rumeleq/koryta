import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** The extracted facts start folded away, with their number in the header.
 *
 * A well covered article yields a dozen cards, and open by default they pushed
 * the two sections a reader actually comes for - who is in the article, and
 * what rests on it - well below the fold. The count is what makes the closed
 * section honest: it says whether opening it is worth anything.
 */
test("the facts section opens and closes, and says how many there are", async ({
  page,
}) => {
  // The dev server compiles a route the first time it is asked for.
  test.setTimeout(120_000);

  await logIn(page, USERS.normal, "/artykul/artykul-bez-krawedzi-8");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Artykuł bez krawędzi",
    { timeout: 30_000 },
  );

  const header = page.getByTestId("article-facts-header");
  const body = page.getByTestId("article-facts-body");

  await expect(page.getByTestId("article-facts-count")).toBeVisible({
    timeout: 30_000,
  });
  // Not merely hidden: the cards carry vote buttons, each of which subscribes
  // to a firestore document, so a closed section holds none of them.
  await expect(body).toHaveCount(0);

  await header.click();
  await expect(body).toBeVisible({ timeout: 30_000 });

  await header.click();
  await expect(body).toHaveCount(0);
});

test("a logged out reader is asked to sign in rather than offered the toggle", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.goto("/artykul/artykul-bez-krawedzi-8", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  await expect(page.getByTestId("article-facts-header")).toBeVisible({
    timeout: 30_000,
  });
  // No number, because the facts are not theirs to count.
  await expect(page.getByTestId("article-facts-count")).toHaveCount(0);
  await expect(page.locator("body")).toContainText(
    "Zaloguj się, aby zobaczyć fakty",
    { timeout: 30_000 },
  );
});
