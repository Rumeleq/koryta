/** The distinct things a person can do to the data, as the site records them.
 *
 * Each kind is one collection write a human made, which is what makes them
 * comparable on a timeline and countable per contributor. They are deliberately
 * finer-grained than "a vote": rating a person in the explore table and rating
 * a fact the extraction pipeline proposed are different work, land in the same
 * `votes` collection, and are told apart only by which id field is set.
 *
 * Two interactions are missing on purpose, because nothing timestamps them:
 * the per-category tallies `/api/votes/vote` writes inline onto a node or edge
 * (`votes.<category>.<uid>`), and the newsletter preferences on a user document.
 * Neither can be placed on a day, so neither can be counted here.
 *
 * The order is not cosmetic. The timeline stacks the kinds in it and
 * `activityColors` hands them categorical slots in the same order, which is
 * what keeps adjacent bands apart for a colourblind reader — so a new kind is
 * appended and takes the next slot, never inserted where it reads best.
 */
export const activityKinds = [
  "nodeVote",
  "extractionVote",
  "revision",
  "noteSource",
  "comment",
  "adminDecision",
  "publication",
] as const;

export type ActivityKind = (typeof activityKinds)[number];

/** The windows `/api/stats/activity` will answer for, in days.
 *
 * A closed set rather than a range, and shared so the buttons on
 * /eksploruj/statystyki and the endpoint cannot drift apart. The endpoint
 * memoizes per window length and builds a stored day for anything it has not
 * counted yet, so an open range would let one caller mint a year of independent
 * cold computations by walking `?days=1..365` — three shared entries is the
 * whole working set instead.
 *
 * The admin panel asks for 7, which is why that is one of them.
 */
export const activityRanges = [7, 30, 90] as const;

export type ActivityRange = (typeof activityRanges)[number];

export const defaultActivityRange: ActivityRange = 30;

/** Counts per kind. Every kind is always present, so charts and tables never
 * have to distinguish "zero" from "absent". */
export type ActivityCounts = Record<ActivityKind, number>;

export function emptyActivityCounts(): ActivityCounts {
  return {
    nodeVote: 0,
    extractionVote: 0,
    revision: 0,
    noteSource: 0,
    comment: 0,
    adminDecision: 0,
    publication: 0,
  };
}

export function totalActivity(counts: ActivityCounts): number {
  return activityKinds.reduce((sum, kind) => sum + counts[kind], 0);
}

export const activityKindLabels: Record<ActivityKind, string> = {
  nodeVote: "Ocena osoby",
  extractionVote: "Ocena ekstrakcji",
  revision: "Propozycja zmiany",
  noteSource: "Źródło lub zgłoszenie",
  comment: "Komentarz",
  adminDecision: "Decyzja administratora",
  publication: "Opublikowane osoby",
};

/** One sentence per kind, for the tooltip that explains what is being counted.
 * The stats page is the only place most readers meet these words. */
export const activityKindDescriptions: Record<ActivityKind, string> = {
  nodeVote:
    "Ocena osoby lub innego węzła w grafie — „Dobre znalezisko” i „Znaleziony problem”.",
  extractionVote:
    "Ocena faktu zaproponowanego przez pipeline ekstrakcji — czy jest poprawny i czy wystarcza informacji.",
  revision:
    "Ręcznie zaproponowana zmiana danych węzła, czekająca na akceptację administratora.",
  noteSource:
    "Wpis w notatce: podlinkowane źródło, prośba o poprawkę albo zgłoszenie brakujących danych.",
  comment: "Komentarz pod osobą, powiązaniem albo w wątku zgłoszenia.",
  adminDecision:
    "Rozstrzygnięcie administratora: zatwierdzenie albo odrzucenie rewizji, ukrycie strony, usunięcie powiązania.",
  publication:
    "Strona osoby albo instytucji udostępniona publicznie. Powiązania opublikowane razem z nią to ta sama decyzja, więc liczą się raz — a nie raz na powiązanie.",
};
