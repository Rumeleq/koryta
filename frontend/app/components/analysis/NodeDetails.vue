<template>
  <div v-if="entity">
    <div class="d-flex align-start ga-2 mb-2">
      <v-icon :icon="nodeTypeSvgIcon[entity.type]" class="mt-1" />
      <div class="flex-grow-1">
        <div class="text-h6 text-wrap">{{ entity.name }}</div>
        <div class="text-caption text-medium-emphasis">
          {{ nodeTypeLabel[entity.type] }}
          <template v-if="isLocalEntityId(entity.id)">
            &middot;
            <span class="text-error">spoza bazy</span>
          </template>
        </div>
      </div>
      <v-btn
        v-if="baseNodeId"
        :icon="mdiOpenInNew"
        size="small"
        variant="text"
        title="Otwórz stronę w bazie"
        :href="generateEntityUrl(entity.type, baseNodeId, entity.name)"
        target="_blank"
      />
    </div>

    <v-textarea
      v-if="editable"
      v-model="noteDraft"
      label="Dlaczego jest w analizie?"
      rows="1"
      auto-grow
      density="compact"
      hide-details
      class="mb-3"
      data-testid="analysis-entity-note"
      @blur="saveEntityNote"
    />
    <p v-else-if="entity.note" class="text-body-2 mb-3">{{ entity.note }}</p>

    <v-divider class="mb-3" />

    <div class="text-subtitle-2 mb-2">Powiązania w analizie</div>
    <AnalysisRelationList :entity-id="entity.id" />

    <v-divider class="my-3" />

    <div class="text-subtitle-2 mb-2">Notatki z tej analizy</div>
    <p class="text-caption text-medium-emphasis mb-2">
      Widoczne tylko dla osób, którym udostępniono tę analizę.
    </p>

    <v-list v-if="entityNotes.length" density="compact" class="py-0 mb-2">
      <v-list-item v-for="note in entityNotes" :key="note.id" class="px-0">
        <v-list-item-title class="text-body-2 text-wrap">
          {{ note.content }}
        </v-list-item-title>
        <v-list-item-subtitle class="text-caption">
          {{ authorName(note.authorUid) }} &middot;
          {{ formatDate(note.updatedAt ?? note.createdAt) }}
        </v-list-item-subtitle>
        <template #append>
          <v-btn
            v-if="editable"
            :icon="mdiClose"
            size="x-small"
            variant="text"
            title="Usuń notatkę"
            @click="analysis.removeNote(note.id)"
          />
        </template>
      </v-list-item>
    </v-list>

    <div v-if="editable" class="d-flex ga-2 align-end">
      <v-textarea
        v-model="newNote"
        label="Co usłyszałeś/aś?"
        rows="2"
        auto-grow
        density="compact"
        hide-details
        data-testid="analysis-note-input"
      />
      <v-btn
        color="primary"
        :disabled="!newNote.trim()"
        :loading="savingNote"
        data-testid="analysis-note-save"
        @click="addNote"
      >
        Dodaj
      </v-btn>
    </div>

    <!-- The public notes the base already holds on this page. Reused rather
         than rebuilt: NoteEditor renders everybody's entries and lets the
         reader add their own, which is exactly what "the whole view of the
         scene" needs. Local entities have no page to hang one off yet. -->
    <template v-if="baseNodeId">
      <v-divider class="my-3" />
      <NoteEditor
        :key="baseNodeId"
        :node-id="baseNodeId"
        :node-type="entity.type"
        single-column
      />
    </template>
  </div>

  <p v-else class="text-medium-emphasis text-body-2">
    Kliknij podmiot na grafie albo na liście, żeby zobaczyć szczegóły.
  </p>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { mdiClose, mdiOpenInNew } from "@mdi/js";
import { generateEntityUrl } from "~/composables/slugs";
import { isLocalEntityId } from "~~/shared/analysis";
import { nodeTypeLabel, nodeTypeSvgIcon } from "~/composables/nodeIcons";
import { useAnalysisContext } from "~/composables/analysis";

const props = defineProps<{ entityId?: string }>();

const analysis = useAnalysisContext();
const editable = analysis.editable;

const entity = computed(() =>
  props.entityId ? analysis.entityById.value[props.entityId] : undefined,
);

/** The page in the base this entity has, if it has one - either because it came
 * from there, or because it has since been proposed. */
const baseNodeId = computed(() => {
  if (!entity.value) return undefined;
  if (!isLocalEntityId(entity.value.id)) return entity.value.id;
  return entity.value.promotedNodeId;
});

const noteDraft = ref("");
watch(
  entity,
  (value) => {
    noteDraft.value = value?.note ?? "";
  },
  { immediate: true },
);

async function saveEntityNote() {
  if (!entity.value) return;
  const next = noteDraft.value.trim();
  if (next === (entity.value.note ?? "")) return;
  await analysis.updateEntity(entity.value.id, { note: next });
}

const entityNotes = computed(() =>
  analysis.notes.value
    .filter((note) => note.entityId === props.entityId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
);

const newNote = ref("");
const savingNote = ref(false);

async function addNote() {
  if (!newNote.value.trim() || !props.entityId) return;
  savingNote.value = true;
  try {
    await analysis.addNote(newNote.value, props.entityId);
    newNote.value = "";
  } finally {
    savingNote.value = false;
  }
}

function authorName(uid: string): string {
  const member = analysis.members.value.find((m) => m.uid === uid);
  return member?.displayName || member?.email || "Ktoś z zespołu";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pl-PL", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
</script>
