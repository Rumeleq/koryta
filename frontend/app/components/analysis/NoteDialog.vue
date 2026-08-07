<template>
  <v-dialog v-model="open" max-width="520">
    <v-card :title="entity ? `Notatka: ${entity.name}` : 'Notatka'">
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-3">
          Widoczna tylko dla osób, którym udostępniono tę analizę.
        </p>

        <v-alert v-if="error" type="error" density="compact" class="mb-3">
          {{ error }}
        </v-alert>

        <v-textarea
          v-model="content"
          label="Co usłyszałeś/aś?"
          rows="4"
          auto-grow
          autofocus
          hide-details
          data-testid="analysis-note-dialog-input"
        />
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn @click="open = false">Anuluj</v-btn>
        <v-btn
          color="primary"
          :disabled="!content.trim()"
          :loading="saving"
          data-testid="analysis-note-dialog-save"
          @click="save"
        >
          Zapisz
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAnalysisContext } from "~/composables/analysis";

const props = defineProps<{ entityId?: string }>();

const open = defineModel<boolean>({ required: true });

const analysis = useAnalysisContext();

const entity = computed(() =>
  props.entityId ? analysis.entityById.value[props.entityId] : undefined,
);

const content = ref("");
const saving = ref(false);
const error = ref("");

// Opened fresh each time rather than keeping a draft: this is reached by
// clicking a node, and carrying the last node's half-written note over to the
// next one is how a wrong note gets saved against the wrong person.
watch(open, (isOpen) => {
  if (isOpen) {
    content.value = "";
    error.value = "";
  }
});

async function save() {
  if (!content.value.trim() || !props.entityId) return;
  saving.value = true;
  error.value = "";
  try {
    await analysis.addNote(content.value, props.entityId);
    open.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Nie udało się zapisać.";
  } finally {
    saving.value = false;
  }
}
</script>
