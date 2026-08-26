<template>
  <div class="d-flex align-center justify-space-between mb-2 mt-4">
    <h4 class="text-subtitle-1">
      {{ editedEdge ? "Edytuj powiązanie" : "Dodaj nowe powiązanie" }}
    </h4>
    <v-btn
      :icon="mdiClose"
      variant="text"
      size="small"
      title="Anuluj"
      @click="emit('update', false)"
    />
  </div>

  <v-form @submit.prevent="processEdge">
    <v-row class="align-center my-4">
      <!-- Left Condition: Source -->
      <v-col cols="5" class="text-center d-flex flex-column align-center">
        <FormEdgeSourceTarget
          v-model="layout.source.ref.value"
          :node-name="layout.source.id.value ? props.nodeName : undefined"
          :node-type="layout.source.type.value"
          :label="sourceLabel"
          data-testid="entity-picker-source"
        />
      </v-col>

      <!-- Connection (Center) -->
      <v-col
        cols="2"
        class="text-center d-flex flex-column justify-center position-relative px-0"
      >
        <div class="d-flex align-center justify-center">
          <v-chip
            variant="tonal"
            rounded="pill"
            size="small"
            color="secondary"
            class="px-4"
          >
            <span class="mr-1">
              {{ edgeLabel }}
            </span>
            <v-icon :icon="arrowIcon" />
          </v-chip>
        </div>
      </v-col>

      <!-- Right Condition: Target -->
      <v-col cols="5" class="text-center d-flex flex-column align-center">
        <FormEdgeSourceTarget
          v-model="layout.target.ref.value"
          :node-name="layout.target.id.value ? props.nodeName : undefined"
          :node-type="layout.target.type.value"
          :label="targetLabel"
          data-testid="entity-picker-target"
        />
      </v-col>
    </v-row>

    <v-row dense>
      <v-col cols="12" md="6">
        <v-text-field
          v-model="newEdge.name"
          :label="nameLabel"
          :placeholder="namePlaceholder"
          density="compact"
          hide-details
          data-testid="edge-name-field"
        />
      </v-col>
      <v-col cols="12" md="6">
        <v-text-field
          v-model="newEdge.content"
          label="Opis relacji (opcjonalnie)"
          density="compact"
          hide-details
        />
      </v-col>
      <v-col v-if="nodeType !== 'article'" cols="12">
        <EntityPicker
          v-model="referenceNode.ref.value"
          entity="article"
          label="Źródło informacji (artykuł)"
          density="compact"
          hide-details
          data-testid="entity-picker-reference"
        />
      </v-col>
      <template v-if="edgeType === 'employed'">
        <v-col cols="12" md="6">
          <v-text-field
            v-model="newEdge.start_date"
            label="Data rozpoczęcia"
            placeholder="RRRR-MM-DD"
            density="compact"
            hide-details="auto"
            :rules="[dateRule]"
            :prepend-inner-icon="mdiCalendar"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-text-field
            v-model="newEdge.end_date"
            label="Data zakończenia"
            placeholder="RRRR-MM-DD"
            density="compact"
            hide-details="auto"
            :rules="[dateRule]"
            :prepend-inner-icon="mdiCalendar"
          />
        </v-col>
      </template>
      <template v-if="edgeType === 'election'">
        <v-col cols="12" md="6">
          <v-select
            v-model="newEdge.party"
            :items="parties"
            label="Partia polityczna"
            density="compact"
            hide-details="auto"
            data-testid="edge-party-select"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-text-field
            v-model="newEdge.committee"
            label="Komitet wyborczy"
            density="compact"
            hide-details="auto"
            data-testid="edge-committee-field"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-select
            v-model="newEdge.position"
            :items="electionPositions"
            label="Stanowisko"
            density="compact"
            hide-details="auto"
            data-testid="edge-position-select"
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-select
            v-model="newEdge.term"
            :items="electionTerms"
            label="Kadencja"
            density="compact"
            hide-details="auto"
            data-testid="edge-term-select"
          />
        </v-col>
        <v-col cols="12" md="6">
          <!-- Three choices, not a checkbox. An unticked box says "nobody
               recorded a result" and "stood and did not take the seat" in the
               same breath, and those are different claims about a named
               person - the second is the one the site is about, so it has to
               be sayable, and the first has to stay the default. -->
          <v-select
            :items="electedOptions"
            :model-value="newEdge.elected ?? null"
            label="Wynik wyborów"
            density="compact"
            hide-details="auto"
            data-testid="edge-elected-select"
            @update:model-value="setElected"
          />
        </v-col>
        <v-col cols="12" md="6" class="d-flex align-center">
          <v-checkbox
            v-model="newEdge.by_election"
            label="Wybory uzupełniające"
            density="compact"
            hide-details="auto"
            class="mb-0"
            data-testid="edge-by-election-checkbox"
          />
        </v-col>
      </template>

      <v-col v-if="isSelfEdge" cols="12">
        <v-alert type="warning" variant="tonal" density="compact">
          Nie można połączyć wpisu z nim samym.
        </v-alert>
      </v-col>
      <v-col v-if="error" cols="12">
        <v-alert type="error" variant="tonal" density="compact">
          {{ error }}
        </v-alert>
      </v-col>

      <v-col cols="12" class="mt-2 d-flex gap-2">
        <v-btn
          v-if="editedEdge"
          variant="text"
          class="mr-2"
          @click="emit('update', false)"
        >
          Anuluj
        </v-btn>
        <v-btn
          color="secondary"
          type="submit"
          :block="!editedEdge"
          :class="{ 'flex-grow-1': editedEdge }"
          :disabled="!readyToSubmit || saving"
          :loading="saving"
          data-testid="submit-edge-button"
        >
          {{ editedEdge ? "Zapisz zmiany" : "Dodaj powiązanie" }}
        </v-btn>
        <DialogProposeRemoval
          v-if="editedEdge"
          :id="newEdge.id ?? ''"
          collection="edges"
          class="ml-2"
          @success="emit('update', true)"
        />
      </v-col>
    </v-row>
  </v-form>
</template>

<script setup lang="ts">
import { mdiArrowRight, mdiCalendar, mdiClose } from "@mdi/js";
import { ref, computed } from "vue";
import EntityPicker from "~/components/form/EntityPicker.vue";
import type { NodeType, Link } from "~~/shared/model";
import {
  type edgeTypeExt as EdgeTypeExt,
  edgeTypeOptions,
} from "~/composables/useEdgeTypes";
import { parties, electionPositions, electionTerms } from "~~/shared/misc";
import { electionOutcomeText } from "~~/shared/election";

const props = defineProps<{
  nodeId: string;
  nodeType: NodeType;
  nodeName: string;
  editedEdge?: string;
  edgeTypeExt: EdgeTypeExt;
  initialDirection?: "incoming" | "outgoing";
}>();

// Used to notify that the component has finished. `saved` tells a write apart
// from a cancel, which both close the form.
const emit = defineEmits<{
  (e: "update", saved?: boolean): void;
}>();

const arrowIcon = computed(() => mdiArrowRight);

const referenceNode: NodeRef = {
  type: "article",
  ref: ref<Link<NodeType> | undefined>(undefined),
};

const {
  newEdge,
  processEdge,
  openEditEdge,
  edgeType,
  edgeLabel,
  layout,
  readyToSubmit,
  isSelfEdge,
  saving,
  error,
} = useEdgeEdit({
  fixedNode: {
    id: props.nodeId,
    type: props.nodeType,
    ref: ref<Link<NodeType> | undefined>(undefined),
  },
  edgeType: props.edgeTypeExt,
  referenceNode,
  initialDirection: props.initialDirection,
  editedEdge: props.editedEdge,
  onUpdate: async () => emit("update", true),
});

const currentOption = computed(() => {
  return edgeType.value ? edgeTypeOptions[edgeType.value] : undefined;
});

const sourceLabel = computed(() => currentOption.value?.sourceLabel);
const targetLabel = computed(() => currentOption.value?.targetLabel);

/** The name field carries whatever the relation is called, and what that is
 * depends entirely on the relation: a job has a title, a tie between two people
 * has a word for it. */
const nameLabel = computed(() => {
  if (edgeType.value === "employed") return "Stanowisko / rola";
  if (edgeType.value === "connection") return "Rodzaj powiązania";
  return "Nazwa relacji";
});

const namePlaceholder = computed(() => {
  if (edgeType.value === "employed") return "np. prezes zarządu";
  if (edgeType.value === "connection") return "np. żona, brat, wspólnik";
  return undefined;
});

defineExpose({
  openEditEdge,
});

/** The three answers the form may give about how a candidacy ended, default
 * first. `null` rather than `undefined` as the "nie wiadomo" value so that
 * Vuetify has something to compare the select against - the form turns it back
 * into an absent field on the way out. */
const electedOptions = [
  { title: "Nie wiadomo", value: null },
  { title: electionOutcomeText.elected.label, value: true },
  { title: electionOutcomeText.lost.label, value: false },
];

function setElected(value: boolean | null) {
  newEdge.value.elected = value ?? undefined;
}

function dateRule(value: string) {
  if (!value) return true;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  return regex.test(value) || "Format daty musi być RRRR-MM-DD";
}
</script>
