<template>
  <v-chip
    size="small"
    variant="tonal"
    :color="row.isSelf ? 'primary' : undefined"
    class="contributor-name"
  >
    <template #prepend>
      <v-avatar v-if="row.photoURL" start :image="row.photoURL" />
      <v-icon v-else start size="small" :icon="icon" />
    </template>
    <span class="text-truncate" style="max-width: 180px">{{ row.name }}</span>
    <span v-if="row.isSelf" class="ml-1 font-weight-medium">· Ty</span>
    <v-tooltip activator="parent" location="bottom" :text="explanation" />
  </v-chip>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiAccountCircle, mdiEyeOffOutline } from "@mdi/js";
import type { ActivityContributor } from "~~/server/api/stats/activity.get";

/** One name in the public ranking, as far as the reader is allowed to see it.
 *
 * Deliberately not `UserChip`: that one takes a uid and resolves it through the
 * admin-only lookup, which is exactly the thing a public ranking must not do.
 * Everything shown here arrived on the row already decided by the server, so
 * there is no identity to fetch and nothing to fall back to.
 */
const props = defineProps<{ row: ActivityContributor }>();

const icon = computed(() =>
  props.row.named ? mdiAccountCircle : mdiEyeOffOutline,
);

const explanation = computed(() => {
  if (props.row.isSelf) {
    return props.row.named
      ? "To Ty. Twoja nazwa jest widoczna dla wszystkich."
      : "To Ty. Inni widzą w tym miejscu zamazaną nazwę — możesz to zmienić w swoim profilu.";
  }
  return props.row.named
    ? "Ta osoba zgodziła się, żeby jej nazwa była widoczna publicznie."
    : "Ta osoba nie pokazuje swojej nazwy publicznie.";
});
</script>

<style scoped>
/* The masked rows are the majority, and a table of them should read as a
   ranking rather than as a wall of redactions. */
.contributor-name {
  font-variant-numeric: tabular-nums;
}
</style>
