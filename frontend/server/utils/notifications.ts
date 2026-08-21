import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import {
  notificationEnabled,
  renderNotification,
  type NotificationEvent,
  type NotificationKind,
  type NotificationPreferences,
} from "~~/shared/notifications";

/** Why a message was not sent, so a log line says something more useful than
 * nothing happening. `sent` is the only outcome that queued anything. */
export type NotificationOutcome =
  | "sent"
  | "duplicate"
  | "opted-out"
  | "no-address"
  | "unverified-address"
  | "self"
  /** Nobody to write to: the change came from a pipeline, or from a revision
   * written before `update_user` was recorded. */
  | "no-recipient"
  | "failed";

/** Queues a message for `uid`, if they want it and we may write to them.
 *
 * Nothing is sent from here. The document lands in `mail`, and the Firebase
 * "Trigger Email from Firestore" extension picks it up, delivers it and writes
 * the outcome back onto the same document - so retries, bounces and SMTP
 * credentials are not this codebase's problem, and an emulator run just leaves
 * the queue to be inspected.
 *
 * This never throws. A notification is a courtesy attached to an action that
 * has already been committed; failing the admin's request because an address
 * could not be looked up would undo nothing and help nobody.
 *
 * @param dedupeKey what makes two calls the same message. The same key writes
 * one email however many times it is passed, so a double-clicked review button
 * does not send twice; deciding what "the same" means is the caller's, since
 * only it knows whether a repeat says anything new.
 */
export async function notifyUser(
  db: Firestore,
  uid: string,
  event: NotificationEvent,
  options: { dedupeKey: string; actorUid?: string; siteUrl: string },
): Promise<NotificationOutcome> {
  try {
    // Reviewing your own suggestion is how an admin edits a page, and mailing
    // somebody about what they just did themselves reads as a bug.
    if (options.actorUid && options.actorUid === uid) return "self";

    if (!(await wantsNotification(db, uid, event.kind))) return "opted-out";

    const address = await verifiedEmail(uid, event.kind);
    if ("refused" in address) return address.refused;

    const message = renderNotification(event, options.siteUrl);
    const ref = db
      .collection("mail")
      .doc(mailDocId(event.kind, options.dedupeKey));

    // `create` rather than `set`: the extension re-sends a document whose
    // `delivery` field is missing, and overwriting a delivered one strips it.
    // A rejected create is the dedupe working, not an error.
    try {
      await ref.create({
        to: [address.email],
        message,
        // Not read by the extension - here so a failed delivery in the console
        // can be traced back to what triggered it.
        kind: event.kind,
        uid,
        created_at: Timestamp.now(),
      });
    } catch (error) {
      if (isAlreadyExists(error)) return "duplicate";
      throw error;
    }

    console.info(`Queued ${event.kind} notification for uid=${uid}`);
    return "sent";
  } catch (error) {
    console.error(
      `Failed to queue ${event.kind} notification for ${uid}`,
      error,
    );
    return "failed";
  }
}

/** Firestore ids may not contain a slash, and a dedupe key derived from a
 * document path can. */
function mailDocId(kind: NotificationKind, dedupeKey: string): string {
  return `${kind}_${dedupeKey.replace(/\//g, "_")}`;
}

async function wantsNotification(
  db: Firestore,
  uid: string,
  kind: NotificationKind,
): Promise<boolean> {
  const snapshot = await db.collection("users").doc(uid).get();
  const preferences = snapshot.data()?.notifications as
    NotificationPreferences | undefined;
  return notificationEnabled(kind, preferences);
}

/** The address to write to, refusing one whose owner never proved they own it.
 *
 * Firebase leaves an email/password signup unverified, and anybody may register
 * with anybody's address. Without this check, proposing a revision from an
 * account opened under someone else's email turns an admin's review into mail
 * that person did not ask for. `/profil` offers to send the verification link.
 */
async function verifiedEmail(
  uid: string,
  kind: NotificationKind,
): Promise<{ email: string } | { refused: NotificationOutcome }> {
  const user = await getAuth().getUser(uid);
  if (!user.email) return { refused: "no-address" };
  if (!user.emailVerified) {
    console.info(
      `Skipping ${kind} notification for uid=${uid}: address not verified`,
    );
    return { refused: "unverified-address" };
  }
  return { email: user.email };
}

function isAlreadyExists(error: unknown): boolean {
  // grpc ALREADY_EXISTS. firebase-admin surfaces the numeric code rather than
  // a named error class.
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === 6
  );
}
