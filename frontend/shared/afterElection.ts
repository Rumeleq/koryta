/** A candidacy, and the post the person took just after it.
 *
 * Each of those facts is unremarkable on its own. In that order they are the
 * thing the site is about: somebody stands on a committee's list, and a few
 * months later turns up on the board of a company the same council owns. The
 * rule that decides what "just after" means lives here, in one place, so that
 * the section on a person's page and the score behind their rank cannot drift
 * apart.
 *
 * The same rule is implemented in the pipeline, at
 * `data/pipelines/src/analysis/scores/turnover.py`, which scores a person on
 * appointments that followed an election they stood in. The two must agree:
 * a reader who is shown "kandydował w 2018, stanowisko objęte w 2019" and a
 * score computed over a different window has been given two answers to one
 * question. Change one, change the other, and keep `YEARS_AFTER_ELECTION`
 * equal across them.
 *
 * What this deliberately does *not* do is claim a causal link. It pairs two
 * dated facts and says how far apart they are; the reader draws the
 * conclusion, and the section says as much out loud.
 */

import { electionOutcome, type ElectionOutcome } from "./election";

/** How many years after an election an appointment still counts as following
 * it. Polish local elections are held in the autumn and the new council seats
 * its people over the following months, so the year after is where most of
 * them land. Kept equal to `YEARS_AFTER_ELECTION` in `scores/turnover.py`. */
export const YEARS_AFTER_ELECTION = 1;

/** One candidacy, reduced to what the pairing needs. */
export type Candidacy = {
  /** The edge id, so a card can be keyed on something stable. */
  id?: string;
  /** The region stood in, which is the other end of the election edge. */
  regionId: string;
  regionName: string;
  /** The year PKW filed the candidacy under. Never a day: the listings record
   * a year, and the ingest stores `<year>-01-01` to have something sortable -
   * which is why nothing here counts months. */
  year: number;
  /** The office, as `ElectionPosition` spells it. */
  position?: string;
  party?: string;
  committee?: string;
  /** Tri-state, as everywhere: absent is "PKW recorded no result". */
  elected?: boolean | null;
};

/** One post, reduced to what the pairing needs. */
export type Post = {
  id?: string;
  companyId: string;
  companyName: string;
  /** The role as the register names it - "Zarząd", "Rada Nadzorcza". */
  role?: string;
  /** The day the post began, as an ISO day or a bare year. */
  start: string;
  end?: string | null;
};

/** How soon after the election the post began.
 *
 * Two values rather than a number of months, because a number would be made
 * up: PKW records the year of a candidacy and not the day, and the stored
 * `<year>-01-01` is a placeholder for the year rather than a date anything
 * happened on. Saying "3 miesiące później" off that would be arithmetic on a
 * date nobody recorded.
 */
export type AfterElectionTiming = "same-year" | "next-year";

/** One candidacy paired with one post. */
export type AfterElectionLink = {
  candidacy: Candidacy;
  post: Post;
  timing: AfterElectionTiming;
  outcome: ElectionOutcome;
  /** How many *other* candidacies of this person also fall in this post's
   * window.
   *
   * Zero means the pairing names the candidacy the appointment followed. More
   * than that means it does not: somebody who stood twice in the same autumn
   * has two candidacies the post could be said to follow, and which of them a
   * card names is this module's choice rather than the register's. Anything
   * putting one of them in front of a reader has to say so - the same hedge
   * `sameDayPeers` exists for in `shared/succession.ts`. */
  alsoMatching: number;
};

/** The year in an ISO day or a bare year string, or null.
 *
 * Looser than `spellDate` in `shared/succession.ts`, and it can afford to be:
 * that function needs a day, and reading "2016" as 1 January would move a
 * spell eleven months. A year is exactly what is being asked for here, so a
 * value that names one - however much else it does or does not name - answers
 * the question exactly.
 */
export function yearOf(value: string | null | undefined): number | null {
  const match = value ? /^(\d{4})(?:-\d{2}-\d{2})?$/.exec(value.trim()) : null;
  return match ? Number(match[1]) : null;
}

/** Every post that began in the window after a candidacy, newest post first.
 *
 * One card per post, not per pair: a person who stood twice in one autumn did
 * not take the job twice, and listing both readings would turn one appointment
 * into two claims. The candidacy named is the latest one the window allows -
 * the nearest thing to the appointment - and `alsoMatching` says how many
 * others it could have been.
 *
 * Ties are broken on the register's own facts, then on the ids, so that two
 * candidacies filed under the same year always produce the same card. Keyed on
 * anything else and the site would name one committee this week and the other
 * one next, with nothing having happened.
 */
export function linksAfterElection(
  candidacies: Candidacy[],
  posts: Post[],
): AfterElectionLink[] {
  const links: AfterElectionLink[] = [];

  for (const post of posts) {
    const started = yearOf(post.start);
    if (started === null) continue;

    const matching = candidacies.filter(
      (candidacy) =>
        candidacy.year <= started &&
        started <= candidacy.year + YEARS_AFTER_ELECTION,
    );
    if (!matching.length) continue;

    const named = matching.toSorted(byCandidacyOrder)[0]!;
    links.push({
      candidacy: named,
      post,
      timing: started === named.year ? "same-year" : "next-year",
      outcome: electionOutcome(named.elected),
      alsoMatching: matching.length - 1,
    });
  }

  return links.toSorted((a, b) => {
    const byStart = (b.post.start ?? "").localeCompare(a.post.start ?? "");
    if (byStart !== 0) return byStart;
    const byCompany = a.post.companyName.localeCompare(b.post.companyName);
    if (byCompany !== 0) return byCompany;
    return (a.post.id ?? "").localeCompare(b.post.id ?? "");
  });
}

/** Latest year first, then the region, then the id - so the choice among
 * several candidacies in one window is fixed rather than whatever order the
 * graph came back in. */
function byCandidacyOrder(a: Candidacy, b: Candidacy): number {
  if (a.year !== b.year) return b.year - a.year;
  const byRegion = a.regionName.localeCompare(b.regionName);
  if (byRegion !== 0) return byRegion;
  return (a.id ?? "").localeCompare(b.id ?? "");
}
