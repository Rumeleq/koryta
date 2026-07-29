<template>
  <ClientOnly>
    <div class="pa-4">
      <h1 class="text-h4 mb-4">
        Wizualizacje dla
        {{ region?.[1] || company?.[1] || "danej lokalizacji" }}
      </h1>

      <v-alert
        v-if="region && !company"
        type="warning"
        variant="tonal"
        class="mb-4"
        :icon="mdiCash"
      >
        <div class="d-flex align-center w-100">
          <v-btn
            href="https://zrzutka.pl/rd7ssx/pay"
            target="_blank"
            color="#E64164"
          >
            Zrzutka
            <v-img
              :width="30"
              aspect-ratio="16/9"
              cover
              src="@/assets/zrzutka.png"
            />
          </v-btn>
          <v-spacer />
          <div class="mr-8">
            Wesprzyj projekt na zrzutce, by przygotować podsumowania dla innych
            miast, podobie jak to dla
            <NuxtLink to="/entity/region/teryt1261">Krakowa</NuxtLink>
          </div>
          <v-spacer />
        </div>
      </v-alert>

      <ExploreLoginBanner v-if="!user" :hidden-count="hiddenCount" />

      <FormEksplorujTabelaFilters
        v-model:visibility="filterVisibility"
        v-model:party="filterParty"
        v-model:teryt="filterTeryt"
        v-model:company-teryt="filterCompanyTeryt"
        v-model:place="filterPlace"
        v-model:hide-voted="filterHideVoted"
        v-model:currently-employed="filterCurrentlyEmployed"
        :available-parties="availableParties"
        :available-regions="availableRegions"
        :available-companies="availableCompanies"
        :show-visibility="!!user"
      />

      <div class="d-flex align-center mb-4 mt-6">
        <span class="mr-4 text-subtitle-1 font-weight-bold"
          >Wybierz wizualizację:</span
        >
        <v-btn-toggle
          v-model="activeVisualisation"
          color="primary"
          mandatory
          variant="outlined"
          density="comfortable"
        >
          <v-btn value="spolki-partie">Firmy wg powiązań politycznych</v-btn>
        </v-btn-toggle>
      </div>

      <v-alert
        v-if="totalItems > DATA_LIMIT"
        type="info"
        variant="tonal"
        class="mb-6"
      >
        Zbyt wiele osób pasuje do aktualnych filtrów ({{ totalItems }}).
        Wizualizacja została ograniczona do pierwszych {{ DATA_LIMIT }} osób.
        Zawęź kryteria wyszukiwania, aby zobaczyć dokładniejsze dane.
      </v-alert>

      <v-progress-linear
        v-if="pending"
        indeterminate
        color="primary"
        class="mb-4"
      />

      <div v-if="activeVisualisation === 'spolki-partie' && !pending">
        <ExploreVisualisationCompanies
          :people="tableItems"
          :allowed-companies="allowedCompanyNames"
        />
      </div>
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
import { mdiCash } from "@mdi/js";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useListWithStats } from "~/composables/entity/listWithStats";
import { useQueryFilters } from "~/composables/queryFilters";
import { parties } from "~~/shared/misc";
import { regionFilterOptions } from "~~/shared/teryt";
import type { Query } from "~~/server/api/nodes/index.get";
import { useCurrentUser } from "vuefire";

definePageMeta({ fullWidth: true, affineLink: "BYOEeL1iG0mvIR3yz2pOs" });
useHead({
  title: "Eksploruj - Wizualizacje - koryta.pl",
});

const route = useRoute();
const router = useRouter();

const DATA_LIMIT = 200;
const { setQuery, stringFilter, arrayFilter, choiceFilter } = useQueryFilters();

const activeVisualisation = computed({
  get: () => route.params.type as string,
  set: (val: string) => {
    router.push({ params: { type: val }, query: route.query });
  },
});

const user = useCurrentUser();

const { entities: places } = useEntities("place");
const { entities: regions } = useEntities("region");

const region = computed<[string, string] | undefined>(() => {
  const terytParam = route.query.teryt as string | undefined;
  if (terytParam) {
    for (const [id, region] of Object.entries(regions.value ?? {})) {
      if (region.teryt === terytParam) {
        return [id, region.name];
      }
    }
  }
  return undefined;
});

const company = computed<[string, string] | undefined>(() => {
  const id = filterPlace.value?.[0];
  const place = id ? places.value?.[id] : undefined;
  return id && place ? [id, place.name] : undefined;
});

const filterVisibility = choiceFilter<"all" | "public" | "private">(
  "visibility",
  "all",
);
const filterParty = arrayFilter("party");
const filterTeryt = stringFilter("teryt");
const filterCompanyTeryt = stringFilter("companyTeryt");
const { filterPlace, legacyKrs, availableCompanies } = usePlaceFilter(
  places,
  arrayFilter,
  setQuery,
);
const filterCurrentlyEmployed = choiceFilter<"all" | "any" | "selected">(
  "currentlyEmployed",
  "all",
);
const filterHideVoted = choiceFilter<"all" | "no_votes" | "has_votes">(
  "hideVoted",
  "all",
);

const allowedCompanyNames = computed(() => {
  if (!filterPlace.value || filterPlace.value.length === 0) return null;
  return filterPlace.value
    .map((id) => places.value?.[id]?.name)
    .filter((name): name is string => !!name);
});

const availableRegions = computed(() =>
  regionFilterOptions(Object.values(regions.value ?? {})),
);

const availableParties = computed(() => {
  return [
    { title: "Brak partii", value: "__NONE__" },
    ...parties.map((p) => ({ title: p, value: p })),
  ];
});

const hiddenCount = computed(() => {
  let stats;
  if (region.value) {
    stats = regions.value?.[region.value[0]]?.stats;
  } else if (company.value) {
    stats = places.value?.[company.value[0]]?.stats;
  }

  if (
    stats?.edges?.all?.targetNodeIds &&
    stats?.edges?.approved?.targetNodeIds
  ) {
    const diff =
      stats.edges.all.targetNodeIds.length -
      stats.edges.approved.targetNodeIds.length;
    return diff > 0 ? diff : 0;
  }
  return 0;
});

const apiQuery = computed(
  () =>
    ({
      type: "person",
      limit: DATA_LIMIT,
      page: 1,
      parties:
        filterParty.value && filterParty.value.length > 0
          ? filterParty.value
          : undefined,
      visibility:
        filterVisibility.value !== "all" ? filterVisibility.value : undefined,
      place:
        filterPlace.value && filterPlace.value.length > 0
          ? filterPlace.value
          : undefined,
      // See `eksploruj/tabela.vue`: an old link has to filter before the place
      // list that maps it onto node ids arrives.
      krs: legacyKrs.value ?? undefined,
      teryt: filterTeryt.value || undefined,
      companyTeryt: filterCompanyTeryt.value || undefined,
      hideVoted:
        filterHideVoted.value !== "all" ? filterHideVoted.value : undefined,
      currentlyEmployed:
        filterCurrentlyEmployed.value !== "all"
          ? filterCurrentlyEmployed.value
          : undefined,
    }) as Query,
);

const { tableItems, totalItems, pending } = await useListWithStats(
  apiQuery,
  "wizualizacje-data",
);
</script>
