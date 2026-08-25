import type { Node } from "./model";
import type { Person, Company, Region } from "../model";

/** What each kind of node is painted, where a party colour does not decide it.
 *
 * Named here because the graph's legend has to say the same thing the canvas
 * does, and because the values used to be the css keywords `gray` and `green` -
 * a flat mid grey that read as "disabled" next to the party colours, and a
 * primary green loud enough to pull the eye to whichever region happened to be
 * on screen. */
export const NODE_COLORS = {
  /** Somebody with no party. The party ones come from `shared/misc`. */
  person: "#4466cc",
  place: "#6b7a83",
  region: "#3f7d58",
} as const;

export function personNode(
  person: Person,
  partyColors: Record<string, string>,
): Node {
  const party =
    person.parties && person.parties.length > 0
      ? (person.parties[0] ?? "")
      : "";
  const color = (
    party != "" ? partyColors[party] : NODE_COLORS.person
  ) as Node["color"];
  return {
    ...person,
    entityType: person.type,
    type: "circle",
    color: color,
    visibility: person.visibility,
  };
}

export function companyNode(company: Company): Node {
  return {
    ...company,
    entityType: company.type,
    type: "rect",
    color: NODE_COLORS.place,
    visibility: company.visibility,
  };
}

export function regionNode(region: Region): Node {
  return {
    ...region,
    entityType: region.type,
    type: "document",
    color: NODE_COLORS.region,
    visibility: region.visibility,
  };
}
