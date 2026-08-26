import { generateEntityUrl } from "~~/app/composables/slugs";
import { type NodeType, pageIsPublic } from "~~/shared/model";

/** Node types whose entity page renders a page of its own.
 *
 * `place` and `region` are deliberately absent, for two different reasons.
 *
 * A region has no page of its own: app/composables/slugs.ts `generateNodeUrl`
 * sends every one to `/eksploruj/tabela?teryt=...`, and
 * app/pages/[seoType]/[slug].vue then redirects there on the server - so
 * listing them advertised URLs that exist only to bounce a crawler into the
 * heaviest response on the site. None of them could ever rank, because the page
 * they land on renders no markup. A place was in the same position until
 * 2026-08-26 - together they were 3,979 URLs, 77% of the sitemap.
 *
 * A place has a page of its own again and redirects nowhere, so it is absent
 * only because putting those URLs back into the sitemap is a decision of its
 * own, and has not been taken. `generateNodeUrl` says the same thing.
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
