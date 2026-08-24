import type { NodeType, Node } from "~~/shared/model";

export type SeoType = "osoba" | "instytucja" | "region" | "artykul" | "temat";

export const seoTypes: readonly SeoType[] = [
  "osoba",
  "instytucja",
  "region",
  "artykul",
  "temat",
] as const;

export function createSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // removes diacritics
    .replace(/ł/g, "l")
    .replace(/Ł/g, "l")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // replace non-alphanumeric with dash
    .replace(/(^-|-$)+/g, ""); // remove leading/trailing dashes
}

export function nodeTypeToSlugPrefix(type: NodeType): SeoType {
  switch (type) {
    case "person":
      return "osoba";
    case "place":
      return "instytucja";
    case "region":
      return "region";
    case "article":
      return "artykul";
    case "topic":
      return "temat";
    default:
      return type;
  }
}

export function slugPrefixToNodeType(prefix: SeoType): NodeType {
  switch (prefix) {
    case "osoba":
      return "person";
    case "instytucja":
      return "place";
    case "region":
      return "region";
    case "artykul":
      return "article";
    case "temat":
      return "topic";
    default:
      throw new Error(`Unknown slug prefix: ${prefix}`);
  }
}

export function generateEntityUrl(
  type: NodeType,
  id: string,
  name?: string,
): string {
  if (!name) return `/entity/${type}/${id}`;
  const prefix = nodeTypeToSlugPrefix(type);
  const slug = createSlug(name);
  return `/${prefix}/${slug}-${id}`;
}

export function generateNodeUrl(node: Node): string | undefined {
  if (!node.id) return undefined;

  switch (node.type) {
    // The types with a readable page of their own.
    //
    // Person and article are what the sitemap lists, and what somebody shares.
    // A topic is reachable but stays out of the sitemap until the tagging is
    // more than a handful of stories - and so, for now, is a company: putting
    // ~3,979 institution urls back into it is a decision separate from
    // restoring the pages themselves.
    //
    // A company had no page at all between 2026-05-21 and 2026-08-24 and was
    // redirected to the table filtered to it, back when the branch rendering
    // one held only owners and subsidiaries. The table answers "who works
    // here"; it could never answer "who did they replace".
    case "person":
    case "article":
    case "topic":
    case "place":
      return generateEntityUrl(node.type, node.id, node.name);

    case "region": {
      if (node.id == "teryt1261") {
        return "/region/krakow-teryt1261";
      }
      const teryt = node.id.replace("teryt", "");
      return `/eksploruj/tabela?teryt=${teryt}`;
    }

    // A type the front end does not know about yet keeps whatever url it was
    // reached by, rather than being sent somewhere wrong.
    default:
      return undefined;
  }
}

export function parseEntityUrlSlug(slugWithId: string): {
  slug: string;
  id: string;
} {
  const parts = slugWithId.split("-");
  const id = parts.pop() || "";
  const slug = parts.join("-");
  return { slug, id };
}
