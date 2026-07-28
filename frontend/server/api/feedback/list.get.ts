import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, getValidatedQuery } from "h3";
import { getUser } from "~~/server/utils/auth";
import type { Feedback, FeedbackStatus } from "~~/shared/model";

const queryValidator = z.object({
  status: z
    .enum(["new", "in_progress", "resolved", "wont_fix"])
    .optional()
    .catch(undefined),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** Admin-only listing of feedback. `feedback` has no Firestore rules block, so
 * the client SDK cannot read it — this route is the only way in. */
export default defineEventHandler(async (event) => {
  const user = await getUser(event);
  if (!user.admin) {
    throw createError({
      statusCode: 403,
      message: "Brak uprawnień administratora.",
    });
  }

  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));

  const db = getFirestore("koryta-pl");
  let ref = db.collection("feedback").orderBy("createdAt", "desc");
  if (query.status) {
    ref = ref.where("adminStatus", "==", query.status as FeedbackStatus);
  }

  const snapshot = await ref.limit(query.limit).get();

  return {
    feedback: snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Feedback),
    })),
  };
});
