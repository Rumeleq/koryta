/** The decisions only an administrator can make, kept as their own record.
 *
 * Everything else a person does to the data leaves a document behind that says
 * who did it: a vote, a note, a revision. The two decisions that settle what
 * the public actually sees did not. Approving was written onto the revision
 * (`review_user`), which holds only the latest verdict — re-approving an older
 * version overwrites who chose the newer one — and publishing was written
 * nowhere at all, so `published` on a node said what the answer is and never
 * who gave it.
 *
 * So these go in a collection of their own, append-only. It is the history the
 * node cannot hold, and it is what shows two admins undoing each other rather
 * than leaving a flag that flipped for no visible reason.
 */
export const auditActions = [
  "approve",
  "reject",
  "publish",
  "unpublish",
  "delete",
] as const;

export type AuditAction = (typeof auditActions)[number];

export type AuditEntry = {
  action: AuditAction;
  /** Which collection `target_id` names — `node_id` on a revision holds the id
   * whether the target is a node or an edge, so it cannot be inferred. */
  collection: "nodes" | "edges";
  target_id: string;
  /** The revision approved or turned down. Absent for publish/unpublish, which
   * change who can see a page rather than what it says. */
  revision_id?: string;
  /** The admin's uid. */
  user: string;
  /** ISO 8601, UTC. A string rather than a Timestamp so the activity scan is a
   * plain range query on one field, the way votes and notes are read. */
  at: string;
  /** Why the suggestion was turned down, or why the entry was removed. Only a
   * rejection and a removal carry one. */
  reason?: string;
};

/** Whether the action decides visibility rather than content, which is the cut
 * that matters when reading the log back: two admins disagreeing about whether
 * a page should be live is a different conflict from disagreeing about what it
 * should say. */
export function isVisibilityAction(action: AuditAction): boolean {
  return action === "publish" || action === "unpublish";
}

export const auditActionLabels: Record<AuditAction, string> = {
  approve: "Zatwierdzenie rewizji",
  reject: "Odrzucenie rewizji",
  publish: "Opublikowanie strony",
  unpublish: "Ukrycie strony",
  delete: "Usunięcie wpisu",
};
