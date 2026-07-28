import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import { WebClient, type KnownBlock } from "@slack/web-api";
import { buildFeedbackBlocks, buildFeedbackFallback } from "./slack";
import type { Feedback } from "./model";

if (getApps().length === 0) {
  initializeApp();
}

const slackBotToken = defineSecret("SLACK_BOT_TOKEN");

/** The channel id is configuration rather than a secret, so it comes from the
 * environment (functions/.env) instead of Secret Manager. Read straight from
 * process.env and not through `defineString`: a declared param with no value
 * makes the emulator prompt for one on stdin, which hangs `npm run dev:local`
 * and anything running it unattended. */
const slackChannel = () => process.env.SLACK_FEEDBACK_CHANNEL ?? "";

const BASE_URL = "https://koryta.pl";

/** Eventarc keeps redelivering for days; a permanent failure should not ride
 * that all the way out. */
const MAX_ATTEMPTS = 5;

/** Slack errors that will never succeed on retry - our bug or our config,
 * not a blip. Retrying these burns the whole Eventarc window for nothing. */
const PERMANENT_SLACK_ERRORS = new Set([
  "invalid_blocks",
  "invalid_auth",
  "channel_not_found",
  "not_in_channel",
  "missing_scope",
  "is_archived",
  "msg_too_long",
  "no_text",
]);

function slackErrorCode(error: unknown): string | undefined {
  return (error as { data?: { error?: string } }).data?.error;
}

/** 429 and 5xx are worth another go; anything Slack names in
 * PERMANENT_SLACK_ERRORS is not. */
function isRetryable(error: unknown): boolean {
  const code = slackErrorCode(error);
  if (code && PERMANENT_SLACK_ERRORS.has(code)) return false;

  const status = (error as { statusCode?: number }).statusCode;
  if (status === 429 || (status && status >= 500)) return true;

  // Network failures arrive without a Slack error body at all.
  return code === undefined;
}

/** Forward a new piece of feedback into the team's Slack channel.
 *
 * Runs here rather than in /api/feedback/create so a reporter never waits on
 * Slack and never sees it fail: the document is already saved, and Eventarc
 * retries this until it lands. Firestore triggers are at-least-once, so the
 * first thing the handler does is claim the document.
 */
export const onFeedbackCreated = onDocumentCreated(
  {
    document: "feedback/{feedbackId}",
    database: "koryta-pl",
    region: "europe-west1",
    secrets: [slackBotToken],
    retry: true,
  },
  async (event) => {
    const token = slackBotToken.value();
    const channel = slackChannel();
    // An unset secret reads as "", which is how local and preview environments
    // stay quiet without anyone having to remember to disable this.
    if (!token || !channel) {
      logger.info("Slack is not configured, skipping feedback forward");
      return;
    }

    const feedbackId = event.params.feedbackId;
    const db = getFirestore("koryta-pl");
    const ref = db.collection("feedback").doc(feedbackId);

    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;

      const data = snap.data() as Feedback;
      const slack = data.slack;

      // Firestore triggers are at-least-once, so claiming the document in a
      // transaction is what stops a redelivery posting the card twice. Both
      // terminal states are final: "failed" is either a bug of ours or the
      // daily cap, and retrying either just burns the retry window.
      if (slack?.state === "sent" || slack?.state === "failed") return null;
      if ((slack?.attempts ?? 0) >= MAX_ATTEMPTS) return null;

      tx.update(ref, {
        slack: {
          state: "sending",
          attempts: (slack?.attempts ?? 0) + 1,
        },
      });

      return { ...data, id: feedbackId } as Feedback;
    });

    if (!claimed) {
      logger.info(`Feedback ${feedbackId} already handled, skipping`);
      return;
    }

    const client = new WebClient(token);

    try {
      const result = await client.chat.postMessage({
        channel,
        text: buildFeedbackFallback(claimed),
        // The builder is deliberately SDK-free so the frontend can test it;
        // its blocks are plain Block Kit JSON.
        blocks: buildFeedbackBlocks(claimed, {
          baseUrl: BASE_URL,
        }) as unknown as KnownBlock[],
        unfurl_links: false,
        unfurl_media: false,
      });

      await ref.update({
        "slack.state": "sent",
        "slack.ts": result.ts,
        "slack.channel": result.channel ?? channel,
      });

      logger.info(`Forwarded feedback ${feedbackId} to Slack`);
    } catch (error) {
      const code = slackErrorCode(error) ?? "unknown";

      if (isRetryable(error)) {
        logger.warn(
          `Slack forward for ${feedbackId} failed (${code}), retrying`,
          error,
        );
        // Thrown, so Eventarc backs off and redelivers.
        throw error;
      }

      logger.error(
        `Slack forward for ${feedbackId} failed permanently (${code})`,
        error,
      );
      await ref.update({ "slack.state": "failed", "slack.error": code });
    }
  },
);
