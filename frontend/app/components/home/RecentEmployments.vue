<template>
  <HomeHeading
    title="Ostatnie zatrudnienia"
    subtitle="Kto ostatnio objął stanowisko. Kliknij, żeby zobaczyć stronę tej osoby."
  />

  <div
    v-if="employments.length > 0"
    class="employment-feed"
    data-testid="recent-employments"
  >
    <div class="employment-feed__grid">
      <CardEmployment
        v-for="employment in employments"
        :key="employment.id"
        :employment
      />
    </div>

    <div class="employment-feed__end text-center">
      <v-alert
        v-if="loadError"
        class="mb-4 text-start"
        data-testid="recent-employments-error"
        text="Nie udało się pobrać kolejnych zatrudnień. Spróbuj jeszcze raz."
        type="warning"
        variant="tonal"
      />

      <!-- A button rather than a sentinel that loads on its own. This feed is
           the last thing on the home page and the footer is directly under it,
           and on a phone the footer is the only navigation there is - the app
           bar carries Tematy, O nas and Działaj z nami only above 960px. A feed
           that grows every time the reader reaches its end puts the footer
           permanently one screen further away, so nobody ever arrives at it. -->
      <v-btn
        v-if="cursor"
        class="text-none"
        color="primary"
        data-testid="recent-employments-more"
        :loading="loadingMore"
        rounded="lg"
        variant="tonal"
        @click="loadMore"
      >
        Pokaż więcej
      </v-btn>

      <p v-else class="text-body-2 text-medium-emphasis">
        To już wszystkie zatrudnienia, jakie znamy.
      </p>
    </div>
  </div>

  <!-- Only ever seen on a client-side navigation into the home page: under SSR
       Nuxt settles the fetch before it renders, so the list arrives with the
       document. -->
  <div v-else-if="status === 'pending'" class="text-center py-8">
    <v-progress-circular indeterminate />
  </div>

  <!-- Not the end-of-feed line above: that one ends a list somebody has read
       to the bottom, and this is the whole section having nothing to show -
       which on a working site only happens against a fresh local stack. -->
  <v-alert
    v-else
    data-testid="recent-employments-empty"
    text="Nie znamy jeszcze żadnego zatrudnienia z datą rozpoczęcia."
    type="info"
    variant="tonal"
  />
</template>

<script lang="ts" setup>
import { authFetch } from "~/composables/auth";
import type {
  RecentEmployment,
  RecentEmployments,
} from "~~/server/api/edges/recentEmployments.get";

/** How many cards a page carries. Two columns on a desktop, so an even number
 * leaves no half row behind.
 *
 * Ten rather than the twenty this used to fetch, because a phone draws the
 * grid in one column: twenty cards were some two thousand pixels of feed
 * between the reader and the footer below it, and the footer is the only
 * navigation a phone has. Ten is five rows on a desktop, and whoever wants
 * more says so. */
const PAGE_SIZE = 10;

const ENDPOINT = "/api/edges/recentEmployments";

/** The `useAsyncData` key the first page is stored under, and so what the
 * server hands the browser in the payload. */
const FIRST_PAGE_KEY = "home-recent-employments";

/** How many times one press of "Pokaż więcej" may go back to the endpoint.
 *
 * A page can come back empty and still carry a cursor - the endpoint stops
 * scanning before it has filled one - and a button that visibly does nothing
 * reads as broken in a way an intersection sentinel never did. So it keeps
 * asking until something arrives, bounded so that a long stretch of unpublished
 * edges cannot turn one press into an unbounded scan. */
const MAX_FETCHES_PER_PRESS = 5;

const route = useRoute();

/** `latest` is carried through from the page's own url rather than only being
 * added by `authFetch` for a signed in reader, because `authFetch` adds it in
 * the browser and this section is rendered on the server. Without it there is
 * no way to ask the home page for a feed newer than the response cache, which
 * is what somebody checking that an ingest landed actually wants. */
const query = computed(() => ({
  limit: PAGE_SIZE,
  ...(route.query.latest === undefined ? {} : { latest: route.query.latest }),
}));

// Not awaited, and still server rendered: Nuxt settles every `useAsyncData` -
// which is what `authFetch` is underneath - before it serialises the page. The
// difference is on a client-side navigation into the home page, where awaiting
// would hold the whole route on this one section.
const { data, status } = authFetch<RecentEmployments>(ENDPOINT, {
  query,
  // Named rather than left to key on the url: `useFetch` aborts the earlier
  // call when a second one lands on the same key, so an unnamed one ties this
  // section's fate to any other caller that happens to want the same page.
  key: FIRST_PAGE_KEY,
});

/** The pages after the first. The first stays in `data` so that a refetch -
 * which is what signing in triggers, `authFetch` adding `latest` to the query
 * - replaces it instead of being appended to what is already on screen. */
const more = ref<RecentEmployment[]>([]);
const cursor = ref<string | null>(null);
const loadingMore = ref(false);
const loadError = ref(false);

watch(
  data,
  () => {
    more.value = [];
    cursor.value = data.value?.nextCursor ?? null;
    loadError.value = false;
  },
  { immediate: true },
);

const employments = computed(() => [
  ...(data.value?.employments ?? []),
  ...more.value,
]);

/** The next page, once the reader has asked for one.
 *
 * Plain `$fetch` rather than `authFetch`, which is a `useFetch` and so cannot
 * be called for a page somebody asked for by pressing a button. Nothing is lost
 * by it: the endpoint answers with published employments whoever asks, and
 * `latest` would only skip the response cache.
 */
async function loadMore() {
  if (loadingMore.value || !cursor.value) return;

  loadingMore.value = true;
  loadError.value = false;

  try {
    for (let fetched = 0; fetched < MAX_FETCHES_PER_PRESS; fetched++) {
      // Annotated, and it has to be: the query carries `cursor.value`, and
      // `cursor.value` is assigned from `page` further down the loop body, so
      // inferring `page` means inferring `cursor` means inferring `page`.
      const page: RecentEmployments = await $fetch<RecentEmployments>(
        ENDPOINT,
        {
          query: { ...query.value, cursor: cursor.value },
        },
      );
      more.value.push(...page.employments);
      // It is the cursor, not the count, that says whether there is anything
      // behind this page.
      cursor.value = page.nextCursor;
      if (page.employments.length > 0 || !cursor.value) break;
    }
  } catch {
    loadError.value = true;
  } finally {
    loadingMore.value = false;
  }
}
</script>

<style scoped>
.employment-feed__grid {
  display: grid;
  gap: 16px;
  grid-template-columns: 1fr;
}

/* Vuetify's `md`, i.e. what `useDisplay().mdAndUp` answers true for. Written as
   a media query rather than read from `useDisplay` because the server has no
   viewport to answer with: the composable says "small" while rendering and the
   real width only on hydration, which is a layout that visibly jumps. */
@media (min-width: 960px) {
  .employment-feed__grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.employment-feed__end {
  padding-top: 24px;
}
</style>
