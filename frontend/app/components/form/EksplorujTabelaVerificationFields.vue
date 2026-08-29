<template>
  <v-row dense>
    <v-col v-if="shown('visibility')" cols="12" :md="only ? 12 : 6">
      <v-select
        v-model="visibility"
        :items="visibilityOptions"
        label="Widoczność"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col v-if="shown('hideVoted')" cols="12" :md="only ? 12 : 6">
      <v-select
        v-model="hideVoted"
        :items="hideVotedOptions"
        label="Głosy społeczności"
        variant="outlined"
        density="comfortable"
        hide-details
      />
    </v-col>
    <v-col v-if="shown('minEmploymentDate')" cols="12" :md="only ? 12 : 6">
      <v-text-field
        v-model="minEmploymentDate"
        type="date"
        label="Zatrudnieni od"
        variant="outlined"
        density="comfortable"
        hide-details
        clearable
      />
    </v-col>
    <v-col v-if="shown('minVotes')" cols="12" :md="only ? 12 : 6">
      <v-text-field
        :model-value="minVotes"
        type="number"
        label="Min. głosy łącznie"
        variant="outlined"
        density="comfortable"
        hide-details
        clearable
        :min="0"
        @update:model-value="setMinVotes"
      />
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
/** The four filters only an editor can use, in one place.
 *
 * They are rendered twice on /eksploruj/tabela - all four in the filter panel,
 * and one at a time behind the `+ Nazwa` shortcuts in the query bar's work row
 * - and the labels and the option lists have to be the same in both. A chip
 * reading „Bez ocenionych” next to a menu offering „Brak głosów” would be two
 * names for one filter, which is why the two option lists come from
 * `shared/queryUrl` - the module the chips are worded by - rather than being
 * spelled out here.
 */

import { hideVotedOptions, visibilityOptions } from "~~/shared/queryUrl";

type VerificationKey =
  "visibility" | "hideVoted" | "minEmploymentDate" | "minVotes";

const props = defineProps<{
  /** Render a single control rather than all four - what the work row's
   * shortcut menus hold. */
  only?: VerificationKey;
}>();

const visibility = defineModel<"all" | "public" | "private">("visibility");
const hideVoted = defineModel<"all" | "no_votes" | "has_votes">("hideVoted");
const minEmploymentDate = defineModel<string | null>("minEmploymentDate");
const minVotes = defineModel<number | null>("minVotes");

const shown = (key: VerificationKey) => !props.only || props.only === key;

/** `type="number"` still hands back a string, and the page writes this value
 * into `?minVotes=` and into the api's `Query`, where it is typed as a number
 * and compared with `>=`. Parsed here so that the one place that knows the
 * field is numeric is the one that reads it. An empty field is not `0`: zero
 * is a filter of its own (it excludes everyone with no votes field at all). */
function setMinVotes(value: string | null) {
  if (value === null || value === "") {
    minVotes.value = null;
    return;
  }
  const parsed = Number.parseInt(value, 10);
  minVotes.value = Number.isNaN(parsed) ? null : parsed;
}
</script>
