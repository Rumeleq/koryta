import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody } from "h3";
import { getUser } from "~~/server/utils/auth";

const bodyValidator = z.object({
  id: z.string().min(1),
  // `undefined` leaves the field untouched, `null`/"" clears it.
  adminStatus: z
    .enum(["new", "in_progress", "resolved", "wont_fix"])
    .optional(),
  adminNote: z.string().max(2000).nullable().optional(),
});

/** Admin-only triage of a feedback item. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  if (!user.admin) {
    throw createError({
      statusCode: 403,
      message: "Brak uprawnień administratora.",
    });
  }

  const body = await readValidatedBody(event, (b) => bodyValidator.parse(b));

  const db = getFirestore("koryta-pl");
  const ref = db.collection("feedback").doc(body.id);
  const snap = await ref.get();
  if (!snap.exists) {
    throw createError({ statusCode: 404, message: "Zgłoszenie nie istnieje." });
  }

  const patch: Record<string, unknown> = {};
  if (body.adminStatus !== undefined) patch.adminStatus = body.adminStatus;
  if (body.adminNote !== undefined) patch.adminNote = body.adminNote || "";

  if (Object.keys(patch).length > 0) await ref.update(patch);

  return { ok: true };
});
