import { createHash } from "node:crypto";
import type { Edge } from "~~/shared/model";

/** What kind of assertion an edge type makes, which is what decides when two of
 * them are the same fact.
 *
 * - `state`: the tie either holds or it does not. An article names a person; a
 *   region owns a company. There is nothing to count, so a second copy asserts
 *   nothing new and is always redundant.
 * - `occurrence`: one bounded episode, and a person can genuinely have several
 *   between the same pair - two spells at one company with a break in between,
 *   two candidacies in one region. Two of them are the same episode only when
 *   the fields that pin the episode down are present and equal.
 * - `authored`: something a person wrote. Two notes about the same pair are two
 *   notes. Never merged automatically, whatever the fields say.
 */
export type EdgeKind = "state" | "occurrence" | "authored";

type EdgeSemantics = {
  kind: EdgeKind;
  /** Fields beyond the pair that say *which* episode this is. Empty for state
   * types, where the pair is the whole assertion. */
  discriminators: readonly string[];
  /** Whether two stored edges agreeing on all of the above may be treated as
   * one fact by a migration. False where the pipeline is known to destroy the
   * difference between two real facts, so "identical" proves nothing. */
  identicalMeansSame: boolean;
};

export const EDGE_SEMANTICS: Record<string, EdgeSemantics> = {
  // A company's seat, its owner, the region above it: all one per pair.
  owns: { kind: "state", discriminators: [], identicalMeansSame: true },
  // An article names a person or a company. Naming them twice is one fact.
  mentions: { kind: "state", discriminators: [], identicalMeansSame: true },
  // A pointer to a document in the `comments` collection, which holds the text.
  comment: { kind: "state", discriminators: [], identicalMeansSame: true },
  // Undeclared in shared/model.ts, but 64 are stored: bare triples that predate
  // article nodes.
  source: { kind: "state", discriminators: [], identicalMeansSame: true },

  // A spell of employment, pinned by the role and when it began. `end_date` is
  // not a discriminator: it is learned later, so one spell recorded twice -
  // once still open, once since closed - is one episode. Two real spells always
  // differ in `start_date`, which is what "employed there again after a break"
  // means.
  employed: {
    kind: "occurrence",
    discriminators: ["name", "start_date"],
    identicalMeansSame: true,
  },

  // A candidacy, and the one type where identical fields prove nothing. What
  // would tell two candidacies apart is destroyed before the ingest sees them:
  // the office collapses into the "Samorząd" bucket (all six 2024 PKW candidate
  // files map onto it), the gmina TERYT is truncated to its powiat, `committee`
  // is dropped at the API boundary because shared/api.ts accepts only `party`,
  // and the run-off round is discarded by the scraper. So standing for
  // burmistrz and for that gmina's rada in 2024 stores two byte-identical
  // documents - and so does one mayoral bid that went to a second round.
  // Nothing stored separates the two cases, so nothing may merge them.
  election: {
    kind: "occurrence",
    discriminators: ["position", "start_date", "party", "committee", "term"],
    identicalMeansSame: false,
  },

  // Written by hand through /api/edges/create, never by an ingest.
  connection: {
    kind: "authored",
    discriminators: ["name", "content", "start_date", "end_date"],
    identicalMeansSame: false,
  },
};

/** What an unknown edge type is assumed to be.
 *
 * `authored` on purpose: it is the reading under which nothing is merged
 * automatically, so a type nobody has classified yet cannot lose data.
 */
const UNKNOWN: EdgeSemantics = {
  kind: "authored",
  discriminators: ["name", "content", "start_date", "end_date"],
  identicalMeansSame: false,
};

export function edgeSemantics(type: string | undefined) {
  return (type && EDGE_SEMANTICS[type]) || UNKNOWN;
}

export type EdgeLike = Partial<Edge> & Pick<Edge, "source" | "target" | "type">;

/** One writer's "unset" has to equal another's.
 *
 * /api/edges/create writes `name: ""`, `party: ""` and `elected: false` for
 * every field the form left blank, while the ingest omits them entirely. Left
 * alone a hand-made edge could never match an ingested one asserting the same
 * thing, and the database would keep both.
 */
function field(edge: EdgeLike, name: string): unknown {
  const value = (edge as Record<string, unknown>)[name];
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === false
  ) {
    return null;
  }
  return value;
}

/** What the edge asserts, as a string two edges can be compared by.
 *
 * Type-aware: for a state edge the pair is the whole of it, so an `owns` edge
 * that picked up a stray date still asserts the same tie. For an occurrence
 * edge the discriminators are part of the assertion, so two spells starting on
 * different days are two facts.
 */
export function edgeIdentity(edge: EdgeLike): string {
  const { discriminators } = edgeSemantics(edge.type);
  return JSON.stringify([
    edge.source,
    edge.target,
    edge.type,
    ...discriminators.map((name) => field(edge, name)),
  ]);
}

/** The document id an edge should be stored under.
 *
 * Deriving it from the identity means writing the same edge twice lands on one
 * document rather than two, which a lookup cannot guarantee: the ingest writes
 * through a batch, and a query does not see writes still sitting in it.
 *
 * `occurrence` says which copy this is among the ones a payload asserts with
 * the same identity. It exists because an occurrence edge may legitimately
 * repeat with nothing to tell the copies apart - a payload listing two 2024
 * candidacies in one powiat states two facts, and both have to be stored. Copy
 * 0 keeps the plain digest, so the ordinary case is unchanged.
 *
 * State edges ignore it: they cannot repeat, so they always get the bare
 * `edge_<source>_<target>_<type>` form the company ingest and the region
 * pipeline already write.
 */
export function edgeDocumentId(edge: EdgeLike, occurrence = 0): string {
  const base = `edge_${edge.source}_${edge.target}_${edge.type}`;
  const { kind, discriminators } = edgeSemantics(edge.type);
  if (kind === "state") return base;

  const parts: unknown[] = discriminators.map((name) => field(edge, name));
  if (occurrence > 0) parts.push(occurrence);
  if (parts.every((value) => value === null)) return base;

  const digest = createHash("sha1")
    .update(JSON.stringify(parts))
    .digest("base64url")
    .slice(0, 10);
  return `${base}_${digest}`;
}

/** Every stored edge asserting the same thing as `edge`, by id.
 *
 * A list rather than one match, because an occurrence edge may legitimately
 * have several. The caller takes the n-th when it is placing the n-th copy from
 * a payload, which is what stops re-ingesting that payload growing the
 * collection while still letting it hold two.
 *
 * Queried on the three fields every edge has - an equality-only query Firestore
 * serves from its single field indexes, with no composite index to declare -
 * and narrowed in memory. Comparing the discriminators in memory rather than in
 * the query avoids Firestore's rule that a document missing a field matches no
 * filter on it, which would make an edge stored without `start_date`
 * unfindable by a lookup that supplies one.
 */
export async function findEdges(
  db: FirebaseFirestore.Firestore,
  edge: EdgeLike,
): Promise<string[]> {
  const snapshot = await db
    .collection("edges")
    .where("source", "==", edge.source)
    .where("target", "==", edge.target)
    .where("type", "==", edge.type)
    .get();

  const identity = edgeIdentity(edge);
  return snapshot.docs
    .filter((doc) => edgeIdentity(doc.data() as EdgeLike) === identity)
    .map((doc) => doc.id)
    .sort();
}

/** The edge already asserting this, if there is one. */
export async function findEdge(
  db: FirebaseFirestore.Firestore,
  edge: EdgeLike,
): Promise<string | undefined> {
  return (await findEdges(db, edge))[0];
}
