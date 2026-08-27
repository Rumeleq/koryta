<template>
  <ClientOnly>
    <div class="align-self-center">
      <h1 class="text-h4 mb-4">Eksploruj nowe osoby</h1>

      <div class="d-flex align-start ga-4 mb-4 flex-wrap">
        <ExploreProgressBar
          hide-cta
          :query="progressQuery"
          class="flex-grow-1"
        />
        <v-select
          v-model="filterCategory"
          :items="availableCategories"
          label="Typ podmiotu"
          variant="outlined"
          density="comfortable"
          hide-details
          clearable
          style="min-width: 220px; max-width: 280px"
        />
      </div>

      <div class="d-flex align-center ga-4 mb-4 flex-wrap">
        <v-btn-toggle
          v-model="filterOrder"
          mandatory
          divided
          variant="outlined"
          density="comfortable"
        >
          <v-btn value="recent" class="text-none" :prepend-icon="mdiClockFast">
            Najnowsze zatrudnienia
          </v-btn>
          <v-btn value="votes" class="text-none" :prepend-icon="mdiStarOutline">
            Najwyżej oceniane
          </v-btn>
        </v-btn-toggle>

        <v-text-field
          v-if="orderRecent"
          v-model="minVotes"
          type="number"
          :min="0"
          label="Min. suma głosów"
          variant="outlined"
          density="comfortable"
          hide-details
          style="max-width: 180px"
        />

        <span class="text-body-2 text-medium-emphasis">
          {{
            orderRecent
              ? `Osoby, które zaczęły pracę najpóźniej, z sumą ocen co najmniej ${minVotes} i bez głosu od żadnej osoby.`
              : "Osoby z najwyższą sumą ocen, bez głosu od żadnej osoby."
          }}
        </span>
      </div>

      <!-- CLOSED STATE -->
      <div v-if="!showInstructions" class="d-flex align-center ga-3 mb-4">
        <v-alert
          class="flex-grow-1 cursor-pointer mb-0"
          :color="allActionsDone ? 'success' : undefined"
          variant="tonal"
          :icon="mdiInformation"
          @click="showInstructions = true"
        >
          <div class="text-subtitle-1 font-weight-bold">
            {{
              allActionsDone
                ? "Wszystkie akcje wykonane - gotowe!"
                : "Pokaż instrukcje"
            }}
          </div>
        </v-alert>

        <ExploreNewButtons
          :pending="pending"
          :all-actions-done="allActionsDone"
          @next="page += Math.round(Math.random() * 5)"
        />
      </div>

      <!-- OPEN STATE -->
      <div v-else class="d-flex align-start ga-4 mb-4">
        <v-alert
          v-model="showInstructions"
          closable
          type="info"
          variant="tonal"
          class="mb-0 flex-grow-1"
          :icon="mdiInformation"
        >
          <div class="text-subtitle-1 font-weight-bold mb-2">Instrukcje:</div>
          <ul class="pl-0 mt-2" style="list-style: none">
            <li
              class="d-flex align-center mb-2"
              :class="{
                'text-medium-emphasis': actionExplored,
              }"
            >
              <v-icon
                :color="actionExplored ? 'success' : 'medium-emphasis'"
                class="mr-2"
              >
                {{
                  actionExplored
                    ? mdiCheckboxMarkedCircle
                    : mdiCheckboxBlankCircleOutline
                }}
              </v-icon>
              <span>
                Kliknij ikonkę "Eksploruj" w tabeli poniżej aby otworzyć
                odnośniki wyszukiwania do powiązanych z daną osobą informacji
                (wyłącz blokowanie wyskakujących okien).
              </span>
            </li>
            <li class="d-flex align-center mb-2">
              <v-icon
                color="medium-emphasis"
                class="mr-2"
                :icon="mdiCircleSmall"
              ></v-icon>
              <span
                >Spróbuj znaleźć interesujące i istotne informacje na temat tej
                osoby.</span
              >
            </li>
            <li
              class="d-flex align-center mb-2"
              :class="{
                'text-medium-emphasis': actionNoted,
              }"
            >
              <v-icon
                :color="actionNoted ? 'success' : 'medium-emphasis'"
                class="mr-2"
              >
                {{
                  actionNoted
                    ? mdiCheckboxMarkedCircle
                    : mdiCheckboxBlankCircleOutline
                }}
              </v-icon>
              <span
                >Dodaj znalezione informacje jako notatki w edytorze poniżej
                (jeśli są tego warte).</span
              >
            </li>
            <li
              class="d-flex align-center mb-2"
              :class="{
                'text-medium-emphasis': actionVoted,
              }"
            >
              <v-icon
                :color="actionVoted ? 'success' : 'medium-emphasis'"
                class="mr-2"
              >
                {{
                  actionVoted
                    ? mdiCheckboxMarkedCircle
                    : mdiCheckboxBlankCircleOutline
                }}
              </v-icon>
              <span
                >Na koniec, oddaj swój głos w tabeli w zależności od tego, czy
                ta osoba jest według Ciebie interesująca czy nie.</span
              >
            </li>
            <li class="d-flex align-center">
              <v-icon
                color="medium-emphasis"
                class="mr-2"
                :icon="mdiCircleSmall"
              ></v-icon>
              <span
                >Kiedy skończysz, kliknij przycisk "Następna osoba" aby przejść
                dalej.</span
              >
            </li>
          </ul>
        </v-alert>

        <ExploreNewButtons
          vertical
          :pending="pending"
          :all-actions-done="allActionsDone"
          @next="page += Math.round(Math.random() * 5)"
        />
      </div>

      <v-card class="table-card mb-4">
        <ExploreTable
          :page="page"
          :headers="headers"
          :items="tableItems"
          :total-items="totalItems"
          :pending="pending"
          :items-per-page="1"
          :sort-by="sortBy"
          disable-focus
          hide-default-footer
          no-data-text="Brak danych do wyświetlenia. Prawdopodobnie przejrzałeś wszystkie nowe powiązania."
          @action:explored="actionExplored = true"
          @action:voted="actionVoted = true"
        />
      </v-card>

      <template v-if="focusedPerson">
        <v-row>
          <v-col cols="12" md="6">
            <v-card class="mb-4">
              <CardExplorePerson
                :key="focusedPerson.id"
                :person="focusedPerson"
                :region="undefined"
                :company="undefined"
                :work-locations="workLocations"
              />

              <ChartPersonLocations
                v-if="mapLocations.length"
                :key="`map-${focusedPerson.id}`"
                :locations="mapLocations"
              />

              <div class="pa-4 pt-0">
                <ExploreProposeChange
                  :key="focusedPerson.id"
                  :person="focusedPerson"
                />
              </div>
            </v-card>
          </v-col>

          <v-col cols="12" md="6">
            <NoteEditor
              :key="focusedPerson.id"
              :node-id="focusedPerson.id"
              single-column
              @saved="actionNoted = true"
            />
          </v-col>
        </v-row>

        <v-card class="mb-4 pa-4">
          <h2 class="text-h6 mb-4">Historia Zatrudnienia</h2>
          <CardEmploymentHistory :edges="focusedEdges" />
        </v-card>
      </template>
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
import {
  mdiCheckboxBlankCircleOutline,
  mdiCheckboxMarkedCircle,
  mdiClockFast,
  mdiInformation,
  mdiCircleSmall,
  mdiStarOutline,
} from "@mdi/js";
import { ref, computed, watch } from "vue";
import { useListWithStats } from "~/composables/entity/listWithStats";
import { useQueryFilters } from "~/composables/queryFilters";
import { companyCategories } from "~~/shared/companyCategories";
import type { PersonRich } from "~~/shared/model";
import type { Query } from "~~/server/api/nodes/index.get";
import { useCurrentUser } from "vuefire";

import { useEdges } from "~/composables/edges";

definePageMeta({
  affineLink: "BYOEeL1iG0mvIR3yz2pOs",
  middleware: "auth",
  maxWidth: 1300,
});
useHead({
  title: "Eksploruj Nowe - koryta.pl",
});

const page = ref(1);
const showInstructions = useCookie<boolean>("show-explore-new-instructions", {
  default: () => true,
});
const user = useCurrentUser();

const availableCategories = companyCategories.map((c) => ({
  title: c.title,
  value: c.value,
}));
const { stringFilter, choiceFilter, numberFilter } = useQueryFilters();
const filterCategory = stringFilter("category");

/** Which end of the queue to work through.
 *
 * `recent` is the default: somebody who started a job last month is worth
 * looking at while it is still news, and the pipeline's own rating is enough to
 * tell an interesting one from the rest. `votes` is the older behaviour - the
 * highest rated first, however long ago they were hired.
 */
const filterOrder = choiceFilter<"recent" | "votes">("order", "recent");
const orderRecent = computed(() => filterOrder.value === "recent");

/** The aggregate score a person needs to show up in `recent`. Three is where
 * the pipeline's rating starts to mean something - 1,050 of the ~5,200
 * unpublished people clear it, against a maximum observed score of 5 - so the
 * queue stays a shortlist rather than everyone ever ingested. */
const DEFAULT_MIN_VOTES = 3;
const filterMinVotes = numberFilter("minVotes");
/** Kept out of the url while it equals the default, like every other filter
 * here. Clearing the field therefore reads back as the default rather than as
 * "no minimum" - the two are the same absent-from-the-url state. */
const minVotes = computed<number, number | string | null>({
  get: () => filterMinVotes.value ?? DEFAULT_MIN_VOTES,
  set: (value) => {
    // The text field hands back a string, and an empty one once it is cleared.
    const parsed =
      typeof value === "number"
        ? value
        : Number.parseInt(String(value ?? ""), 10);
    filterMinVotes.value =
      !Number.isFinite(parsed) || parsed === DEFAULT_MIN_VOTES ? null : parsed;
  },
});

// The card stack is paged in memory rather than through the url.
watch([filterCategory, filterOrder, minVotes], () => {
  page.value = 1;
});

const actionExplored = ref(false);
const actionNoted = ref(false);
const actionVoted = ref(false);

const allActionsDone = computed(
  () => actionExplored.value && actionNoted.value && actionVoted.value,
);

watch(allActionsDone, (done) => {
  if (done) {
    showInstructions.value = false;
  }
});

watch(page, () => {
  actionExplored.value = false;
  actionNoted.value = false;
  actionVoted.value = false;
});

/** The column the api sorts on, which is also the one the table marks as
 * sorted. Both modes read top-down, so the direction is always descending. */
const sortKey = computed(() =>
  orderRecent.value ? "latestEmploymentStart" : "stats.votes.interesting",
);

const sortBy = computed(() => [{ key: sortKey.value, order: "desc" as const }]);

const headers = computed(() => {
  const baseHeaders = [
    { title: "Imię i nazwisko", key: "name", sortable: false },
    { title: "Partie", key: "parties", sortable: false },
    { title: "Firmy", key: "companies", sortable: false },
    { title: "Wybory", key: "elections", sortable: false },
    {
      title: "Ostatnie zatrudnienie",
      key: "latestEmploymentStart",
      sortable: false,
      align: "center" as const,
    },
    {
      title: "Lata pracy",
      key: "experience",
      sortable: false,
      align: "center" as const,
    },
    {
      title: "Notatki",
      key: "notesCount",
      sortable: false,
      align: "center" as const,
    },
    {
      title: "Głosy łącznie",
      key: "stats.votes.interesting",
      sortable: false,
      align: "center" as const,
    },
    {
      title: "Twój głos",
      key: "userVote",
      sortable: false,
      align: "center" as const,
    },
  ];
  if (user.value) {
    baseHeaders.push({
      title: "Widoczność",
      key: "visibility",
      sortable: false,
    });
  }
  baseHeaders.push({ title: "Eksploruj", key: "explore", sortable: false });
  return baseHeaders;
});

// Sorting on `latestEmploymentStart` leaves out the people who have no
// employment edge to date at all - 135 of the 1,050 above the default score.
// That is the point of the mode rather than a gap in it: "hired recently" has
// nothing to say about somebody with no known job.
const apiQuery = computed(
  () =>
    ({
      type: "person",
      limit: 1,
      page: page.value,
      sortBy: sortKey.value,
      sortDesc: "true",
      visibility: "private",
      hideVoted: "no_votes",
      category: filterCategory.value || undefined,
      minVotes: orderRecent.value ? minVotes.value : undefined,
    }) as Query,
);

/** The bar counts the same people it always did: everybody the reader could be
 * asked to check, narrowed only by the filters that say who that is. The score
 * threshold decides the order of the queue, not its scope, so folding it in
 * would silently redefine "sprawdzono N z M" the moment the page loads - and
 * the denominator would move again every time somebody nudged the threshold. */
const progressQuery = computed(() => ({
  ...apiQuery.value,
  minVotes: undefined,
}));

// Same as /eksploruj/tabela: the template is a single <ClientOnly>, so nothing
// this returns is rendered on the server.
// Which region each employer sits in, so the search suggestions below can put
// the person in their local context and the map can draw it.
const { companyRegions, companyLocations } = useCompanyLocations();

const { tableItems, totalItems, pending } = await useListWithStats(
  apiQuery,
  "nowe-data",
  { server: false, companyLocations },
);

const focusedPerson = computed<PersonRich | undefined>(
  () => tableItems.value?.[0],
);
const focusedPersonId = computed(() => focusedPerson.value?.id);
const { sources: focusedSources, targets: focusedTargets } =
  await useEdges(focusedPersonId);
const focusedEdges = computed(() => [
  ...(focusedSources.value || []),
  ...(focusedTargets.value || []),
]);

const { workLocations, mapLocations } = usePersonPlaces(
  focusedPerson,
  focusedEdges,
  companyRegions,
);
</script>

<style scoped>
@media (min-width: 960px) {
  .table-card,
  .table-card :deep(.v-data-table),
  .table-card :deep(.v-table),
  .table-card :deep(.v-table__wrapper) {
    overflow: visible !important;
  }
  .table-card :deep(.v-data-table__th) {
    top: var(--v-layout-top) !important;
  }
}
</style>
