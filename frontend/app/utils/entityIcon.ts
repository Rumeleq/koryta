import {
  mdiAccount,
  mdiAccountOutline,
  mdiCommentArrowRight,
  mdiCommentArrowRightOutline,
  mdiFileDocument,
  mdiFileDocumentOutline,
  mdiMapMarkerRadius,
  mdiMapMarkerRadiusOutline,
  mdiOfficeBuilding,
  mdiOfficeBuildingOutline,
  mdiTag,
  mdiTagOutline,
} from "@mdi/js";
import type { NodeType } from "~~/shared/model";

/** The icon that stands for a kind of entity, in both weights.
 *
 * One table rather than a copy per component. There were five: two identical
 * ones in the note triage screens, one in each of the relation cards, and
 * `nodeTypeIcon`/`nodeIcon` in shared/model.ts, which held mdi *class names* -
 * and this app renders icons as svg paths (`defaultSet: "mdi-svg"`), so those
 * went straight into a `<path d="mdi-map-marker-radius-outline">` and drew
 * nothing but a console error.
 *
 * Both weights in one row so that adding a sixth kind cannot leave the graph
 * drawing a comment arrow where a list draws the real thing: the typecheck
 * demands both at once.
 */
const ENTITY_ICONS: Record<NodeType, { outline: string; filled: string }> = {
  person: { outline: mdiAccountOutline, filled: mdiAccount },
  place: { outline: mdiOfficeBuildingOutline, filled: mdiOfficeBuilding },
  region: { outline: mdiMapMarkerRadiusOutline, filled: mdiMapMarkerRadius },
  article: { outline: mdiFileDocumentOutline, filled: mdiFileDocument },
  topic: { outline: mdiTagOutline, filled: mdiTag },
};

/** Whatever a row is about, where it is not one of the five - the relation
 * cards draw comments and mentions through the same helper. */
const OTHER = {
  outline: mdiCommentArrowRightOutline,
  filled: mdiCommentArrowRight,
};

/** `type` is the node's `type` field (`NodeType` in shared/model), widened to
 * `string` because the graph carries it as `entityType` and a payload from an
 * older write can hold anything. */
function icons(type: string | undefined) {
  return type && type in ENTITY_ICONS ? ENTITY_ICONS[type as NodeType] : OTHER;
}

/** The outline icon, for a list. */
export function entityIcon(type: string | undefined): string {
  return icons(type).outline;
}

/** The filled icon, for drawing inside a node on the graph.
 *
 * An outline glyph is a hairline at the size a graph node is drawn - 12px of
 * icon inside a 32px circle - and it disappears against a mid-tone fill. The
 * filled variants keep their shape down to a few pixels, which is the whole
 * point of putting them there.
 */
export function entityGlyph(type: string | undefined): string {
  return icons(type).filled;
}
