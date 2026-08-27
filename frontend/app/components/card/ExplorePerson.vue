<template>
  <v-card v-if="person" class="ma-2" flat>
    <v-card-title class="text-wrap text-h5 mb-2 d-flex align-center ga-2">
      <!-- Not `text-primary`. Sage on white is 1.85:1, and this is the
           person's name - the one thing on the card a reader has to be able
           to read. Default ink, with the underline kept for the hover. -->
      <NuxtLink :to="`/osoba/${person.id}`" class="person-link" target="_blank">
        {{ person.name }}
      </NuxtLink>
      <PartyChip
        v-for="party in person.parties"
        :key="party"
        :party
        class="text-body-2"
      />
    </v-card-title>

    <v-card-text>
      <CardPersonInfo :person="person" class="mb-4" />

      <div v-if="person.content" class="text-body-2 mb-4">
        {{ person.content }}
      </div>

      <!-- Action: Google Search -->
      <div>
        <div class="text-caption text-medium-emphasis mb-2">
          Wyszukaj w internecie informacji:
        </div>
        <!-- Outlined and uncoloured, for the reason the title above is:
             `tonal` + `primary` is pale sage type on a paler sage fill, and
             these carry the search terms a reader picks between. -->
        <v-btn
          v-for="query in queries"
          :key="query"
          :prepend-icon="mdiGoogle"
          variant="outlined"
          class="ma-1"
          @click="searchInGoogle(query)"
        >
          {{ query }}
        </v-btn>
      </div>
    </v-card-text>
  </v-card>
  <v-card v-else flat class="d-flex align-center justify-center pa-10 h-100">
    <div class="text-medium-emphasis">
      Wybierz osobę z tabeli, aby wyświetlić akcje.
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { mdiGoogle } from "@mdi/js";
import { toRef } from "vue";
import type { PersonRich } from "~~/shared/model";
import { usePersonSearch } from "~/composables/usePersonSearch";

const props = withDefaults(
  defineProps<{
    person: undefined | PersonRich;
    region: undefined | [string, string];
    company: undefined | [string, string];
    /** Cities to search in alongside the ones on `person`, for a caller that
     * derived them itself. */
    workLocations?: string[];
  }>(),
  { workLocations: undefined },
);

const { queries, searchInGoogle } = usePersonSearch(
  toRef(props, "person"),
  toRef(props, "region"),
  toRef(props, "company"),
  toRef(props, "workLocations"),
);
</script>

<style scoped>
.person-link {
  color: rgba(var(--v-theme-on-surface), 0.87);
  text-decoration: none;
}

.person-link:hover {
  text-decoration: underline;
}
</style>
