<template>
  <div ref="container" class="analysis-canvas">
    <v-network-graph
      v-if="ready"
      v-model:selected-nodes="selected"
      :nodes="nodes"
      :edges="edges"
      :configs="configs"
      :event-handlers="eventHandlers"
      class="analysis-canvas__graph"
    >
      <!-- v-network-graph only draws edge labels when this slot is given; the
           `edge.label` config alone renders nothing. Relations added here carry
           what somebody said about them ("szwagier", "razem w radzie"), so the
           label is most of the point of the view. -->
      <template
        #edge-label="{
          edge,
          config,
          area,
          hovered,
          selected: edgeSelected,
          scale,
        }"
      >
        <v-edge-label
          :area="area"
          :config="config"
          :text="edge.label"
          :hovered="hovered"
          :selected="edgeSelected"
          :scale="scale"
          align="center"
          vertical-align="above"
        />
      </template>
    </v-network-graph>

    <div v-else class="analysis-canvas__empty">
      <v-progress-circular indeterminate class="mr-2" />
      Ładuję graf...
    </div>

    <div v-if="ready && isEmpty" class="analysis-canvas__empty">
      <div class="text-center text-medium-emphasis pa-6">
        <v-icon :icon="mdiGraphOutline" size="48" class="mb-2" />
        <p class="text-body-1">
          Dodaj osobę albo firmę po prawej stronie, żeby zacząć.
        </p>
      </div>
    </div>

    <!-- The actions for the node that was just clicked, as plain HTML pinned to
         where the click landed rather than to the node itself.
         v-network-graph will hand out node positions through `v-model:layouts`,
         but binding it makes the force layout write back into a prop it also
         reads, which restarts the simulation on every tick - it never settles
         and the container's ResizeObserver spins. And the graph swallows the
         `click` that follows its own `pointerdown`, so SVG buttons in a custom
         layer never fire. Anchoring to the pointer sidesteps both, and a menu
         that stays put while you aim at it is easier to hit than one drifting
         with the simulation. -->
    <div
      v-if="menu"
      class="analysis-canvas__actions"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      data-testid="analysis-node-actions"
    >
      <div class="analysis-canvas__actions-name text-caption">
        {{ menu.name }}
      </div>
      <div class="d-flex ga-1">
        <v-btn
          v-for="action in actions"
          :key="action.event"
          :icon="action.icon"
          :color="action.color"
          :title="action.title"
          :data-testid="`analysis-node-action-${action.event}`"
          size="small"
          density="comfortable"
          variant="flat"
          @click="run(action.event)"
        />
      </div>
    </div>

    <div class="analysis-canvas__legend text-caption">
      <span class="mr-3">
        <span
          class="analysis-canvas__swatch analysis-canvas__swatch--interest"
        />
        w analizie
      </span>
      <span class="mr-3">
        <span class="analysis-canvas__swatch analysis-canvas__swatch--local" />
        spoza bazy
      </span>
      <span>
        <span
          class="analysis-canvas__swatch analysis-canvas__swatch--neighbour"
        />
        sąsiedzi z bazy
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import {
  mdiGraphOutline,
  mdiNotePlusOutline,
  mdiPlus,
  mdiVectorPolylinePlus,
} from "@mdi/js";
import { defineConfigs } from "v-network-graph";
import type { EventHandlers, NodeEvent } from "v-network-graph";
import { useSimulationStore } from "~/stores/simulation";
import {
  ANALYSIS_EDGE_COLOR,
  type AnalysisGraphEdge,
  type AnalysisGraphNode,
} from "~/composables/analysisGraph";

const props = defineProps<{
  nodes: Record<string, AnalysisGraphNode>;
  edges: Record<string, AnalysisGraphEdge>;
  ready: boolean;
  /** Whether to offer the actions at all - a viewer may look, not write. */
  editable?: boolean;
}>();

const emit = defineEmits<{
  (e: "select", nodeId: string | undefined): void;
  /** `open` is a double click, which goes to the node's page in the base. The
   * other three are the buttons on the menu a click raises: `note` writes down
   * what somebody said about the node, `connect` starts a relation with it on
   * one end, and `add` pulls a neighbour the base supplied into the analysis
   * proper. One signature rather than four because `run` passes the event name
   * as a value, and separate overloads leave TS unable to resolve that call. */
  (e: "open" | "note" | "connect" | "add", nodeId: string): void;
}>();

const selected = defineModel<string[]>("selectedNodes", { default: () => [] });

const isEmpty = computed(() => Object.keys(props.nodes).length === 0);

const container = useTemplateRef<HTMLElement>("container");

/** The open action menu: which node it is for, and where in the canvas it sits.
 * Null when nothing is selected. */
const menu = ref<{ nodeId: string; name: string; x: number; y: number } | null>(
  null,
);

/** What can be done with the node the menu is for.
 *
 * A neighbour the depth setting pulled in is not part of the case yet, so the
 * only thing worth offering is to make it one - notes and relations hang off
 * entities the analysis actually lists. */
const actions = computed(() => {
  const id = menu.value?.nodeId;
  if (!id) return [];

  if (!props.nodes[id]?.ofInterest) {
    return [
      {
        event: "add" as const,
        title: "Dodaj do analizy",
        icon: mdiPlus,
        color: "#2e7d32",
      },
    ];
  }

  return [
    {
      event: "note" as const,
      title: "Dodaj notatkę",
      icon: mdiNotePlusOutline,
      color: "#1976d2",
    },
    {
      event: "connect" as const,
      title: "Dodaj powiązanie",
      icon: mdiVectorPolylinePlus,
      color: ANALYSIS_EDGE_COLOR,
    },
  ];
});

/** Runs one of the buttons and closes the menu, so the next node starts clean. */
function run(event: "note" | "connect" | "add") {
  const id = menu.value?.nodeId;
  if (!id) return;
  // `add` turns a neighbour into an entity of interest, which swaps the menu's
  // buttons for the other two. Keep it open in that one case, so the obvious
  // next move - writing down what was said about it - is one more click.
  if (event !== "add") menu.value = null;
  emit(event, id);
}

const simulationStore = useSimulationStore();

/** A node the panel lists gets a ring; a neighbour the depth setting pulled in
 * is drawn plainly, so the shape of the case stays readable once the graph is
 * more base than analysis. */
const configs = reactive(
  defineConfigs<AnalysisGraphNode, AnalysisGraphEdge>({
    view: {
      autoPanAndZoomOnLoad: "fit-content",
      scalingObjects: true,
      doubleClickZoomEnabled: false,
      // An analysis starts with two or three entities sitting close together,
      // and "fit-content" will happily zoom that to ten times life size - which
      // blows the labels up to hundreds of pixels wide and pushes every node but
      // one off the canvas. Capping the zoom is what keeps a young analysis
      // readable; `fitContentMargin` keeps the outermost nodes off the edge.
      minZoomLevel: 0.1,
      maxZoomLevel: 1.5,
      fitContentMargin: "12%",
      layoutHandler: simulationStore.newForceLayout(),
    },
    node: {
      selectable: true,
      normal: {
        type: (node) => (node.type === "circle" ? "circle" : "rect"),
        radius: (node) => 14 * (node.ofInterest ? 1.25 : 1),
        width: (node) => 30 * (node.ofInterest ? 1.25 : 1),
        height: (node) => 22 * (node.ofInterest ? 1.25 : 1),
        color: (node) => node.color,
        strokeWidth: (node) => (node.ofInterest ? 3 : 0),
        strokeColor: (node) => (node.analysisLocal ? "#7a2a10" : "#1a1a1a"),
        strokeDasharray: (node) => (node.analysisLocal ? "4 2" : "0"),
      },
      hover: {
        color: (node) => node.color,
        strokeWidth: 3,
        strokeColor: "#1976d2",
      },
      selected: {
        color: (node) => node.color,
        strokeWidth: 4,
        strokeColor: "#1976d2",
      },
      label: {
        color: "#111",
        fontSize: 11,
        text: (node) => node.name,
      },
    },
    edge: {
      selectable: false,
      normal: {
        color: (edge) => (edge.analysisLocal ? ANALYSIS_EDGE_COLOR : "#9e9e9e"),
        width: (edge) => (edge.analysisLocal ? 3 : 1.5),
        // Dashed for a relation that only exists in this analysis: it has not
        // been through review, and a reader has to be able to tell it from one
        // the base is asserting.
        dasharray: (edge) => (edge.analysisLocal ? "6 3" : "0"),
      },
      label: {
        fontSize: 10,
        color: (edge) => (edge.analysisLocal ? ANALYSIS_EDGE_COLOR : "#555"),
      },
      margin: 2,
      marker: { target: { type: "arrow", width: 3, height: 3 } },
    },
  }),
);

const handleNodeClick = ({ node, event }: NodeEvent<MouseEvent>) => {
  emit("select", node);

  const box = container.value?.getBoundingClientRect();
  if (!props.editable || !box) {
    menu.value = null;
    return;
  }

  // Clamped to the canvas so a node near an edge does not put its own buttons
  // out of reach; the offsets leave room for the menu's own size.
  menu.value = {
    nodeId: node,
    name: props.nodes[node]?.name ?? "",
    x: Math.min(Math.max(event.clientX - box.left, 70), box.width - 70),
    y: Math.min(Math.max(event.clientY - box.top, 60), box.height - 20),
  };
};

const eventHandlers: EventHandlers = {
  "node:click": handleNodeClick,
  "node:dblclick": ({ node }: NodeEvent<MouseEvent>) => emit("open", node),
  // Clicking away puts the menu down, the way any popover behaves. Panning the
  // canvas counts, since the menu is pinned to the viewport rather than to the
  // node and would otherwise be left pointing at nothing.
  "view:click": () => {
    menu.value = null;
    emit("select", undefined);
  },
  "view:pan": () => {
    menu.value = null;
  },
  "view:zoom": () => {
    menu.value = null;
  },
};
</script>

<style scoped>
@import "v-network-graph/lib/style.css";

.analysis-canvas {
  position: relative;
  height: 100%;
  width: 100%;
  min-height: 400px;
}

.analysis-canvas__graph {
  height: 100%;
  width: 100%;
}

.analysis-canvas__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.analysis-canvas__legend {
  position: absolute;
  left: 8px;
  bottom: 8px;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 4px;
  padding: 4px 8px;
}

.analysis-canvas__swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  vertical-align: middle;
  margin-right: 2px;
}

.analysis-canvas__swatch--interest {
  background: #4466cc;
  border: 2px solid #1a1a1a;
}

.analysis-canvas__swatch--local {
  background: #b23c17;
  border: 2px dashed #7a2a10;
}

.analysis-canvas__swatch--neighbour {
  background: #9e9e9e;
}

.analysis-canvas__actions {
  position: absolute;
  z-index: 2;
  /* Sits just above the click, centred on it, so the node stays visible. */
  transform: translate(-50%, -100%);
  background: rgba(255, 255, 255, 0.95);
  border-radius: 6px;
  padding: 4px 6px 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  text-align: center;
  white-space: nowrap;
}

.analysis-canvas__actions-name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}
</style>
