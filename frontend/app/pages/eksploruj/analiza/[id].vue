<template>
  <ClientOnly>
    <div class="analysis-page">
      <div class="analysis-page__graph">
        <AnalysisCanvas
          v-model:selected-nodes="selectedNodes"
          :nodes="graph.nodes.value"
          :edges="graph.edges.value"
          :ready="graph.ready.value"
          :editable="analysis.editable.value"
          @select="onSelect"
          @open="onOpen"
          @note="onNoteFromGraph"
          @connect="onConnectFromGraph"
          @add="onAddFromGraph"
        />
      </div>

      <div class="analysis-page__panel">
        <v-alert
          v-if="notFound"
          type="warning"
          variant="tonal"
          class="ma-3"
          data-testid="analysis-missing"
        >
          Nie ma takiej analizy, albo nie została Ci udostępniona.
        </v-alert>

        <template v-else>
          <div class="pa-3 pb-0">
            <div class="d-flex align-start ga-2">
              <div class="flex-grow-1">
                <div class="text-h6 text-wrap">
                  {{ analysis.analysis.value?.title ?? "Analiza" }}
                </div>
                <div
                  v-if="!analysis.editable.value"
                  class="text-caption text-medium-emphasis"
                >
                  Masz dostęp tylko do odczytu
                </div>
              </div>
              <v-btn
                :icon="mdiAccountMultipleOutline"
                size="small"
                variant="text"
                title="Udostępnianie"
                data-testid="analysis-share-open"
                @click="shareOpen = true"
              />
            </div>

            <!-- Depth applies to the whole scene rather than to each entity:
                 one slider is what makes "show me a bit more around all of
                 this" a single move during a conversation. -->
            <div class="d-flex align-center ga-3 mt-2">
              <span class="text-caption text-no-wrap">Sąsiedzi z bazy</span>
              <v-slider
                :model-value="analysis.analysis.value?.depth ?? 1"
                :min="0"
                :max="ANALYSIS_MAX_DEPTH"
                :step="1"
                :disabled="!analysis.editable.value"
                show-ticks="always"
                tick-size="3"
                hide-details
                density="compact"
                data-testid="analysis-depth"
                @update:model-value="analysis.setDepth($event)"
              />
              <span class="text-caption">{{ depthLabel }}</span>
            </div>
          </div>

          <v-tabs v-model="tab" density="compact" class="px-2">
            <v-tab value="scene" data-testid="analysis-tab-scene">Scena</v-tab>
            <v-tab value="details" data-testid="analysis-tab-details">
              Szczegóły
            </v-tab>
          </v-tabs>

          <v-divider />

          <div class="analysis-page__scroll pa-3">
            <v-window v-model="tab">
              <v-window-item value="scene">
                <div class="text-subtitle-2 mb-2">Podmioty</div>
                <AnalysisEntityList
                  :entities="analysis.entities.value"
                  :editable="analysis.editable.value"
                  :selected-id="selectedId"
                  @select="onSelect"
                  @added="onSelect($event, false)"
                />

                <template v-if="analysis.editable.value">
                  <v-divider class="my-4" />
                  <div ref="relationSection" class="text-subtitle-2 mb-2">
                    Dodaj powiązanie
                  </div>
                  <AnalysisAddRelation
                    :entities="analysis.entities.value"
                    :preselected-id="selectedId"
                  />
                </template>

                <v-divider class="my-4" />
                <div class="text-subtitle-2 mb-2">
                  Powiązania dodane w analizie
                </div>
                <AnalysisRelationList />
              </v-window-item>

              <v-window-item value="details">
                <AnalysisNodeDetails :entity-id="selectedId" />
              </v-window-item>
            </v-window>
          </div>
        </template>
      </div>

      <AnalysisShareDialog v-if="!notFound" v-model="shareOpen" />
      <AnalysisNoteDialog
        v-if="!notFound"
        v-model="noteOpen"
        :entity-id="selectedId"
      />
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { mdiAccountMultipleOutline } from "@mdi/js";
import type { NodeType } from "~~/shared/model";
import { ANALYSIS_MAX_DEPTH } from "~~/shared/analysis";
import { provideAnalysis, useAnalysis } from "~/composables/analysis";
import { useAnalysisGraph } from "~/composables/analysisGraph";
import { generateEntityUrl } from "~/composables/slugs";

definePageMeta({
  middleware: "auth",
  title: "Analiza",
  fullWidth: true,
  hideSearch: true,
  robots: false,
});

const route = useRoute();
const analysisId = computed(() => String(route.params.id ?? ""));

const analysis = provideAnalysis(useAnalysis(analysisId));
const graph = useAnalysisGraph(analysis.analysis);

useHead({
  title: () =>
    `${analysis.analysis.value?.title ?? "Analiza"} - analiza - koryta.pl`,
});

// `useDocument` yields undefined while loading and null once it has looked and
// found nothing - which is also what a reader without access sees, since the
// firestore rules refuse the read.
const notFound = computed(() => analysis.analysis.value === null);

const tab = ref<"scene" | "details">("scene");
const selectedId = ref<string | undefined>();
const selectedNodes = ref<string[]>([]);

const depthLabel = computed(() => {
  const depth = analysis.analysis.value?.depth ?? 1;
  if (depth === 0) return "tylko wybrane";
  return depth === 1 ? "1 krok" : `${depth} kroki`;
});

/** Clicking a node names it by its id on the canvas, which for a promoted local
 * entity is the page it became rather than the analysis entry. Map it back, so
 * the details panel opens the entry the panel lists. */
function toEntityId(nodeId: string): string | undefined {
  if (analysis.entityById.value[nodeId]) return nodeId;
  return analysis.entities.value.find((e) => e.promotedNodeId === nodeId)?.id;
}

/** `reveal` is false when the selection is a side effect of adding something:
 * the entity becomes the one the relation composer starts from, but the reader
 * stays on the panel they were filling in. */
function onSelect(id: string | undefined, reveal = true) {
  const entityId = id ? toEntityId(id) : undefined;
  selectedId.value = entityId;
  selectedNodes.value = id && entityId ? [id] : [];
  if (entityId && reveal) tab.value = "details";
}

function onOpen(nodeId: string) {
  const entity = analysis.entityById.value[toEntityId(nodeId) ?? ""];
  const target = entity?.promotedNodeId ?? nodeId;
  const graphNode = graph.nodes.value[nodeId];
  if (graphNode?.analysisLocal) return;
  const type = entity?.type ?? graphNode?.entityType;
  if (!type) return;
  window.open(
    generateEntityUrl(type as never, target, graphNode?.name),
    "_blank",
  );
}

// A viewer who lands on a shared analysis has no members list until the share
// dialog is opened, and the notes panel names authors from it. One fetch on
// load is cheap and makes "kto to napisał" work straight away.
watch(
  () => analysis.analysis.value?.id,
  (id) => {
    if (id) analysis.refreshMembers().catch(() => {});
  },
  { immediate: true },
);

const shareOpen = ref(false);
const noteOpen = ref(false);
const relationSection = useTemplateRef<HTMLElement>("relationSection");

/** The note button on a node. Selecting first is what points the dialog at the
 * right entity, since it reads `selectedId`. */
function onNoteFromGraph(nodeId: string) {
  const entityId = toEntityId(nodeId);
  if (!entityId) return;
  onSelect(nodeId, false);
  noteOpen.value = true;
}

/** The relation button on a node: put it on the "kto" end of the composer and
 * show the composer, rather than making the reader find it themselves. */
async function onConnectFromGraph(nodeId: string) {
  const entityId = toEntityId(nodeId);
  if (!entityId) return;
  onSelect(nodeId, false);
  tab.value = "scene";
  await nextTick();
  relationSection.value?.scrollIntoView({ block: "center" });
}

/** The plus on a neighbour the base supplied: make it one of the entities the
 * analysis is actually about, so notes and relations can hang off it. */
async function onAddFromGraph(nodeId: string) {
  const node = graph.nodes.value[nodeId];
  if (!node?.entityType) return;
  await analysis.addEntity({
    id: nodeId,
    type: node.entityType as NodeType,
    name: node.name,
  });
  onSelect(nodeId, false);
}
</script>

<style scoped>
/* The default layout drops the page into `.v-container.fill-height`, which
   vuetify styles `display: flex; align-items: center; flex-wrap: wrap`
   (VContainer.css). A plain child of that is a flex item sized by its own
   content and centred vertically, so this view collapsed into a ~450px column
   against the left edge with the graph squeezed to ~190px of it, however wide
   the window was. `w-100` is how layouts/gray.vue defeats the horizontal half
   of the same rule; `align-self: stretch` is the vertical half, and
   `flex-basis: 100%` stops the wrap from ever putting anything beside us. */
.analysis-page {
  display: flex;
  width: 100%;
  flex: 1 1 100%;
  align-self: stretch;
  /* `--v-layout-top` is the app bar, which vuetify already pads `.v-main` by.
     The signed-in toolbar is not a layout item, so it is not in that variable
     and has to be subtracted by hand - this page is behind `middleware: auth`,
     so it is always there. Its height is `--v-toolbar-height` on the compact
     toolbar itself, which is out of reach from here, hence the constant. */
  height: calc(
    100dvh - var(--v-layout-top, 64px) - var(--analysis-toolbar, 48px)
  );
  min-height: 500px;
}

.analysis-page__graph {
  flex: 1 1 auto;
  min-width: 0;
  border-right: 1px solid rgba(0, 0, 0, 0.12);
}

/* Wide enough for a name and a relation to read on one line, but a share of the
   window rather than a fixed slab: at 420px it is a third of a laptop and a
   fifth of a desktop, and the graph is what the extra room should go to. */
.analysis-page__panel {
  flex: 0 0 clamp(360px, 28vw, 520px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.analysis-page__scroll {
  overflow-y: auto;
  flex: 1 1 auto;
}

@media (max-width: 960px) {
  .analysis-page {
    flex-direction: column;
    height: auto;
  }

  .analysis-page__graph {
    height: 55vh;
    border-right: none;
    border-bottom: 1px solid rgba(0, 0, 0, 0.12);
  }

  .analysis-page__panel {
    flex: 1 1 auto;
    max-width: none;
  }
}
</style>
