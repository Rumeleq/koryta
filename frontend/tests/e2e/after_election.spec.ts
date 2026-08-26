import { test, expect } from "@playwright/test";

/** The seeded people whose candidacies cover all three outcomes. Each of them
 * also holds a post at the seeded institution, taken in the election year or
 * the one after - which is what the section pairs. */
const LOST = "/osoba/cezary-obejmujacy-sukcezary";
const WON = "/osoba/franciszek-nastepny-sukfranciszek";
const UNRECORDED = "/osoba/hanna-prokurent-sukhanna";

test.describe("Po wyborach", () => {
  test("pairs a lost candidacy with the post that followed it", async ({
    page,
  }) => {
    await page.goto(LOST, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-main")).toBeVisible();

    // The row in the relation history says how the candidacy ended...
    await expect(page.getByTestId("relations-history")).toContainText(
      "Bez mandatu",
      { timeout: 30_000 },
    );

    // ...and the section below states the pairing the site is about: stood for
    // the powiat council, took no seat, and joined the powiat's own company
    // three months later.
    const section = page.getByTestId("after-election");
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect(section).toContainText("Powiat Testowy");
    await expect(section).toContainText("Wojewódzki Zakład Testowy");
    await expect(section).toContainText("w tym samym roku");

    // Said out loud rather than left to the reader to assume otherwise.
    await expect(page.getByTestId("after-election-lead")).toContainText(
      "nie twierdzenie o przyczynie",
    );
  });

  test("says so when the candidacy won and the post came the year after", async ({
    page,
  }) => {
    await page.goto(WON, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-main")).toBeVisible();

    await expect(page.getByTestId("relations-history")).toContainText(
      "Mandat zdobyty",
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("after-election")).toContainText(
      "w następnym roku",
      { timeout: 30_000 },
    );
  });

  test("does not turn a missing result into a lost election", async ({
    page,
  }) => {
    // The state every candidacy in production is in. The pairing still stands
    // - the two dates are facts - but the outcome is named as unknown, and the
    // relation row stays silent rather than carrying a chip per row.
    await page.goto(UNRECORDED, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-main")).toBeVisible();

    const section = page.getByTestId("after-election");
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect(section).toContainText("Wynik nieznany");
    await expect(section).not.toContainText("Bez mandatu");
    await expect(page.getByTestId("relations-history")).not.toContainText(
      "Bez mandatu",
    );
  });
});
