import type { Firestore, WriteBatch } from "firebase-admin/firestore";
import type { AuditEntry } from "~~/shared/audit";

/** Files one administrator decision in the `audit` collection.
 *
 * The batch is required rather than optional: the record has to land in the
 * same commit as the change it describes, or the half-way state - a node
 * rewritten with nothing saying who chose it - is exactly what the log was
 * meant to rule out. A caller with a single field to write opens a batch for
 * the pair.
 *
 * `at` is stamped here rather than by the caller so every entry is dated by the
 * same clock, and so no endpoint can forget.
 */
export function recordAudit(
  db: Firestore,
  entry: Omit<AuditEntry, "at">,
  batch: WriteBatch,
): void {
  const ref = db.collection("audit").doc();
  batch.set(ref, {
    ...entry,
    at: new Date().toISOString(),
  } satisfies AuditEntry);

  console.info(
    `Audit ${entry.action} ${entry.collection}/${entry.target_id}` +
      (entry.revision_id ? ` revision=${entry.revision_id}` : "") +
      ` by=${entry.user}`,
  );
}
