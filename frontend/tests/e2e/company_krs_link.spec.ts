import { test, expect } from "@playwright/test";

/** KRS of the company seeded for the emulator, the one identifier the seed and
 * prod share - see company_notes.spec.ts. */
const COMPANY_KRS = "0000357114";

test("links a company's KRS number to its entry in rejestr.io", async ({
  page,
}) => {
  await page.goto(`/eksploruj/tabela?krs=${COMPANY_KRS}`, {
    waitUntil: "domcontentloaded",
  });

  const card = page.locator(`.v-card:has-text("${COMPANY_KRS}")`).first();
  // Client rendered, and only after the place list arrives.
  await expect(card).toBeVisible({ timeout: 30_000 });

  // The number itself is the link, so a reader can check the company against
  // the register without copying it into a search box.
  const link = card.getByRole("link", { name: COMPANY_KRS });
  await expect(link).toHaveAttribute(
    "href",
    `https://rejestr.io/krs/${COMPANY_KRS}`,
  );
  // Somebody following it is mid-way through reading the table.
  await expect(link).toHaveAttribute("target", "_blank");
});
