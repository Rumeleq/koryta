import { z } from "zod";
import { getFirestore } from "firebase-admin/firestore";
import { defineEventHandler, readValidatedBody } from "h3";
import { getOptionalUser } from "~~/server/utils/auth";
import type { Feedback } from "~~/shared/model";

const bodyValidator = z.object({
  kind: z.enum(["bug", "idea", "data", "other"]),
  message: z.string().trim().min(1).max(4000),
  // Only ever shown to us, and only if the reporter chose to leave it.
  contact: z.string().trim().max(200).optional(),
  // Hidden in the form, so only a bot filling every input reaches this.
  website: z.string().max(200).optional(),
  context: z.object({
    // Must be a site-relative path. The admin panel turns this into a link,
    // so anything else is a way for an anonymous reporter to hand an admin a
    // `javascript:` URL or a convincing phishing destination. A single leading
    // slash, never two, which would make it protocol-relative.
    route: z
      .string()
      .max(500)
      .regex(/^\/(?!\/)/, "Ścieżka musi być względna."),
    nodeId: z.string().max(200).optional(),
    pageTitle: z.string().max(300).optional(),
    viewport: z
      .object({
        width: z.number().int().positive().max(20000),
        height: z.number().int().positive().max(20000),
      })
      .optional(),
  }),
});

/** Ceiling on reports accepted in a day, far above any plausible real volume.
 * Breaching it does not reject the report - it saves it and suppresses the
 * Slack forward, so an abuser can flood the admin queue but cannot flood the
 * team's channel, and a real reporter is never turned away. */
const DAILY_SLACK_CAP = 500;

async function slackForwardAllowed(
  db: ReturnType<typeof getFirestore>,
): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db.collection("feedbackLimits").doc(day);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = (snap.get("count") as number | undefined) ?? 0;
    tx.set(ref, { count: count + 1, day }, { merge: true });
    return count < DAILY_SLACK_CAP;
  });
}

/** Accept a piece of user feedback.
 *
 * Deliberately open to signed-out visitors: the whole point is to lower the
 * bar for telling us something is wrong. Writes go through the admin SDK so
 * `feedback` stays closed to the client SDK entirely.
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (b) => bodyValidator.parse(b));
  const user = await getOptionalUser(event);

  // A filled honeypot means a bot walked the form. Answer as if it worked -
  // telling a spammer which of their submissions were dropped is how they
  // learn to get past this.
  if (body.website) return { id: null };

  const db = getFirestore("koryta-pl");
  const forwardToSlack = await slackForwardAllowed(db);

  const doc: Feedback = {
    kind: body.kind,
    message: body.message,
    context: {
      ...body.context,
      // Read from the request rather than the body: the client has no reason
      // to be trusted about this, and it is the same string either way.
      userAgent: getRequestHeader(event, "user-agent")?.slice(0, 500),
    },
    createdAt: new Date().toISOString(),
    adminStatus: "new",
    ...(user ? { userUid: user.uid } : {}),
    ...(body.contact ? { contact: body.contact } : {}),
    // Marking it already-handled is what stops the trigger forwarding it.
    ...(forwardToSlack
      ? {}
      : { slack: { state: "failed" as const, error: "daily_cap" } }),
  };

  const ref = await db.collection("feedback").add(doc);

  return { id: ref.id };
});
