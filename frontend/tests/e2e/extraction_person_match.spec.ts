import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** Which person a fact was attached to, and saying so when it is the wrong one.
 *
 * The extraction pipeline confirms who an article names and hands the ids over
 * with the facts; the endpoint joins those to each fact by name. Matching on a
 * name is the part that goes wrong - two people share one often enough - so the
 * card both shows the match and offers a way to dispute it.
 *
 * `seed-open-party` is the newest unreviewed fact in scripts/extractions.json,
 * so it is the card /ekstrakcje/kategoryzacja opens on, and it is seeded matched
 * to Anna Nowak (node 3).
 *
 * Deliberately stops at the click: what happens to the flag afterwards is the
 * onVoteWritten trigger's job, and the fact it lands on is then served from a
 * 60s response cache - neither of which this feature owns.
 */
test("a matched fact names the person, links to them and can be disputed", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await logIn(page, USERS.normal, "/ekstrakcje/kategoryzacja");

  const card = page.locator(".swipe-card");
  await expect(card.locator(".extraction-quote")).toBeVisible({
    timeout: 30_000,
  });

  // The match is stated, not just implied by the name being there.
  await expect(card).toContainText("osoba w bazie");
  await expect(card.locator("a[href='/osoba/anna-nowak-3']")).toBeVisible();

  const flag = card.getByRole("button", { name: /To nie ta osoba/ });
  await expect(flag).toBeVisible();
  await flag.click();

  await expect(
    card.getByRole("button", { name: /Zgłoszono złe dopasowanie/ }),
  ).toBeVisible({ timeout: 15_000 });

  // Flagging must not double as a verdict: the reviewer is still on this card,
  // with the queue where it was.
  await expect(card.locator(".extraction-quote")).toBeVisible();

  // And it is takeable back, for the reviewer who clicked it by mistake.
  await card.getByRole("button", { name: /Zgłoszono złe dopasowanie/ }).click();
  await expect(
    card.getByRole("button", { name: /To nie ta osoba/ }),
  ).toBeVisible({ timeout: 15_000 });
});
