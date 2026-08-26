<template>
  <div v-if="chips.length" class="d-flex flex-wrap align-center ga-1">
    <v-chip
      v-for="chip in chips"
      :key="chip.value"
      :to="chip.to"
      :prepend-icon="mdiTagOutline"
      size="x-small"
      variant="tonal"
    >
      {{ chip.title }}
    </v-chip>
  </div>
</template>

<script lang="ts" setup>
import { mdiTagOutline } from "@mdi/js";
import { computed } from "vue";
import { asArray, type Company } from "~~/shared/model";
import { categoryFilterUrl, categoryTitle } from "~~/shared/companyCategories";

const props = defineProps<{
  /** Takes the whole company rather than the array, so a caller holding
   * something that may not be a company at all can hand it straight over -
   * the same contract `ChipPublicCompany` has. */
  company: Company | undefined;
}>();

/** Each chip links to the filter it corresponds to, because the category is
 * only useful as a way into the rest of the sector: a reader who sees „Koleje”
 * here wants the other railways, not a label.
 *
 * Read through `asArray` because a node written before 2026-07-28 stores its
 * arrays as `{"0": "koleje"}` maps - see `unwrap-array-fields.ts`. A value the
 * site no longer names is still shown, as itself: dropping it would hide that
 * the pipelines and `shared/companyCategories.ts` have drifted apart.
 */
const chips = computed(() =>
  asArray<string>(props.company?.categories).map((value) => ({
    value,
    title: categoryTitle(value),
    to: categoryFilterUrl(value),
  })),
);
</script>
