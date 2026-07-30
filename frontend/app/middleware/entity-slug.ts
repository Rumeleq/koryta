import type { Node, NodeType } from "~~/shared/model";
import { generateEntityUrl } from "~/composables/slugs";

/** Sends /entity/:type/:id on to the readable url for that node.
 *
 * This belongs in middleware rather than in the page's setup: `navigateTo`
 * there schedules the redirect but does not stop the render, so on the server
 * the 301 headers went out and the detail view carried on rendering - the
 * response never ended, and both curl and Chromium hung on every /entity url.
 * Returning it from middleware aborts the navigation, which is what makes the
 * 301 a complete response. */
export default defineNuxtRouteMiddleware(async (to) => {
  const id = to.params.id as string;
  const destination = to.params.destination as NodeType;

  // A node we cannot read is not a reason to fail the navigation - the page
  // renders the detail view for it and reports its own errors.
  const node = await $fetch<{ node: Node }>(`/api/nodes/${id}`)
    .then((response) => response.node)
    .catch(() => undefined);
  if (!node?.name) return;

  const seoUrl = generateEntityUrl(destination, id, node.name);
  if (to.path === seoUrl) return;

  return navigateTo(
    seoUrl,
    import.meta.server ? { redirectCode: 301 } : { replace: true },
  );
});
