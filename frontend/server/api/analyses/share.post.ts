import { z } from "zod";
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody } from "h3";
import { getUser } from "~~/server/utils/auth";
import { analysesCollection, requireAnalysis } from "~~/server/utils/analyses";

/** Either an email to invite with a role, or a uid to drop (`role: null`). */
const bodyValidator = z.union([
  z.object({
    id: z.string().min(1),
    email: z.string().email("Podaj poprawny adres e-mail"),
    role: z.enum(["viewer", "editor"]),
  }),
  z.object({
    id: z.string().min(1),
    uid: z.string().min(1),
    role: z.null(),
  }),
]);

/** Add somebody to an analysis, change what they may do, or remove them.
 *
 * On the server because only the admin SDK can turn an email address into a
 * uid, and because `members` and `memberUids` have to move together - the
 * second is only there so the list query can filter on it, and an analysis
 * whose two copies disagree either vanishes from somebody's list or shows up
 * in a list it cannot be opened from.
 *
 * Any editor may share, which is deliberate: the people using this work a case
 * together, and having to go back to one person to add a fourth collaborator is
 * exactly the friction the view exists to remove. The owner cannot be removed
 * or demoted, since `ownerUid` is what decides who may delete the analysis.
 */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  const body = await readValidatedBody(event, (b) => bodyValidator.parse(b));
  const { data } = await requireAnalysis(user, body.id, "write");
  const ref = analysesCollection().doc(body.id);
  const now = new Date().toISOString();

  if (body.role === null) {
    if (body.uid === data.ownerUid) {
      throw createError({
        statusCode: 400,
        message: "Nie można usunąć właściciela analizy.",
      });
    }
    await ref.update({
      [`members.${body.uid}`]: FieldValue.delete(),
      memberUids: FieldValue.arrayRemove(body.uid),
      updatedAt: now,
    });
    return { uid: body.uid, removed: true };
  }

  let invited;
  try {
    invited = await getAuth().getUserByEmail(body.email);
  } catch {
    // Said plainly rather than hidden behind a success: the caller is inviting
    // somebody they know, and "shared" followed by silence would be worse than
    // being told the address has no account here.
    throw createError({
      statusCode: 404,
      message: `Nie ma użytkownika o adresie ${body.email}.`,
    });
  }

  if (invited.uid === data.ownerUid && body.role !== "editor") {
    throw createError({
      statusCode: 400,
      message: "Właściciel analizy zawsze może ją edytować.",
    });
  }

  await ref.update({
    [`members.${invited.uid}`]: body.role,
    memberUids: FieldValue.arrayUnion(invited.uid),
    updatedAt: now,
  });

  return {
    uid: invited.uid,
    displayName: invited.displayName ?? null,
    email: invited.email ?? null,
    role: body.role,
  };
});
