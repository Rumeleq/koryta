import type { H3Event } from "h3";

/**
 * A cache key naming what a handler was actually asked for.
 *
 * Nitro keys a cached handler on the request URL, so any parameter a link
 * happens to carry opens a cache entry of its own even when the handler
 * ignores it. `/api/nodes?type=person&source=psl.pl` cost two full scans of
 * the person collection over 10-11 August 2026 - 12,230 reads - for a
 * parameter no validator declares. Keying on the parsed query instead means
 * the entry is shared with the plain URL, and a campaign link that goes round
 * a mailing list cannot multiply the scans.
 *
 * The value has to survive whatever storage driver is mounted, a filesystem
 * one included, so it is reduced to characters that are safe in a path.
 */
export function queryCacheKey(query: Record<string, unknown>): string {
  const pairs = Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${[value].flat().join("+")}`);
  return pairs.join("&").replace(/[^a-zA-Z0-9=&+_.-]/g, "_") || "all";
}

/** `queryCacheKey` over a validated query, for use as a `getKey`.
 *
 * `project` narrows the query to the parameters that change the answer;
 * anything left out is, by construction, shared. */
export async function validatedQueryCacheKey<T extends Record<string, unknown>>(
  event: H3Event,
  parse: (query: unknown) => T,
  project: (query: T) => Record<string, unknown> = (query) => query,
): Promise<string> {
  try {
    return queryCacheKey(project(await getValidatedQuery(event, parse)));
  } catch {
    // The handler validates too and answers 400. Giving every rejected query
    // the same key keeps a malformed link from naming an entry per visit.
    return "invalid";
  }
}
