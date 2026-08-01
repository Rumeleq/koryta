import { test, expect } from "@playwright/test";
import { waitForLoginFormHydrated } from "./helpers/login";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

test.describe("Admin notes queue", () => {
  test("lists the newest entries, filters them and opens the side panel", async ({
    page,
  }) => {
    test.setTimeout(90000); // Seeds, logs in and loads a paginated table

    const app =
      getApps().length === 0
        ? initializeApp({ projectId: "demo-koryta-pl" })
        : getApp();
    const db = getFirestore(app, "koryta-pl");

    const stamp = Date.now();
    const personId = `notes-person-${stamp}`;
    const companyId = `notes-company-${stamp}`;

    await db
      .collection("nodes")
      .doc(personId)
      .set({ name: `Zenon Notatkowy ${stamp}`, type: "person" });
    await db
      .collection("nodes")
      .doc(companyId)
      .set({ name: `Spółka Notatkowa ${stamp}`, type: "place" });

    // The queue is ordered by when the note was written, so the company note is
    // the newer of the two and has to come first.
    await db
      .collection("notes")
      .doc(`${personId}_test-user`)
      .set({
        nodeId: personId,
        userUid: "test-user",
        updatedAt: new Date(stamp - 60_000).toISOString(),
        sources: [
          { note: `stara notatka ${stamp}`, kind: "source" },
          {
            note: `rozwiązana notatka ${stamp}`,
            kind: "change_request",
            adminStatus: "resolved",
          },
        ],
      });
    await db
      .collection("notes")
      .doc(`${companyId}_test-user`)
      .set({
        nodeId: companyId,
        userUid: "test-user",
        updatedAt: new Date(stamp).toISOString(),
        sources: [{ note: `nowa notatka ${stamp}`, kind: "missing" }],
      });

    await page.goto(`/login?redirect=${encodeURIComponent("/admin/notatki")}`);
    await waitForLoginFormHydrated(page);
    await page.locator("input#email").fill("admin@koryta.pl");
    await page.locator("input#password").fill("password123");
    await page.locator('button[type="submit"]').click({ force: true });

    await page.waitForURL("**/admin/notatki**", { timeout: 15000 });

    const rows = page.locator("tbody tr");
    await expect(rows.first()).toContainText(`nowa notatka ${stamp}`, {
      timeout: 30000,
    });
    // Newest first, so the company note outranks the older person note.
    await expect(rows.first()).toContainText(`Spółka Notatkowa ${stamp}`);
    // The author is resolved by name rather than left as a raw uid.
    await expect(rows.first()).toContainText("Normal User");

    // Narrowing to one node type drops the person's entries.
    await page.getByLabel("Typ węzła").click();
    await page.getByRole("option", { name: "Instytucja" }).click();
    await expect(rows).toHaveCount(1);
    await expect(page).toHaveURL(/nodeType=place/);

    // Filters survive a reload, so a queue can be shared or come back to.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(rows).toHaveCount(1, { timeout: 30000 });

    // Clearing the type filter and asking for what is still open hides the
    // entry an admin already signed off.
    await page.goto("/admin/notatki?status=unresolved", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("tbody")).not.toContainText(
      `rozwiązana notatka ${stamp}`,
      { timeout: 30000 },
    );

    // The node name opens the same side panel as /eksploruj/tabela.
    await page.goto("/admin/notatki", { waitUntil: "domcontentloaded" });
    await expect(rows.first()).toContainText(`Spółka Notatkowa ${stamp}`, {
      timeout: 30000,
    });
    await page.getByText(`Spółka Notatkowa ${stamp}`).first().click();

    const drawer = page.locator(".v-navigation-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(`Spółka Notatkowa ${stamp}`, {
      timeout: 30000,
    });
    await expect(drawer).toContainText("Notatki");
    await expect(drawer).toContainText(`nowa notatka ${stamp}`);
  });
});
