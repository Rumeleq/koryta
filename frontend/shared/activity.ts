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
 */
export const activityKinds = [
  "nodeVote",
  "extractionVote",
  "revision",
  "noteSource",
  "comment",
  "adminDecision",
] as const;

export type ActivityKind = (typeof activityKinds)[number];

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
    "Rozstrzygnięcie administratora: zatwierdzenie albo odrzucenie rewizji, opublikowanie albo ukrycie strony.",
};
