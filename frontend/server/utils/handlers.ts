import { getQuery } from "h3";
import type { EventHandler, H3Event } from "h3";
import { getUser } from "~~/server/utils/auth";

async function eventIsAuthenticated(event?: H3Event): Promise<boolean> {
  if (!event) return false;
  const user = await getUser(event).catch(() => null);
  return !!user;
}

export function authCachedEventHandler<T>(
  handler: EventHandler<EventHandlerRequest, Promise<T>>,
  options = {},
) {
  // 1. Create the cached version of the handler
  const cachedHandler = defineCachedEventHandler(handler, {
    swr: true,
    maxAge: 21600, // 6 hours
    ...options,
    shouldBypassCache: eventIsAuthenticated,
  });

  // 2. Return a master handler that decides which path to take
  return defineEventHandler(async (event: H3Event) => {
    const isAuth = await eventIsAuthenticated(event);
    if (isAuth) {
      // Explicitly prevent browser caching for this response
      setResponseHeader(
        event,
        "Cache-Control",
        "no-store, no-cache, must-revalidate",
      );
      return handler(event);
    }

    // Public / Unauthenticated. Use cache.
    return cachedHandler(event);
  });
}

/** Whether the caller asked to be shown what is not approved yet.
 *
 * `authFetch` puts it on every request a signed in reader makes, so it doubles
 * as "this is an editor" - which is the only thing the server can tell about
 * them, `eventIsAuthenticated` above being stubbed out.
 */
export function wantsLatest(event: H3Event): boolean {
  const latest = getQuery(event).latest;
  return latest !== undefined && latest !== "false";
}

/** `authCachedEventHandler`, except that an editor reads through the cache.
 *
 * `eventIsAuthenticated` always answers false, so the wrapper above serves
 * every caller from a cache held for six hours - a signed in one included. That
 * is fine for a page nobody is editing and wrong for everything else: the
 * person who just tagged an article or added a relation is exactly the person
 * whose next request must not be answered from before they did it. Six hours is
 * long enough to convince them the write never happened.
 *
 * /api/graph/local/[id] hand-rolled this first and says the same thing in its
 * own words; anything new should reach for this instead. Logged out traffic,
 * which is nearly all of it, still gets the cache.
 */
export function editorFreshCachedEventHandler<T>(
  handler: EventHandler<EventHandlerRequest, Promise<T>>,
  options = {},
) {
  const cachedHandler = authCachedEventHandler(handler, options);

  return defineEventHandler(async (event: H3Event) => {
    if (wantsLatest(event)) {
      setResponseHeader(
        event,
        "Cache-Control",
        "no-store, no-cache, must-revalidate",
      );
      return handler(event);
    }
    return cachedHandler(event);
  });
}
