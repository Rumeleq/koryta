import { test, expect, type Locator, type Page } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** v-network-graph draws its labels as SVG text, which `getByText` will not
 * find - it reads innerText, and SVG elements have none. Same helper as
 * local_graph.spec.ts. */
const label = (page: Page, name: string) =>
  page.locator("svg text").filter({ hasText: name });

/** Types into an entity picker and picks the option that comes back.
 *
 * Retried as a whole because the suite runs against the dev server: until the
 * field has hydrated a `fill` writes the DOM value without it reaching the
 * component, so no search is issued and no option ever appears.
 *
 * `term` is one word on purpose, and is not the whole name. /api/search matches
 * `array-contains` against the string as typed, and the chunks the seed writes
 * are single words and their suffixes - "anna", "nowak", "owak" - with no entry
 * holding both words. Typing a full name therefore finds nobody. Restore that
 * and the test goes red for a reason that has nothing to do with the feature.
 */
async function pick(page: Page, field: Locator, term: string, name: string) {
  const input = field.locator("input");
  const option = page.getByRole("option", { name, exact: true });
  await expect(async () => {
    await input.fill(term);
    await expect(option).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await option.click();
}

/** The whole point of the feature, end to end.
 *
 * A story is assembled the way somebody actually would: tag an article into a
 * topic, record a relation the article is the source for, then open the topic
 * and see the people that relation joins.
 *
 * "Artykuł bez krawędzi" (node 8) is used by no other spec and starts with no
 * edges, so everything drawn at the end can only have come from this test. The
 * isolation runs deeper than picking an unused fixture: a topic graph is built
 * from the edges citing *its own* articles, so no other spec's writes can reach
 * these assertions even when the suite runs in parallel.
 */
test.describe("Topic graph", () => {
  test("a story drawn from the article tagged into it", async ({ page }) => {
    test.setTimeout(180_000);

    // Unique, so parallel workers and repeat runs against a warm emulator do
    // not collide on the topic name.
    const topicName = `Powodzianie KRR ${Date.now()}`;

    await logIn(page, USERS.normal, "/artykul/artykul-bez-krawedzi-8");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Artykuł bez krawędzi",
      { timeout: 30_000 },
    );

    // 1. A topic nobody has named yet is created from the picker itself, which
    //    is the only way in - there is no "new topic" page.
    const picker = page.getByTestId("article-topic-picker");
    await expect(async () => {
      await picker.locator("input").fill(topicName);
      await expect(page.getByTestId("entity-picker-add-new-topic")).toBeVisible(
        { timeout: 2_000 },
      );
    }).toPass({ timeout: 30_000 });
    await page.getByTestId("entity-picker-add-new-topic").click();

    const createDialog = page.locator(".v-dialog:visible");
    await expect(createDialog).toContainText("Zaproponuj nowy temat", {
      timeout: 30_000,
    });
    await createDialog.getByRole("button", { name: "Zaproponuj" }).click();
    await expect(createDialog).toBeHidden({ timeout: 30_000 });

    // 2. Tagging writes a `tagged` edge as a draft, so it is visible to us and
    //    to nobody logged out.
    await page.getByTestId("article-topic-add").click();
    const chip = page.getByTestId("article-topic-chip").filter({
      hasText: topicName,
    });
    await expect(chip).toBeVisible({ timeout: 30_000 });

    // 3. A relation between two other entities, with this article as its
    //    source. Neither person is on this page until the composer puts them
    //    there.
    await page.getByTestId("article-add-sourced-edge").click();
    const composer = page.getByTestId("add-sourced-edge-dialog");
    await expect(composer).toBeVisible({ timeout: 30_000 });

    await pick(
      page,
      composer.getByTestId("sourced-edge-from"),
      "Nowak",
      "Anna Nowak",
    );
    await pick(
      page,
      composer.getByTestId("sourced-edge-to"),
      "Krzysztof",
      "Krzysztof Wójcik",
    );

    // Two people can be joined only one way, so the composer settles the verb
    // itself rather than asking.
    await expect(
      composer.getByTestId("sourced-edge-verb-connection"),
    ).toBeVisible();
    await composer
      .getByTestId("sourced-edge-name")
      .locator("input")
      .fill("wspólny interes");
    await composer.getByTestId("sourced-edge-submit").click();
    await expect(composer).toBeHidden({ timeout: 30_000 });

    // Really stored, and really cited to this article: the section that lists
    // what rests on the article is fed by `references`, not by the edge's own
    // endpoints.
    await page.reload();
    await expect(page.locator("body")).toContainText("Anna Nowak", {
      timeout: 30_000,
    });
    await expect(page.locator("body")).toContainText("Krzysztof Wójcik");

    // 4. The topic page, reached the way a reader would - from the chip.
    await page
      .getByTestId("article-topic-chip")
      .filter({ hasText: topicName })
      .click();
    await expect(page).toHaveURL(/\/temat\//, { timeout: 30_000 });
    await expect(page.locator("body")).toContainText(topicName, {
      timeout: 30_000,
    });

    // The article is listed as the story's evidence...
    await expect(page.getByTestId("topic-article-8")).toBeVisible({
      timeout: 30_000,
    });

    // ...and the people that evidence connects are drawn. This is the chain the
    // whole feature exists for: topic to articles to the relations citing them
    // to the people at either end.
    await expect(label(page, "Anna Nowak").first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(label(page, "Krzysztof Wójcik").first()).toBeVisible({
      timeout: 60_000,
    });

    // The article itself is not a node in the story - what a reader wants from
    // an affair is who is in it.
    await expect(label(page, "Artykuł bez krawędzi")).toHaveCount(0);
  });

  test("a logged out reader is not offered the tag editor", async ({
    page,
  }) => {
    // The suite runs against the dev server, which compiles a route the first
    // time it is asked for. Late in a parallel run that can take longer than
    // playwright's 30s default, which is what the rest of the suite sets a
    // budget of its own for rather than reading as a failure.
    test.setTimeout(120_000);

    await page.goto("/artykul/artykul-bez-krawedzi-8", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(page.getByTestId("article-topic-picker")).toBeHidden();
    // The facts a model pulled out of an article are not public; the banner is
    // what says so.
    await expect(page.locator("body")).toContainText("Zaloguj się", {
      timeout: 30_000,
    });
  });
});
