import { test } from "@playwright/test";
import { capture, type VisualPage } from "./helpers/capture";

/** The pages a logged out reader can reach. See tables.spec.ts for the ones
 * behind a login, and helpers/capture.ts for what the fields mean. */
const pages: VisualPage[] = [
  { name: "home", path: "/" },
  { name: "login", path: "/login" },
  { name: "zrodla", path: "/zrodla" },
  { name: "o-nas", path: "/o-nas" },
  { name: "pomoc", path: "/pomoc" },
  { name: "lista", path: "/lista", settled: ["Jan Kowalski"] },
  // Not a page: the path is deliberately unroutable, so this captures
  // app/error.vue's 404 branch. Keep it single-segment - two segments would
  // match pages/[seoType]/[slug].vue and render an entity instead.
  { name: "not-found", path: "/nie-ma-takiej-strony" },
  {
    name: "statystyki",
    path: "/eksploruj/statystyki",
    // Two fetches feed this page and only one of them is server rendered. The
    // state of the base arrives with the document; the activity section is
    // fetched from the browser, because it carries names for admins and so has
    // to go out with the caller's token. Its tiles replace a skeleton when it
    // lands, so waiting for a tile label is what stops the capture racing it.
    //
    // Against the seeded world every chart on the page draws its empty state:
    // the fixtures seed no votes, notes or comments, and the newest revision in
    // them is from 2023, so the rolling activity window is always empty. That
    // is what makes the shot stable day to day - and it does mean this baseline
    // covers the layout, the copy and the empty states rather than the charts.
    settled: ["Ocena ekstrakcji", "Opublikowane:"],
  },
  {
    // The explore table itself, which is the page a phone had the most trouble
    // with: eleven columns used to make the whole document 1242px wide on a
    // 390px screen. Below md each row is a card instead, so the phone shot is
    // now the point of this one rather than a picture of the overflow.
    name: "tabela",
    path: "/eksploruj/tabela",
    settled: ["Jan Kowalski"],
  },
  {
    // A place's page is the table filtered to it. `chain-company` is the seeded
    // institution with no KRS number, so this is where the identifiers a
    // ministry, an urząd or a wojewódzki fundusz does have - REGON and NIP -
    // are actually drawn.
    name: "instytucja",
    path: "/eksploruj/tabela?place=chain-company",
    // Rendered entirely client side, so none of it exists until two separate
    // responses have arrived: the place list the card is drawn from, and the
    // people the table is filtered to. Capturing before both leaves a card
    // with no identifiers and a table still spinning.
    settled: [/REGON:\s*123456785/, "Osoba Testowa"],
  },
  {
    // A person's own page: the header and its two actions, the registry links
    // and the relation history. Jan Kowalski is seeded with a party, an
    // employment and a connection, so none of those sections is empty.
    name: "osoba",
    path: "/osoba/jan-kowalski-1",
    settled: ["Historia powiązań"],
    // The graph is a force simulation - it comes to rest somewhere slightly
    // different every run, and it is 500px of the page. Masking it keeps the
    // shot about everything around it. On a phone it is behind a button and
    // the locator simply matches nothing.
    mask: ['[data-testid="entity-graph"]'],
  },
];

for (const visual of pages) {
  test(visual.name, async ({ page }, testInfo) => {
    test.skip(
      !!visual.viewports && !visual.viewports.includes(testInfo.project.name),
      `captured only in ${visual.viewports?.join(", ")}`,
    );
    await page.goto(visual.path);
    await capture(page, visual);
  });
}
