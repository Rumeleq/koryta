import type { EdgeType, NodeType } from "./model";

/** What somebody an analysis has been shared with may do with it.
 *
 * An editor can change everything the view offers, including who else it is
 * shared with - the people using this are working a case together, and having
 * to go back to one person to add a fourth collaborator is friction the feature
 * exists to remove. Only the owner (and an admin) can delete it, which is why
 * `ownerUid` is pinned by the firestore rules rather than being just another
 * entry in `members`.
 */
export type AnalysisRole = "viewer" | "editor";

/** Prefix on the id of an entity that exists only inside an analysis.
 *
 * Somebody being interviewed names a person the base has never heard of. The
 * point of the analysis is to be able to write that down immediately, so the
 * entity is created in the analysis document with an id of its own and is
 * drawn on the graph like any other. `promoteEntity` later turns one into a
 * real proposal, and the local entity keeps its id and gains `promotedNodeId`
 * so that everything already pointing at it still resolves.
 */
export const LOCAL_ENTITY_PREFIX = "local:";

/** Whether an id names an analysis-local entity rather than a node in the base. */
export function isLocalEntityId(id: string): boolean {
  return id.startsWith(LOCAL_ENTITY_PREFIX);
}

/** One person, company, article or region the analysis is about.
 *
 * `name` is stored rather than looked up, so the right hand panel and the
 * pickers can render a list without a round trip per row, and so a local entity
 * - which has no node to look up at all - is not a special case everywhere.
 */
export type AnalysisEntity = {
  id: string;
  type: NodeType;
  name: string;
  /** Why this one is in the analysis. Free text, shown under the name. */
  note?: string;
  addedBy: string;
  /** ISO string. Written by the browser: nothing here is ordered across users
   * tightly enough for a clock skew to matter, and `serverTimestamp()` cannot
   * be used inside an array element anyway. */
  addedAt: string;
  /** Set once a local entity has been proposed to the base, so the analysis can
   * link to the pending page instead of offering to propose it a second time. */
  promotedNodeId?: string;
};

/** A relation asserted inside the analysis.
 *
 * Deliberately not an `edges` document: most of these start life as something
 * one interviewee said about two people, which is not yet a claim the base
 * should be making. `promoteEdge` writes one through to /api/edges/create,
 * where it becomes a proposal like any other and waits for a reviewer.
 */
export type AnalysisEdge = {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  /** What the relation is called, e.g. "szwagier". Falls back to the label for
   * `type` when empty. */
  name?: string;
  /** What was actually said - the note the relation came from. */
  content?: string;
  addedBy: string;
  addedAt: string;
  /** Id of the edge written to the base, once somebody has proposed it. */
  promotedEdgeId?: string;
};

/** A note written inside the analysis, about one entity or about the case.
 *
 * Separate from the `notes` collection, which is per (node, user) and public.
 * These are visible to everyone the analysis is shared with and to nobody else,
 * which is what makes them usable for what an interviewee said.
 */
export type AnalysisNote = {
  id: string;
  /** The entity this is about. Absent means it is about the case as a whole. */
  entityId?: string;
  content: string;
  authorUid: string;
  createdAt: string;
  updatedAt?: string;
};

/** One collaborative investigation: who is in it, and what is being drawn.
 *
 * The whole thing is a single Firestore document rather than a document with
 * subcollections. That buys the two properties this view is built around: one
 * `useDocument` subscription makes every change any collaborator makes appear
 * on everybody's graph live, and the firestore rules that express the sharing
 * are written once. A case with a few hundred entities is far inside the 1 MB
 * document limit; should one ever approach it, the arrays are what would move
 * to subcollections.
 */
export type Analysis = {
  id?: string;
  title: string;
  description?: string;
  ownerUid: string;
  members: Record<string, AnalysisRole>;
  /** The keys of `members`, repeated so the list query can be
   * `where("memberUids", "array-contains", uid)` - firestore cannot filter on
   * map keys. Kept in step by `writeMembers` on the server. */
  memberUids: string[];
  entities: AnalysisEntity[];
  edges: AnalysisEdge[];
  notes: AnalysisNote[];
  /** How many hops out of the entities of interest to pull in from the base. */
  depth: number;
  createdAt: string;
  updatedAt: string;
};

/** Beyond two hops the graph stops being about the case and starts being about
 * the database - a single well connected company drags in hundreds of people. */
export const ANALYSIS_MAX_DEPTH = 2;

/** What `uid` may do with `analysis`, or null if they may not see it at all.
 *
 * Admins are treated as editors everywhere rather than being given a role of
 * their own: the moderation case is "open somebody's analysis and fix it", not
 * a separate set of powers.
 */
/** Every field optional because the argument is a Firestore document as read
 * back, not something this code constructed - a hand-edited one can be missing
 * anything, and the answer for it should be "no access" rather than a throw. */
type AnalysisAccess = {
  ownerUid?: string;
  members?: Record<string, AnalysisRole>;
};

export function analysisRole(
  analysis: AnalysisAccess | null | undefined,
  uid: string | null | undefined,
  isAdmin = false,
): AnalysisRole | null {
  if (!analysis) return null;
  if (isAdmin) return "editor";
  if (!uid) return null;
  if (analysis.ownerUid === uid) return "editor";
  return analysis.members?.[uid] ?? null;
}

export function canEditAnalysis(
  analysis: AnalysisAccess | null | undefined,
  uid: string | null | undefined,
  isAdmin = false,
): boolean {
  return analysisRole(analysis, uid, isAdmin) === "editor";
}

export function canDeleteAnalysis(
  analysis: Pick<AnalysisAccess, "ownerUid"> | null | undefined,
  uid: string | null | undefined,
  isAdmin = false,
): boolean {
  if (!analysis) return false;
  return isAdmin || (!!uid && analysis.ownerUid === uid);
}

export const analysisRoleLabel: Record<AnalysisRole, string> = {
  viewer: "Może przeglądać",
  editor: "Może edytować",
};

/** A fresh analysis, owned by and shared with nobody but `uid`. */
export function emptyAnalysis(uid: string, title: string, now: string) {
  return {
    title,
    ownerUid: uid,
    members: { [uid]: "editor" as AnalysisRole },
    memberUids: [uid],
    entities: [],
    edges: [],
    notes: [],
    depth: 1,
    createdAt: now,
    updatedAt: now,
  } satisfies Omit<Analysis, "id">;
}
