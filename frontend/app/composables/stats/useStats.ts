import type { ProgressStats } from "~~/server/api/stats/progress.get";

/** Site-wide tagging progress: how many people are published, how many the
 * community has looked at but not published, how many nobody has touched.
 *
 * The same figures /api/stats/progress gives the explore table, asked for
 * without filters. Every caller shares one `useAsyncData` key, so a page that
 * shows the number in three places still fetches it once, and the endpoint is
 * cached server-side on top of that.
 *
 * Zero until the request lands. Under SSR that never shows - the fetch is
 * awaited before the page renders - but a client-side navigation paints one
 * frame with it, so callers dividing by these need to say what they want at
 * zero.
 */
export const useStats = () => {
  const { data } = useAsyncData("site-progress", () =>
    $fetch<ProgressStats>("/api/stats/progress"),
  );

  const count = (key: keyof ProgressStats) =>
    computed(() => data.value?.[key] ?? 0);

  return {
    total: count("total"),
    /** Published. */
    approved: count("approved"),
    /** Looked at by somebody, not published yet. */
    reviewed: count("reviewed"),
    /** Nobody has looked yet. */
    toCheck: count("toCheck"),
  };
};
