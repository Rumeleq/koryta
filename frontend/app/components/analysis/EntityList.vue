<template>
  <div>
    <div v-if="editable" class="mb-2">
      <!-- No articles, deliberately: /api/search does not index them, and
           EntityPicker answers that by listing every article instead of
           searching at all - which would turn this field into a dropdown of the
           whole archive and stop it finding people. -->
      <FormEntityPicker
        v-model="picked"
        :entity="['person', 'place', 'region']"
        label="Dodaj osobę, firmę lub instytucję"
        hint="Szukaj w bazie, albo dodaj kogoś, kogo w niej jeszcze nie ma"
        persistent-hint
        density="comfortable"
        data-testid="analysis-entity-picker"
      />
      <div class="d-flex justify-end mt-1">
        <v-btn
          size="small"
          variant="text"
          :prepend-icon="mdiAccountQuestionOutline"
          data-testid="analysis-add-local"
          @click="localDialog = true"
        >
          Dodaj kogoś spoza bazy
        </v-btn>
      </div>
    </div>

    <v-alert v-if="error" type="error" density="compact" class="mb-2">
      {{ error }}
    </v-alert>

    <v-list v-if="entities.length" density="compact" class="py-0">
      <v-list-item
        v-for="entity in entities"
        :key="entity.id"
        :active="entity.id === selectedId"
        data-testid="analysis-entity-row"
        @click="emit('select', entity.id)"
      >
        <template #prepend>
          <v-icon
            :icon="nodeTypeSvgIcon[entity.type]"
            :color="isLocalEntityId(entity.id) ? 'error' : undefined"
          />
        </template>

        <v-list-item-title>{{ entity.name }}</v-list-item-title>
        <v-list-item-subtitle v-if="entity.note">
          {{ entity.note }}
        </v-list-item-subtitle>
        <v-list-item-subtitle v-if="isLocalEntityId(entity.id)">
          <template v-if="entity.promotedNodeId">
            Zgłoszony do bazy - czeka na zatwierdzenie
          </template>
          <template v-else>Nie ma go jeszcze w bazie</template>
        </v-list-item-subtitle>

        <template #append>
          <v-btn
            v-if="
              editable &&
              isLocalEntityId(entity.id) &&
              !entity.promotedNodeId &&
              (entity.type === 'person' || entity.type === 'place')
            "
            :icon="mdiDatabasePlusOutline"
            size="x-small"
            variant="text"
            title="Zgłoś do bazy"
            :loading="promoting === entity.id"
            @click.stop="promote(entity.id)"
          />
          <v-btn
            v-if="editable"
            :icon="mdiClose"
            size="x-small"
            variant="text"
            title="Usuń z analizy"
            @click.stop="remove(entity)"
          />
        </template>
      </v-list-item>
    </v-list>

    <p v-else class="text-medium-emphasis text-body-2">
      Nic tu jeszcze nie ma.
    </p>

    <v-dialog v-model="localDialog" max-width="480">
      <v-card title="Podmiot spoza bazy">
        <v-card-text>
          <p class="text-body-2 mb-4">
            Ktoś wymieniony w rozmowie, kogo nie ma jeszcze w koryta.pl. Będzie
            widoczny tylko w tej analizie, dopóki go z niej nie zgłosisz.
          </p>
          <v-text-field
            v-model="localName"
            label="Imię i nazwisko albo nazwa"
            autofocus
            data-testid="analysis-local-name"
            @keyup.enter="addLocal"
          />
          <v-btn-toggle
            v-model="localType"
            mandatory
            density="comfortable"
            class="mb-4"
          >
            <v-btn value="person">Osoba</v-btn>
            <v-btn value="place">Firma / instytucja</v-btn>
          </v-btn-toggle>
          <v-textarea
            v-model="localNote"
            label="Kto to jest? (opcjonalnie)"
            rows="2"
            auto-grow
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="localDialog = false">Anuluj</v-btn>
          <v-btn
            color="primary"
            :disabled="!localName.trim()"
            :loading="saving"
            data-testid="analysis-local-save"
            @click="addLocal"
          >
            Dodaj
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import {
  mdiAccountQuestionOutline,
  mdiClose,
  mdiDatabasePlusOutline,
} from "@mdi/js";
import type { Link, NodeType } from "~~/shared/model";
import { isLocalEntityId, type AnalysisEntity } from "~~/shared/analysis";
import { nodeTypeSvgIcon } from "~/composables/nodeIcons";
import { useAnalysisContext } from "~/composables/analysis";

const props = defineProps<{
  entities: AnalysisEntity[];
  editable: boolean;
  selectedId?: string;
}>();

const emit = defineEmits<{
  /** `select` is the user asking to look at an entity; `added` is one that was
   * just created, which is selected without taking the reader off the panel
   * they are working in - somebody transcribing an interview adds several in a
   * row, and a jump to the details tab after each puts the next field out of
   * reach. */
  (e: "select" | "added", id: string): void;
}>();

const analysis = useAnalysisContext();

const picked = ref<Link<NodeType> | undefined>();
const localDialog = ref(false);
const localName = ref("");
const localType = ref<NodeType>("person");
const localNote = ref("");
const saving = ref(false);
const promoting = ref<string | null>(null);
const error = ref("");

/** The picker keeps the entry it chose selected; clearing it is what lets the
 * same field be used again straight away, which is how somebody transcribing an
 * interview uses it. */
watch(picked, async (value) => {
  if (!value) return;
  error.value = "";
  try {
    await analysis.addEntity({
      id: value.id,
      type: value.type,
      name: value.name,
    });
    emit("added", value.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Nie udało się dodać.";
  } finally {
    picked.value = undefined;
  }
});

async function addLocal() {
  if (!localName.value.trim()) return;
  saving.value = true;
  error.value = "";
  try {
    const id = await analysis.addLocalEntity({
      type: localType.value,
      name: localName.value,
      note: localNote.value.trim() || undefined,
    });
    localDialog.value = false;
    localName.value = "";
    localNote.value = "";
    emit("added", id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Nie udało się dodać.";
  } finally {
    saving.value = false;
  }
}

async function remove(entity: AnalysisEntity) {
  error.value = "";
  try {
    await analysis.removeEntity(entity.id);
    if (props.selectedId === entity.id) emit("select", "");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Nie udało się usunąć.";
  }
}

async function promote(id: string) {
  promoting.value = id;
  error.value = "";
  try {
    await analysis.promoteEntity(id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Nie udało się zgłosić.";
  } finally {
    promoting.value = null;
  }
}
</script>
