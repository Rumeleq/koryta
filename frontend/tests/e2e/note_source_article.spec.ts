import { test, expect } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logIn, USERS } from "./helpers/auth";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

/** A source somebody adds to a note is an article from then on.
 *
 * The url here cannot be fetched - `.invalid` never resolves - which is on
 * purpose: a page that will not give up its title is exactly the case where
 * the source must still be kept, under its own address.
 */
const COMPANY_KRS = "0000357114";
const COMPANY_VIEW = `/eksploruj/tabela?krs=${COMPANY_KRS}`;

const db = () =>
  getFirestore(
    getApps().length === 0
      ? initializeApp({ projectId: "demo-koryta-pl" })
      : getApp(),
    "koryta-pl",
  );

test("a source added to a note becomes an article node", async ({ page }) => {
  // Logs in, saves a note and waits for the article to be written.
  test.setTimeout(180_000);

  const url = `https://example.invalid/zrodlo-${Date.now()}`;

  await logIn(page, USERS.admin, COMPANY_VIEW);
  await page.waitForURL("**/eksploruj/tabela**", { timeout: 30_000 });

  const companyCard = page.locator(`.v-card:has-text("${COMPANY_KRS}")`);
  await expect(companyCard).toBeVisible({ timeout: 15_000 });
  await companyCard.getByRole("button", { name: "Notatki" }).click();
  await companyCard.getByRole("button", { name: "Dodaj źródło" }).click();

  await companyCard.getByText("Dodaj URL").click();
  await companyCard.getByLabel("URL").fill(url);
  await companyCard.getByRole("button", { name: "Zapisz" }).click();
  await expect(companyCard.getByRole("button", { name: "Zapisz" })).toBeHidden({
    timeout: 15_000,
  });

  // The promotion runs after the note is stored, so the node arrives a moment
  // later - and only once, however the same url is spelled.
  await expect(async () => {
    const articles = await db()
      .collection("nodes")
      .where("sourceURL", "==", url)
      .get();
    expect(articles.size).toBe(1);
    expect(articles.docs[0]!.data().type).toBe("article");
    // No title to be had, so the article goes in under its address.
    expect(articles.docs[0]!.data().name).toBe(url);
  }).toPass({ timeout: 60_000 });

  // And the note entry now points at the article it became.
  await expect(companyCard.getByRole("link", { name: "Artykuł" })).toBeVisible({
    timeout: 30_000,
  });
});
