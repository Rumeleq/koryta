<template>
  <div>
    <div class="d-flex align-center ga-2">
      <v-select
        v-model="sourceId"
        :items="options"
        item-title="name"
        item-value="id"
        label="Kto"
        density="compact"
        hide-details
        data-testid="analysis-relation-source"
      />
      <v-btn
        :icon="mdiSwapHorizontal"
        size="small"
        variant="text"
        title="Zamień strony"
        @click="swap"
      />
      <v-select
        v-model="targetId"
        :items="options"
        item-title="name"
        item-value="id"
        label="Z kim"
        density="compact"
        hide-details
        data-testid="analysis-relation-target"
      />
    </div>

    <!-- The verb comes after both ends because most pairs of kinds leave only
         one or two sensible relations, so it is a couple of chips rather than
         the whole schema. `relationChoices` is the same helper the entity page
         uses for its relation composer. -->
    <div v-if="choices.length" class="d-flex flex-wrap ga-1 mt-3">
      <v-chip
        v-for="(choice, index) in choices"
        :key="`${choice.edgeTypeExt}-${choice.direction}`"
        :color="index === choiceIndex ? 'primary' : undefined"
        :variant="index === choiceIndex ? 'flat' : 'outlined'"
        size="small"
        data-testid="analysis-relation-choice"
        @click="choiceIndex = index"
      >
        {{ sourceName }} {{ choice.verb }} {{ targetName }}
      </v-chip>
    </div>
    <v-alert
      v-else-if="sourceId && targetId && sourceId !== targetId"
      type="info"
      density="compact"
      variant="tonal"
      class="mt-3"
    >
      Między tymi podmiotami nie ma typowego powiązania - zapiszemy je jako
      zwykłe powiązanie z Twoim opisem.
    </v-alert>

    <v-text-field
      v-model="name"
      label="Jak to nazwać? (np. szwagier, kolega z rady)"
      density="compact"
      class="mt-3"
      hide-details
      data-testid="analysis-relation-name"
    />

    <v-textarea
      v-model="content"
      label="Co dokładnie powiedziano?"
      rows="2"
      auto-grow
      density="compact"
      class="mt-3"
      hide-details
      data-testid="analysis-relation-note"
    />

    <v-alert v-if="error" type="error" density="compact" class="mt-3">
      {{ error }}
    </v-alert>

    <div class="d-flex justify-end mt-3">
      <v-btn
        color="primary"
        :disabled="!ready"
        :loading="saving"
        data-testid="analysis-relation-save"
        @click="submit"
      >
        Dodaj powiązanie
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { mdiSwapHorizontal } from "@mdi/js";
import type { EdgeType } from "~~/shared/model";
import type { AnalysisEntity } from "~~/shared/analysis";
import { edgeTypeOptions, relationChoices } from "~/composables/useEdgeTypes";
import { useAnalysisContext } from "~/composables/analysis";

const props = defineProps<{
  entities: AnalysisEntity[];
  /** Prefilled as the "kto" end, so clicking a node on the graph and adding a
   * relation from it is two fields rather than three. */
  preselectedId?: string;
}>();

const analysis = useAnalysisContext();

const sourceId = ref<string | undefined>(props.preselectedId);
const targetId = ref<string | undefined>();
const choiceIndex = ref(0);
const name = ref("");
const content = ref("");
const saving = ref(false);
const error = ref("");

watch(
  () => props.preselectedId,
  (id) => {
    if (id && id !== targetId.value) sourceId.value = id;
  },
);

const options = computed(() =>
  props.entities.map((entity) => ({ id: entity.id, name: entity.name })),
);

const source = computed(() =>
  props.entities.find((e) => e.id === sourceId.value),
);
const target = computed(() =>
  props.entities.find((e) => e.id === targetId.value),
);

const sourceName = computed(() => source.value?.name ?? "?");
const targetName = computed(() => target.value?.name ?? "?");

const choices = computed(() => {
  if (!source.value || !target.value) return [];
  if (source.value.id === target.value.id) return [];
  return relationChoices(source.value.type, target.value.type);
});

watch(choices, () => {
  choiceIndex.value = 0;
});

const ready = computed(
  () => !!source.value && !!target.value && source.value.id !== target.value.id,
);

function swap() {
  const previous = sourceId.value;
  sourceId.value = targetId.value;
  targetId.value = previous;
}

async function submit() {
  if (!ready.value || !source.value || !target.value) return;
  saving.value = true;
  error.value = "";
  try {
    const choice = choices.value[choiceIndex.value];
    // Without a matching relation kind the pair still gets written down - the
    // point is to capture what was said, and "connection" with the user's own
    // wording is closer to that than refusing the entry.
    const type: EdgeType = choice
      ? edgeTypeOptions[choice.edgeTypeExt].realType
      : "connection";
    const flipped = choice?.direction === "incoming";

    await analysis.addEdge({
      source: flipped ? target.value.id : source.value.id,
      target: flipped ? source.value.id : target.value.id,
      type,
      name: name.value,
      content: content.value,
    });

    // Everything but the "kto" end is cleared: an interview usually walks
    // outwards from one person, so the next relation almost always starts at
    // the same place.
    targetId.value = undefined;
    name.value = "";
    content.value = "";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Nie udało się zapisać.";
  } finally {
    saving.value = false;
  }
}
</script>
