<template>
  <!-- One root, so the `.elections-cell` caps explore/Table.vue sets - 220px
       on a desktop, 185px inside the phone budget - still land on it: Vue
       stamps a child's root element with the parent's scope id as well as its
       own. The rules that reach *inside* a chip cannot travel that way, so
       they moved down here with the markup. -->
  <div v-if="elections?.length" class="elections-cell py-1">
    <v-chip
      v-for="(election, i) in elections"
      :key="i"
      size="small"
      class="mb-1"
      variant="outlined"
    >
      <v-tooltip activator="parent" location="top" open-delay="200">
        <div v-if="election.location">{{ election.location }}</div>
        <div>
          {{
            getWojewodztwo(election.teryt)
              ? `woj. ${getWojewodztwo(election.teryt)}`
              : "Brak informacji o województwie"
          }}
        </div>
        <div v-if="election.committee">{{ election.committee }}</div>
      </v-tooltip>
      <span v-if="election.year" class="font-weight-bold mr-1">
        {{ election.year }}
      </span>
      <span v-if="election.location" class="election-location">
        {{ election.location }}
      </span>
    </v-chip>
  </div>
</template>

<script setup lang="ts">
/** The elections a person stood in, as chips.
 *
 * Its own component because /eksploruj/tabela draws them as a column of their
 * own ("Wybory", desktop only) while /eksploruj/nowe keeps them inside the
 * merged history cell, and one block of markup cannot be rendered into two
 * data-table cells. Copying it into both slots would have left the tooltip -
 * which is where the committee name lives, and the whole reason this column is
 * narrow - to drift between the two copies. */
import type { PersonRich } from "~~/shared/model";

defineProps<{ elections?: PersonRich["elections"] }>();

const terytToWojewodztwo: Record<string, string> = {
  "02": "dolnośląskie",
  "04": "kujawsko-pomorskie",
  "06": "lubelskie",
  "08": "lubuskie",
  "10": "łódzkie",
  "12": "małopolskie",
  "14": "mazowieckie",
  "16": "opolskie",
  "18": "podkarpackie",
  "20": "podlaskie",
  "22": "pomorskie",
  "24": "śląskie",
  "26": "świętokrzyskie",
  "28": "warmińsko-mazurskie",
  "30": "wielkopolskie",
  "32": "zachodniopomorskie",
};

const getWojewodztwo = (teryt?: string) => {
  if (!teryt || teryt.length < 2) return undefined;
  return terytToWojewodztwo[teryt.substring(0, 2)];
};
</script>

<style scoped>
.elections-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.elections-cell .v-chip {
  max-width: 100%;
}

.elections-cell :deep(.v-chip__content) {
  min-width: 0;
}

/* A town name long enough to widen the column is cut instead - the full one is
 * in the tooltip above, next to the committee. */
.election-location {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
