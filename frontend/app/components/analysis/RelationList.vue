<template>
  <div>
    <v-alert v-if="error" type="error" density="compact" class="mb-2">
      {{ error }}
    </v-alert>

    <v-list v-if="relations.length" density="compact" class="py-0">
      <v-list-item
        v-for="edge in relations"
        :key="edge.id"
        class="px-0"
        data-testid="analysis-relation-row"
      >
        <v-list-item-title class="text-body-2 text-wrap">
          {{ nameOf(edge.source) }}
          <span class="text-medium-emphasis">
            {{ edge.name || edgeTypeLabels[edge.type] || edge.type }}
          </span>
          {{ nameOf(edge.target) }}
        </v-list-item-title>
        <v-list-item-subtitle v-if="edge.content" class="text-wrap">
          {{ edge.content }}
        </v-list-item-subtitle>
        <v-list-item-subtitle v-if="edge.promotedEdgeId">
          Zgłoszone do bazy - czeka na zatwierdzenie
        </v-list-item-subtitle>

        <template #append>
          <v-btn
            v-if="editable && !edge.promotedEdgeId"
            :icon="mdiDatabasePlusOutline"
            size="x-small"
            variant="text"
            title="Zgłoś powiązanie do bazy"
            :loading="promoting === edge.id"
            @click="promote(edge.id)"
          />
          <v-btn
            v-if="editable"
            :icon="mdiClose"
            size="x-small"
            variant="text"
            title="Usuń powiązanie"
            @click="remove(edge.id)"
          />
        </template>
      </v-list-item>
    </v-list>

    <p v-else class="text-medium-emphasis text-body-2">
      {{
        entityId
          ? "Ten podmiot nie ma jeszcze powiązań dodanych w analizie."
          : "Nie dodano jeszcze żadnych powiązań."
      }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { mdiClose, mdiDatabasePlusOutline } from "@mdi/js";
import { edgeTypeLabels } from "~/composables/edges";
import { useAnalysisContext } from "~/composables/analysis";

const props = defineProps<{
  /** Narrows the list to relations touching one entity. All of them when
   * absent, which is what the "Scena" tab shows. */
  entityId?: string;
}>();

const analysis = useAnalysisContext();
const editable = analysis.editable;

const promoting = ref<string | null>(null);
const error = ref("");

const relations = computed(() =>
  analysis.edges.value.filter(
    (edge) =>
      !props.entityId ||
      edge.source === props.entityId ||
      edge.target === props.entityId,
  ),
);

function nameOf(id: string): string {
  return analysis.entityById.value[id]?.name ?? "?";
}

async function remove(id: string) {
  error.value = "";
  try {
    await analysis.removeEdge(id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Nie udało się usunąć.";
  }
}

async function promote(id: string) {
  promoting.value = id;
  error.value = "";
  try {
    await analysis.promoteEdge(id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Nie udało się zgłosić.";
  } finally {
    promoting.value = null;
  }
}
</script>
