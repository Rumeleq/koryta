import type { Feedback } from "./model";
import { feedbackKindLabels } from "./model";

/** Block Kit is structural JSON; typing it properly would mean pulling
 * @slack/web-api into the frontend's dependency tree for no benefit, since the
 * only consumer that talks to Slack is the Cloud Function. */
type SlackBlock = Record<string, unknown>;

/** Slack's own limits, which reject the whole call rather than truncating. */
const SECTION_TEXT_LIMIT = 3000;
const HEADER_TEXT_LIMIT = 150;
/** Leaves room for the escaping below to grow the string. */
const MESSAGE_LIMIT = 2800;

const KIND_EMOJI: Record<Feedback["kind"], string> = {
  bug: "🐞",
  data: "📊",
  idea: "💡",
  other: "💬",
};

/** Escape the three characters Slack's mrkdwn treats as markup.
 *
 * Order matters: `&` first, or the entities written by the later two get
 * double-escaped. Without this a reporter can write `<https://evil|klik>` and
 * have it render in the channel as a link we appear to have sent.
 */
export function escapeMrkdwn(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export type FeedbackBlocksOptions = {
  /** Origin the relative route is resolved against, without a trailing slash. */
  baseUrl: string;
};

/** Who to credit.
 *
 * A volunteered e-mail is deliberately *not* copied into the channel: it is
 * the one directly identifying thing in the payload, Slack history outlives
 * our own retention, and the admin panel is one click away on the card. */
function reporterField(feedback: Feedback): string {
  // A signed-in report reads as signed-in even when an address came with it,
  // since a signed-in reporter now sends their address by default.
  if (feedback.userUid) return `*Od*\n\`${feedback.userUid.slice(0, 8)}\``;
  if (feedback.contact) return "*Od*\n_kontakt podany w panelu_";
  return "*Od*\n_anonimowo_";
}

/** The channel card for one piece of feedback.
 *
 * Pure so it can be tested without a Slack workspace; the trigger does the
 * talking. `fields` is built by pushing rather than with holes, because Slack
 * rejects an array containing undefined.
 */
export function buildFeedbackBlocks(
  feedback: Feedback,
  options: FeedbackBlocksOptions,
): SlackBlock[] {
  const { baseUrl } = options;
  const kindLabel = feedbackKindLabels[feedback.kind];

  // The API only accepts a site-relative route, so this cannot be turned into
  // a link to somewhere else. Escaped anyway: an unescaped `|` or `>` would
  // break out of Slack's own link syntax.
  const pageUrl = escapeMrkdwn(`${baseUrl}${feedback.context.route}`);
  const pageLabel = feedback.context.pageTitle || feedback.context.route;

  // No separate entity field: for an entity page the route above already is
  // that page, and pageTitle is the name the reporter saw.
  const fields: SlackBlock[] = [
    {
      type: "mrkdwn",
      text: `*Strona*\n<${pageUrl}|${escapeMrkdwn(truncate(pageLabel, 200))}>`,
    },
    { type: "mrkdwn", text: reporterField(feedback) },
  ];

  const meta: string[] = [];
  if (feedback.context.nodeId) meta.push(`\`${feedback.context.nodeId}\``);
  if (feedback.context.viewport) {
    meta.push(
      `${feedback.context.viewport.width}×${feedback.context.viewport.height}`,
    );
  }

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: truncate(
          `${KIND_EMOJI[feedback.kind]} ${kindLabel}`,
          HEADER_TEXT_LIMIT,
        ),
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncate(
          escapeMrkdwn(truncate(feedback.message, MESSAGE_LIMIT)),
          SECTION_TEXT_LIMIT,
        ),
      },
    },
    { type: "section", fields },
  ];

  if (meta.length > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: meta.join(" · ") }],
    });
  }

  if (feedback.id) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "Otwórz w panelu" },
          url: `${baseUrl}/admin/opinie#fb-${feedback.id}`,
        },
      ],
    });
  }

  return blocks;
}

/** Plain-text fallback, used in notifications and by clients that cannot render
 * blocks. Slack warns when it is missing. */
export function buildFeedbackFallback(feedback: Feedback): string {
  return truncate(
    `Nowe zgłoszenie (${feedbackKindLabels[feedback.kind]}): ${feedback.message}`,
    200,
  );
}
