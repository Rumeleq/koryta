<template>
  <div class="d-flex flex-wrap ga-1 py-1">
    <v-tooltip
      v-for="companyName in named"
      :key="companyName"
      :text="shortCompanyName(companyName)"
      location="top"
    >
      <template #activator="{ props: tip }">
        <v-chip
          v-bind="tip"
          :size="size"
          class="text-truncate"
          variant="outlined"
          :style="{ maxWidth: maxWidth }"
        >
          {{ shortCompanyName(companyName) }}
        </v-chip>
      </template>
    </v-tooltip>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    /** As the api hands them over: a person's employers are looked up by id,
     * and one whose node is missing comes back undefined. */
    companies?: (string | undefined)[];
    size?: string;
    /** How wide one chip may get before its name is truncated. The table cell
     * and the phone card have very different budgets. */
    maxWidth?: string;
  }>(),
  { companies: () => [], size: "small", maxWidth: "300px" },
);

const named = computed(() =>
  props.companies.filter((name): name is string => !!name),
);

/** The legal form spelled out in full is most of a registry name and none of
 * the information, so it is dropped from the label. */
const shortCompanyName = (companyName: string | undefined) => {
  if (!companyName) return "";
  const spolka = "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ";
  const index = companyName.indexOf(spolka);
  if (index === -1) return companyName;
  return companyName.slice(0, index) + companyName.slice(index + spolka.length);
};
</script>
