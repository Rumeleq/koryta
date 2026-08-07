import {
  mdiAccountOutline,
  mdiFileDocumentOutline,
  mdiMapMarkerRadiusOutline,
  mdiOfficeBuildingOutline,
} from "@mdi/js";
import type { NodeType } from "~~/shared/model";

/** What each kind of node is drawn as, as SVG path data.
 *
 * Not `nodeTypeIcon` from shared/model: that holds `"mdi-account-outline"`
 * class names, and vuetify is configured with `defaultSet: "mdi-svg"`
 * (nuxt.config.ts), which wants the path itself. The shared map is still what
 * the server and the plain-string call sites use, so both exist.
 */
export const nodeTypeSvgIcon: Record<NodeType, string> = {
  person: mdiAccountOutline,
  place: mdiOfficeBuildingOutline,
  article: mdiFileDocumentOutline,
  region: mdiMapMarkerRadiusOutline,
};

export const nodeTypeLabel: Record<NodeType, string> = {
  person: "Osoba",
  place: "Instytucja",
  article: "Artykuł",
  region: "Region",
};
