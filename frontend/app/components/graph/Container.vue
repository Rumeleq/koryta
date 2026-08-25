<template>
  <div class="graph-panel" data-testid="graph-panel">
    <div class="graph-panel__bar">
      <ul class="graph-panel__legend">
        <li v-for="item in LEGEND" :key="item.type" class="graph-panel__key">
          <svg
            class="graph-panel__swatch"
            viewBox="-12 -12 24 24"
            width="17"
            height="17"
            aria-hidden="true"
          >
            <circle v-if="item.shape === 'circle'" r="11" :fill="item.color" />
            <rect
              v-else
              x="-11"
              y="-9"
              width="22"
              height="18"
              rx="3"
              :fill="item.color"
            />
            <path
              :d="entityGlyph(item.type)"
              :fill="readableInk(item.color)"
              transform="translate(-6.5 -6.5) scale(0.542)"
            />
          </svg>
          {{ item.label }}
        </li>
      </ul>

      <div class="graph-panel__controls">
        <v-btn
          size="small"
          variant="text"
          :icon="mdiFitToScreenOutline"
          density="comfortable"
          aria-label="Dopasuj widok"
          title="Dopasuj widok"
          @click="canvas?.fitView?.()"
        />
        <!-- Only a neighbourhood has a reach to choose. A topic's or an
             article's layout is the whole story it was asked for. -->
        <v-btn-toggle
          v-if="!source"
          v-model="depth"
          density="compact"
          variant="outlined"
          divided
          mandatory
        >
          <v-btn :value="1" size="small" text="1 krok" />
          <v-btn :value="2" size="small" text="2 kroki" />
        </v-btn-toggle>
      </div>
    </div>

    <div class="graph-panel__canvas" :style="{ height: canvasHeight }">
      <GraphCanvas
        ref="canvas"
        :nodes="nodesFiltered"
        :edges="edgesFiltered || []"
        :ready="ready"
        :focus-node-id="focusNodeId"
        @select="selectedId = $event"
      />
    </div>

    <div class="graph-panel__foot">
      <template v-if="selected">
        <span class="graph-panel__selected">{{ selected.name }}</span>
        <v-btn
          v-if="selectedHref"
          size="small"
          variant="text"
          :append-icon="mdiArrowRight"
          :to="selectedHref"
          text="Otwórz stronę"
        />
        <v-btn
          v-if="!source && !expandedNodes.has(selectedId!)"
          size="small"
          variant="text"
          :prepend-icon="mdiPlusCircleOutline"
          text="Rozwiń"
          @click="onExpandNode(selectedId!)"
        />
      </template>
      <span v-else class="graph-panel__hint">
        Najedź na węzeł, żeby podświetlić jego powiązania. Kliknij, żeby je
        przypiąć; kliknij dwa razy, żeby otworzyć stronę.
      </span>
      <v-spacer />
      <!-- What the ring left out. A graph that quietly stops at twenty eight
           names reads as the whole truth about somebody. "Podmiotów", not
           "powiązań": this counts the nodes the budget dropped, and each of
           them stood at the end of at least one relation - everywhere else on
           the site "powiązanie" is an edge. -->
      <span v-if="omitted > 0" class="graph-panel__hint">
        Pominięto {{ omitted }} dalszych podmiotów.
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import {
  mdiArrowRight,
  mdiFitToScreenOutline,
  mdiPlusCircleOutline,
} from "@mdi/js";
import { useGraph } from "~/composables/graph";
import { entityGlyph } from "~/utils/entityIcon";
import { graphNodeDestination, readableInk } from "~/utils/graphNode";
import { NODE_COLORS } from "~~/shared/graph/nodes";

const props = withDefaults(
  defineProps<{
    /** Empty when `source` supplies the whole layout, as it does for a topic. */
    focusNodeId: string;
    maxDepth?: number;
    source?: string;
    /** How tall the canvas itself is drawn - a number of pixels, or any css
     * length. The bar and the footer sit outside it, so a caller that used to
     * put a height on a wrapper is asking for less than it thinks. */
    height?: number | string;
  }>(),
  { maxDepth: 1, source: undefined, height: 520 },
);

/** What the legend explains, in the order a person page needs it. The colours
 * are the node builders' own, so a change there shows up here rather than
 * drifting quietly out of step. */
const LEGEND = [
  {
    type: "person",
    label: "Osoba",
    shape: "circle",
    color: NODE_COLORS.person,
  },
  {
    type: "place",
    label: "Instytucja",
    shape: "rect",
    color: NODE_COLORS.place,
  },
  { type: "region", label: "Region", shape: "rect", color: NODE_COLORS.region },
] as const;

/** How far out to draw, as the reader has it. Starts at whatever the page asked
 * for; a person's page asks for two, because one hop is a list of employers
 * that the rows above the graph already give in full. */
const depth = ref(props.maxDepth);

/** The canvas, for the one thing the bar asks of it. Optional at every call
 * site: the spec for this component stubs it out. */
const canvas = ref<{ fitView?: () => void } | null>(null);

const canvasHeight = computed(() =>
  typeof props.height === "number" ? `${props.height}px` : props.height,
);

const expandedNodes = ref(
  new Set<string>(props.focusNodeId ? [props.focusNodeId] : []),
);

const onExpandNode = (nodeId: string) => {
  const newSet = new Set(expandedNodes.value);
  newSet.add(nodeId);
  expandedNodes.value = newSet;
};

// Getters rather than a spread: `/graf` swaps its focus node from the query
// string without remounting this component, and a snapshot of the props would
// leave the url pointing at whichever node was first.
const { nodesFiltered, edgesFiltered, ready, omitted } = useGraph({
  get focusNodeId() {
    return props.focusNodeId;
  },
  get source() {
    return props.source;
  },
  maxDepth: depth,
  expandedNodes,
});

/** The node the reader clicked, if it is still on the canvas. Cleared by the
 * canvas itself when the selection is dropped. */
const selectedId = ref<string | undefined>(undefined);
const selected = computed(() =>
  selectedId.value ? nodesFiltered.value[selectedId.value] : undefined,
);
const selectedHref = computed(() => {
  const destination = graphNodeDestination(selected.value);
  return destination ? `/entity/${destination}/${selectedId.value}` : undefined;
});
</script>

<style scoped>
.graph-panel {
  /* `/graf` puts this straight into a `fill-height` v-container, which is a
     flex row - without a width the panel shrinks to whatever the canvas
     happened to lay out and leaves half the window empty. */
  width: 100%;
  border: 1px solid rgba(var(--v-border-color), 0.18);
  border-radius: 8px;
  overflow: hidden;
}

.graph-panel__bar,
.graph-panel__foot {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 6px 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}

.graph-panel__bar {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.18);
  justify-content: space-between;
}

.graph-panel__foot {
  border-top: 1px solid rgba(var(--v-border-color), 0.18);
  min-height: 40px;
}

.graph-panel__legend {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  list-style: none;
  padding: 0;
  margin: 0;
}

.graph-panel__key {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.78rem;
  color: rgba(var(--v-theme-on-surface), 0.72);
}

.graph-panel__swatch {
  flex: 0 0 auto;
}

.graph-panel__controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.graph-panel__canvas {
  width: 100%;
  position: relative;
  overflow: visible;
}

.graph-panel__selected {
  font-size: 0.82rem;
  font-weight: 600;
}

.graph-panel__hint {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
</style>

<style>
@import "v-network-graph/lib/style.css";
</style>
