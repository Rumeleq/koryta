import { generateEntityUrl } from "~~/app/composables/slugs";
import { type NodeType, pageIsPublic } from "~~/shared/model";

/** Node types whose entity page renders a page of its own.
 *
 * `place` and `region` are deliberately absent. app/composables/slugs.ts
 * `generateNodeUrl` sends every place to `/eksploruj/tabela?krs=...` and every
 * region to `?teryt=...`, and app/pages/[seoType]/[slug].vue then 301s there on
 * the server - so listing them advertised 3,979 URLs, 77% of the sitemap, that
 * exist only to bounce a crawler into the heaviest response on the site. None
 * of them could ever rank, because the page they land on renders no markup.
 *
 * The one region with a real page, teryt1261, is reachable from the homepage
 * and from the explore table, so dropping the type here does not hide it.
 */
const SITEMAP_NODE_TYPES: readonly NodeType[] = ["person", "article"];

export default defineEventHandler(async () => {
  const urls: { loc: string; lastmod?: string }[] = [];

  const nodesSnapshots = await Promise.all(
    SITEMAP_NODE_TYPES.map((type) => fetchNodes(type)),
  );

  nodesSnapshots.forEach((nodesSnapshot) => {
    Object.entries(nodesSnapshot).forEach(([id, data]) => {
      if (pageIsPublic(data) && data.name) {
        if (SITEMAP_NODE_TYPES.includes(data.type)) {
          urls.push({
            loc: generateEntityUrl(data.type, id, data.name),
          });
        }
      }
    });
  });

  return urls;
});
