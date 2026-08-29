<template>
  <div>
    <div v-if="showHeader" class="d-flex align-center mb-2">
      <span class="text-subtitle-2">Filtry</span>
      <v-spacer />
      <v-btn
        variant="text"
        size="small"
        class="text-none"
        @click="emit('clear')"
      >
        Wyczyść wszystkie
      </v-btn>
    </div>

    <!-- The three public filters people actually use, in the order seven days
         of api logs put them in: teryt 43 distinct query combinations,
         category 34, currentlyEmployed 28. The other three are a click lower,
         under „Więcej filtrów”: place was used twice in that week. -->
    <v-row dense>
      <v-col cols="12" md="6">
        <v-autocomplete
          v-model="teryt"
          :items="availableRegions"
          label="Region osoby"
          variant="outlined"
          density="comfortable"
          hide-details
          clearable
        />
      </v-col>
      <v-col cols="12" md="6">
        <v-select
          v-model="category"
          :items="availableCategories"
          label="Typ podmiotu"
          variant="outlined"
          density="comfortable"
          hide-details
          clearable
        />
      </v-col>
      <v-col cols="12" md="6">
        <v-select
          v-model="currentlyEmployed"
          :items="[
            { title: 'Wszystkie osoby', value: 'all' },
            { title: 'Teraz w publicznej spółce', value: 'any' },
            { title: 'Teraz w wyszukanych podmiotach', value: 'selected' },
          ]"
          label="Zatrudnienie"
          variant="outlined"
          density="comfortable"
          hide-details
        />
      </v-col>
    </v-row>

    <!-- Four controls under one overline, and no prose. What stood here was a
         blue-grey sheet explaining, in three lines, that „widoczność pozwala
         na przeglądanie i weryfikację nieopublikowanych osób”; those lines
         were most of what pushed the first table row 697px down the page,
         and they wrapped the four filters the logs show are the most used on
         the site (minVotes 47 combinations, hideVoted 40, visibility 32,
         minEmploymentDate 31). The sentence survives as a tooltip. -->
    <template v-if="showVisibility">
      <v-divider class="my-4" />
      <div class="d-flex align-center ga-1 mb-2">
        <span class="text-overline text-medium-emphasis">Weryfikacja</span>
        <v-tooltip
          text="Widoczność i głosy społeczności działają tylko dla zalogowanych: pozwalają przeglądać szkice i ukryć osoby, które ktoś już ocenił."
          max-width="360"
        >
          <template #activator="{ props: tooltipProps }">
            <v-icon
              v-bind="tooltipProps"
              :icon="mdiInformationOutline"
              size="small"
              color="medium-emphasis"
            />
          </template>
        </v-tooltip>
      </div>
      <FormEksplorujTabelaVerificationFields
        v-model:visibility="visibility"
        v-model:hide-voted="hideVoted"
        v-model:min-employment-date="minEmploymentDate"
        v-model:min-votes="minVotes"
      />
    </template>

    <!-- Opened already when the incoming link sets one of them: a filter that
         is narrowing the table from inside a collapsed section is a short
         result list with no visible reason for being short. -->
    <v-expansion-panels
      v-model="morePanel"
      variant="accordion"
      flat
      class="mt-2"
    >
      <v-expansion-panel elevation="0">
        <v-expansion-panel-title>
          <span class="text-subtitle-2">Więcej filtrów</span>
          <v-chip
            v-if="moreCount"
            size="x-small"
            color="primary"
            variant="tonal"
            class="ml-2"
          >
            {{ moreCount }}
          </v-chip>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <v-row dense>
            <v-col cols="12" md="6">
              <v-autocomplete
                v-model="party"
                :items="availableParties"
                label="Partia"
                variant="outlined"
                density="comfortable"
                hide-details
                clearable
                multiple
                chips
                closable-chips
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-autocomplete
                v-model="companyTeryt"
                :items="availableRegions"
                label="Siedziba spółki"
                variant="outlined"
                density="comfortable"
                hide-details
                clearable
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-autocomplete
                v-model="place"
                :items="availableCompanies"
                label="Instytucje"
                variant="outlined"
                density="comfortable"
                hide-details
                clearable
                multiple
                chips
                closable-chips
              />
            </v-col>
          </v-row>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-divider class="my-3" />
    <v-btn
      color="primary"
      variant="flat"
      block
      class="text-none"
      @click="emit('close')"
    >
      {{ doneLabel }}
    </v-btn>
  </div>
</template>

<script setup lang="ts">
/** Every filter of /eksploruj/tabela, as the body of the query bar's „Filtry”
 * overlay.
 *
 * Its own component because that overlay is two overlays: a 760px menu at md
 * and up, a fullscreen dialog below it, both in the DOM at once and picked by
 * a Vuetify display class rather than by a width-driven `v-if`. One set of
 * controls written twice would be two sets of controls the first time somebody
 * edited one of them.
 */

import { mdiInformationOutline } from "@mdi/js";
import { computed, ref } from "vue";
import { companyCategories } from "~~/shared/companyCategories";
import { polishCounting } from "~/composables/polish";
import FormEksplorujTabelaVerificationFields from "./EksplorujTabelaVerificationFields.vue";

const props = withDefaults(
  defineProps<{
    availableParties: { title: string; value: string }[] | string[];
    availableRegions: { title: string; value: string }[];
    availableCompanies: { title: string; value: string }[];
    /** The reader is signed in, so the verification filters are theirs to
     * use. */
    showVisibility?: boolean;
    /** Rows the current query returns, for the closing button. Absent on a
     * page with no table under the panel. */
    totalItems?: number;
    /** The menu draws its own „Filtry / Wyczyść wszystkie” line; the dialog
     * has a toolbar for that. */
    showHeader?: boolean;
  }>(),
  { showVisibility: true, totalItems: undefined },
);

const emit = defineEmits<{ close: []; clear: [] }>();

const visibility = defineModel<"all" | "public" | "private">("visibility");
const party = defineModel<string[] | null>("party");
const teryt = defineModel<string | null>("teryt");
const companyTeryt = defineModel<string | null>("companyTeryt");
/** Selected employers, by place node id. */
const place = defineModel<string[] | null>("place");
const category = defineModel<string | null>("category");
const hideVoted = defineModel<"all" | "no_votes" | "has_votes">("hideVoted");
const currentlyEmployed = defineModel<"all" | "any" | "selected">(
  "currentlyEmployed",
);
const minEmploymentDate = defineModel<string | null>("minEmploymentDate");
const minVotes = defineModel<number | null>("minVotes");

const availableCategories = companyCategories.map((c) => ({
  title: c.title,
  value: c.value,
}));

const moreCount = computed(
  () =>
    [party.value?.length, companyTeryt.value, place.value?.length].filter(
      Boolean,
    ).length,
);

/** Read once, when the overlay is first opened: after that the reader has
 * decided whether the section is open, and reopening it under them on every
 * change of a filter they can see would be the panel arguing with them. */
const morePanel = ref<number | undefined>(moreCount.value ? 0 : undefined);

const doneLabel = computed(() =>
  props.totalItems === undefined
    ? "Gotowe"
    : `Pokaż ${polishCounting(props.totalItems, "osobę", "osoby", "osób")}`,
);
</script>
