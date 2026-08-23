/** A url reduced to what identifies the page, for comparing two of them.
 *
 * The same article reaches the database written several ways: the crawler
 * stores `https://www.example.pl/a/`, while the extraction pipeline stores
 * `example.pl/a` with no scheme at all. Compared as strings those are three
 * different articles, which is why not one of the 269 extracted facts managed
 * to link itself to an article node.
 *
 * Mirrors `NormalizedParse.parse` in `data/pipelines/src/entities/util.py`, the
 * rule the scrapers already normalise by: assume http when the scheme is
 * missing, lowercase the host, drop a leading `www.` and a trailing slash. The
 * query string is kept — for most Polish news sites it is tracking noise, but
 * for some it is the article id, and dropping it would merge different pages.
 */
export function normalizeUrl(url: string): string {
  const withScheme = /^https?:\/\//i.test(url) ? url : `http://${url}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    // Not a url at all; comparing it verbatim is the best that can be done.
    return url.trim().toLowerCase();
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/$/, "");
  return `${host}${path}${parsed.search}`;
}
