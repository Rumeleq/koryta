import { getLocalGraph } from "~~/server/utils/localGraph";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import { getQuery, getRouterParam, type H3Event } from "h3";

/** Whether the caller asked to be shown things that are not approved yet.
 *
 * `authFetch` sets it on every request a signed in reader makes, so it doubles
 * as "this is an editor", which is what decides the caching below. */
function wantsLatest(event: H3Event): boolean {
  const latest = getQuery(event).latest;
  return latest !== undefined && latest !== "false";
}

async function localGraph(event: H3Event) {
  const query = getQuery(event);
  // Clamped: the url is the reader's to type, and every hop past the second
  // multiplies both the fetch and what lands on the canvas.
  const distance = Math.min(
    Math.max(
      query.distance ? parseInt(query.distance as string, 10) || 1 : 1,
      1,
    ),
    3,
  );
  const focusNodeId = getRouterParam(event, "id");

  if (!focusNodeId) {
    throw createError({ statusCode: 400, statusMessage: "id is required" });
  }

  let expansions: string[] = [];
  if (query.expand) {
    expansions = (query.expand as string).split(",");
  }

  // TODO actually propagate the information about the latest
  return getLocalGraph(focusNodeId, wantsLatest(event), distance, expansions);
}

const cachedLocalGraph = authCachedEventHandler(localGraph);

export default defineEventHandler(async (event) => {
  // A signed in reader is the one who may have just added the edge they are
  // looking for, and the cache below holds a response for six hours - long
  // enough to convince somebody their relation was never written. So they read
  // through to Firestore, while logged out traffic, which is nearly all of it,
  // still gets the cache.
  if (wantsLatest(event)) {
    return localGraph(event);
  }
  return cachedLocalGraph(event);
});
