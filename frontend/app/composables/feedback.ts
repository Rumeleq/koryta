import type { RouteLocationNormalizedLoaded } from "vue-router";
import {
  mdiBug,
  mdiLightbulbOutline,
  mdiDatabaseEdit,
  mdiDotsHorizontal,
} from "@mdi/js";
import { parseEntityUrlSlug, seoTypes, type SeoType } from "./slugs";
import { feedbackKindLabels } from "~~/shared/model";
import type {
  FeedbackContext,
  FeedbackKind,
  FeedbackStatus,
} from "~~/shared/model";

/** Titles come from `shared/model.ts` so the Slack card and the dialog cannot
 * drift apart; everything else here is UI-only. */
export const feedbackKindConfig: Record<
  FeedbackKind,
  { title: string; hint: string; icon: string; color: string }
> = {
  bug: {
    title: feedbackKindLabels.bug,
    hint: "Co się stało i czego się spodziewałaś/eś?",
    icon: mdiBug,
    color: "error",
  },
  data: {
    title: feedbackKindLabels.data,
    hint: "Co jest nie tak i skąd to wiadomo?",
    icon: mdiDatabaseEdit,
    color: "warning",
  },
  idea: {
    title: feedbackKindLabels.idea,
    hint: "Co moglibyśmy zrobić lepiej?",
    icon: mdiLightbulbOutline,
    color: "primary",
  },
  other: {
    title: feedbackKindLabels.other,
    hint: "Napisz, co Ci leży na sercu.",
    icon: mdiDotsHorizontal,
    color: "grey",
  },
};

export const feedbackStatusConfig: Record<
  FeedbackStatus,
  { title: string; color: string }
> = {
  new: { title: "Nowe", color: "error" },
  in_progress: { title: "W trakcie", color: "warning" },
  resolved: { title: "Załatwione", color: "success" },
  wont_fix: { title: "Nie robimy", color: "grey" },
};

/** The node the route is about, when it is about one.
 *
 * Entity URLs carry the id in their last slug segment (`/osoba/jan-kowalski-abc123`),
 * and the older `/entity/:destination/:id` form carries it as a param.
 */
function entityIdFromRoute(
  route: RouteLocationNormalizedLoaded,
): string | undefined {
  const { seoType, slug, id, destination } = route.params;

  if (
    typeof seoType === "string" &&
    typeof slug === "string" &&
    (seoTypes as readonly string[]).includes(seoType as SeoType)
  ) {
    return parseEntityUrlSlug(slug).id || undefined;
  }

  if (typeof destination === "string" && typeof id === "string") return id;

  return undefined;
}

/** What the reporter was looking at. Called when the dialog opens, so the
 * title and viewport are the ones they actually had in front of them. */
export function captureFeedbackContext(
  route: RouteLocationNormalizedLoaded,
): FeedbackContext {
  const context: FeedbackContext = { route: route.fullPath.slice(0, 500) };

  const nodeId = entityIdFromRoute(route);
  if (nodeId) context.nodeId = nodeId;

  if (import.meta.client) {
    if (document.title) context.pageTitle = document.title.slice(0, 300);
    context.viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  return context;
}
