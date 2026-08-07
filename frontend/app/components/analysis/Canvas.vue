<template>
  <div class="analysis-canvas">
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
import { computed } from "vue";
import { mdiGraphOutline } from "@mdi/js";
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
}>();

const emit = defineEmits<{
  (e: "select", nodeId: string | undefined): void;
  (e: "open", nodeId: string): void;
}>();

const selected = defineModel<string[]>("selectedNodes", { default: () => [] });

const isEmpty = computed(() => Object.keys(props.nodes).length === 0);

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

const handleNodeClick = ({ node }: NodeEvent<MouseEvent>) => {
  emit("select", node);
};

const eventHandlers: EventHandlers = {
  "node:click": handleNodeClick,
  "node:dblclick": ({ node }: NodeEvent<MouseEvent>) => emit("open", node),
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
</style>
