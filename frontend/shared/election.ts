/** What the register says about how a candidacy ended.
 *
 * `Edge.elected` is a tri-state and every reader of it has to treat it as one.
 * PKW publishes a "Czy uzyskał mandat" column for some elections and not for
 * others, so the three answers are "took the seat", "did not take the seat"
 * and "nobody recorded it" - and the last of those is, for now, most of the
 * collection. The site says which of the three it is holding rather than
 * printing the absence as a loss, because a lost election is a claim about a
 * named person and an absent column is not evidence for it.
 *
 * The pipeline half of this lives at `scrapers/pkw/headers.py`, which parses
 * the column, and `analysis/payloads/person.py`, which carries it into the
 * payload as `None` where PKW said nothing. `clean_payload` in the uploader
 * drops the nulls, which is what turns "not recorded" into an absent field
 * rather than a stored `false`.
 */
export type ElectionOutcome = "elected" | "lost" | "unknown";

/** Which of the three a stored `elected` is.
 *
 * `null` as well as `undefined`, because the relation form writes an explicit
 * null for an outcome nobody chose and the ingest omits the field entirely.
 */
export function electionOutcome(
  elected: boolean | null | undefined,
): ElectionOutcome {
  if (elected === true) return "elected";
  if (elected === false) return "lost";
  return "unknown";
}

/** How each outcome reads on screen.
 *
 * `label` is what fits on a chip; `detail` is the whole sentence, for a
 * tooltip and for the prose in `election/AfterElection.vue`. Neither is
 * gendered: the site does not know, and "wybrany/a" in a chip is noise.
 */
export const electionOutcomeText: Record<
  ElectionOutcome,
  { label: string; detail: string }
> = {
  elected: {
    label: "Mandat zdobyty",
    detail: "PKW odnotowała, że ta kandydatura zakończyła się mandatem.",
  },
  lost: {
    label: "Bez mandatu",
    detail: "PKW odnotowała, że ta kandydatura nie dała mandatu.",
  },
  unknown: {
    label: "Wynik nieznany",
    detail:
      "Nie wiemy, czy ta kandydatura dała mandat - PKW podaje wynik tylko " +
      "dla części wyborów, a dla starszych roczników nie ma go wcale.",
  },
};
