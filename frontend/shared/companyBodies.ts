/** What an institution's supervisory organ is called, and whether a seat on it
 * is a job.
 *
 * Every supervisory seat the register holds reaches the site as an `employed`
 * edge named "Rada Nadzorcza": rejestr.io reports all of them as one connection
 * type, `KRS_SUPERVISION`, and `data/pipelines/src/scrapers/krs/list.py` gives
 * that type a single label. 9,848 of the 15,235 stored employment edges say it.
 *
 * For a spółka that is right, and a board seat is the sort of post the site
 * exists to record. For a samodzielny publiczny zakład opieki zdrowotnej it is
 * wrong twice over. KRS names the organ itself - `dzial2.organNadzoru` reads
 * "RADA SPOŁECZNA" for every one of them - and a rada społeczna is not a
 * supervisory board at all but the advisory body art. 48 ustawy o działalności
 * leczniczej makes each hospital appoint, whose members are delegates of the
 * founding authority and are not paid. 892 such seats are stored, across the
 * 238 hospitals that have any, every one of them labelled "Rada Nadzorcza".
 *
 * So this is the vocabulary, and which institution has which organ is decided
 * by the pipelines, in `data/pipelines/src/entities/company_bodies.py`, and
 * arrives on the node as `supervisoryBody` through `/api/ingest/company` - the
 * same division of labour `companyCategories.ts` has, and for the same reason:
 * the answer comes from the register's `formaPrawna`, which the site never
 * sees.
 */

export const supervisoryBodies = [
  {
    value: "rada-nadzorcza",
    title: "Rada Nadzorcza",
    /** Whether sitting here is a post the site counts as employment. */
    paidPost: true,
  },
  { value: "rada-spoleczna", title: "Rada Społeczna", paidPost: false },
] as const satisfies readonly {
  value: string;
  title: string;
  paidPost: boolean;
}[];

export type SupervisoryBody = (typeof supervisoryBodies)[number]["value"];

/** The body values, as a tuple, for `z.enum` and for anything checking that a
 * stored value is still one the site knows about. */
export const supervisoryBodyValues = supervisoryBodies.map((b) => b.value) as [
  SupervisoryBody,
  ...SupervisoryBody[],
];

/** What the register calls this organ.
 *
 * Falls back to the stored value for a body the pipelines know about and this
 * list does not yet - the two deploy separately - so the label is visible
 * rather than blank when something needs adding here.
 */
export function supervisoryBodyTitle(value: string): string {
  return supervisoryBodies.find((b) => b.value === value)?.title ?? value;
}

/** Whether a seat on this organ counts as employment.
 *
 * `undefined` is true, and that is the whole of the default: an institution
 * whose form nobody read, or one the pipelines have nothing special to say
 * about, keeps counting its supervisory seats exactly as the site did before
 * this module existed. Only a body explicitly recorded as unpaid changes
 * anything, which is the same direction `Company.isPublic` errs in.
 */
export function bodyIsPaidPost(value: string | undefined | null): boolean {
  if (!value) return true;
  return supervisoryBodies.find((b) => b.value === value)?.paidPost ?? true;
}

/** Polish, lowercased and stripped of its diacritics, for comparing role text.
 *
 * Roles are free text: 9,848 edges say "Rada Nadzorcza" and another 29 say the
 * same thing in nine other spellings - "rada nadzorcza", "członek rady
 * nadzorczej", "Przewodniczący Rady Nadzorczej" - because /api/edges/create
 * takes whatever a reviewer types. Anything comparing them has to fold case
 * and diacritics or it reads a hand-entered seat as something else entirely.
 */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase();
}

/** Whether a role names a seat on the company's supervisory organ, rather than
 * a post in its management.
 *
 * Both wordings, because both occur and both mean the same seat: the stored
 * edges say "Rada Nadzorcza" whatever the register calls the organ, and a
 * reviewer entering one by hand at a hospital may well write "Rada Społeczna".
 *
 * Deliberately narrow. "Zarząd" is not a match, which is what keeps the 16
 * stored `Zarząd` edges at SPZOZ hospitals - their kierownik, a salaried
 * director - counted as the employment they are. Neither is "rada powiatu",
 * "radny dzielnicy" or "doradca społeczny": the organ's name is two words and
 * both have to be there.
 */
export function namesASupervisorySeat(
  role: string | undefined | null,
): boolean {
  if (!role) return false;
  return /\brad\w*\s+(nadzorcz|spolecz)\w*/.test(fold(role));
}

/** The role as it should read, given what supervises the institution.
 *
 * Every supervisory seat is stored as "Rada Nadzorcza" whatever the register
 * calls the organ, so a hospital's page says its rada społeczna is a
 * supervisory board. This is what puts the register's own word back on screen,
 * without touching the stored edge - `employed` edges are identified by their
 * name (see `EDGE_SEMANTICS` in `server/utils/edges.ts`), so rewriting one
 * would change its document id and the next ingest would store the seat a
 * second time under the old name.
 *
 * Only the bare organ name is rewritten. "Przewodniczący Rady Nadzorczej" is
 * left exactly as it stands: a spelled-out role was typed by a person through
 * /api/edges/create, and inflecting somebody's sentence into a different organ
 * is putting words in their mouth. All 892 stored SPZOZ seats say the bare
 * name, so nothing real is missed by being careful here.
 */
export function displayRole(
  role: string | undefined | null,
  company: { supervisoryBody?: string } | undefined | null,
): string | undefined {
  const body = company?.supervisoryBody;
  // `|| undefined` rather than `?? undefined`: an edge with `name: ""` has no
  // role at all - /api/edges/create writes one for every box the form left
  // blank - and a caller asking for the role of one wants nothing back, not an
  // empty string it has to check for itself.
  if (!role || !body) return role || undefined;
  const folded = fold(role);
  if (!supervisoryBodies.some((b) => fold(b.title) === folded)) return role;
  return supervisoryBodyTitle(body);
}
