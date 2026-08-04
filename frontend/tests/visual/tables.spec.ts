import { test } from "@playwright/test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { capture, type VisualPage } from "./helpers/capture";

/** The tables behind a login, at both viewports.
 *
 * Every one of them is a v-data-table with four to eleven columns, and none of
 * that fits a phone; below md Vuetify stacks each row into labelled lines
 * instead (the `mobileBreakpoint` default in nuxt.config). These baselines are
 * what says so - the desktop shot alone would keep passing while the phone one
 * scrolled sideways.
 *
 * Firebase keeps its session in IndexedDB, which `storageState` does not carry,
 * so each test signs in for itself rather than sharing one context. */
const pages: VisualPage[] = [
  {
    // The explore table as an admin: the same page as the logged out shot in
    // pages.spec.ts plus the Widoczność column, which is the eleventh and the
    // one that pushed it widest.
    name: "auth-tabela",
    path: "/eksploruj/tabela",
    settled: ["Jan Kowalski"],
  },
  {
    // One person at a time, with the buttons the review flow is built around.
    name: "auth-nowe",
    path: "/eksploruj/nowe",
    settled: ["Eksploruj nowe osoby"],
  },
  {
    // Five columns, of which two are dates - the worst case for stacking.
    name: "auth-rewizje",
    path: "/admin/rewizje",
    settled: ["Administracja - Rewizje"],
  },
  {
    // Four columns plus a select checkbox, so this is where the mobile header's
    // "select all" and sort control are covered.
    name: "auth-krawedzie",
    path: "/admin/krawedzie",
    settled: ["Powiązania do opublikowania"],
  },
  {
    // Seven columns, the widest in the app, and a row of filters above them.
    // The fixtures seed no notes, so this covers the filters and the empty
    // state rather than the rows.
    name: "auth-notatki",
    path: "/admin/notatki",
    settled: ["Wszystkie Notatki"],
  },
];

for (const visual of pages) {
  test(visual.name, async ({ page }, testInfo) => {
    test.skip(
      !!visual.viewports && !visual.viewports.includes(testInfo.project.name),
      `captured only in ${visual.viewports?.join(", ")}`,
    );
    await logIn(page, USERS.admin, visual.path);
    await capture(page, visual);
  });
}
