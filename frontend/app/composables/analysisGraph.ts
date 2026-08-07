import { computed, ref, watch, type Ref } from "vue";
import type { GraphLayout } from "~~/shared/graph/util";
import type {
  Node as GraphNode,
  Edge as GraphEdge,
} from "~~/shared/graph/model";
import type { NodeType } from "~~/shared/model";
import type { Analysis, AnalysisEntity } from "~~/shared/analysis";
import { isLocalEntityId } from "~~/shared/analysis";
import { authRequest } from "./auth";
import { edgeTypeLabels } from "./edges";

/** What a node of each kind is drawn as. Mirrors shared/graph/nodes.ts, which
 * the server applies to everything it returns; this is the same mapping for the
 * entities the server has never heard of. */
const shapeForType: Record<NodeType, GraphNode["type"]> = {
  person: "circle",
  place: "rect",
  article: "document",
  region: "document",
};

/** Local entities are drawn in one colour whatever they are, because "this is
 * not in the base yet" is the thing a reader needs to see about them. */
const LOCAL_COLOR = "#b23c17";

/** How a relation asserted inside the analysis is drawn, as against one that
 * came out of the base. */
export const ANALYSIS_EDGE_COLOR = "#b23c17";

export type AnalysisGraphNode = GraphNode & {
  /** Whether this node only exists inside the analysis. */
  analysisLocal?: boolean;
  /** Whether it is one of the entities of interest, rather than a neighbour
   * pulled in by the depth setting. */
  ofInterest?: boolean;
};

export type AnalysisGraphEdge = GraphEdge & {
  /** Whether the relation was asserted here rather than read from the base. */
  analysisLocal?: boolean;
  /** The analysis edge id, for the panel to delete or promote it. */
  analysisEdgeId?: string;
};

function emptyLayout(): GraphLayout {
  return { nodes: {}, edges: [], nodeGroups: [] };
}

function localNode(entity: AnalysisEntity): AnalysisGraphNode {
  return {
    name: entity.name,
    type: shapeForType[entity.type],
    color: LOCAL_COLOR,
    entityType: entity.type,
    visibility: true,
    analysisLocal: true,
    ofInterest: true,
  };
}

/** The picture the analysis draws: its entities of interest, whatever the base
 * knows around them, and the relations added here on top.
 *
 * The neighbourhood comes from /api/graph/local, which already takes several
 * focus ids - it BFSes out of all of them at once - so the whole expansion is
 * one request whatever the panel lists. Depth 0 still asks for distance 1,
 * because the edges *between* two entities of interest are only in a response
 * that went out at least one hop; the extra nodes are then dropped here.
 */
export function useAnalysisGraph(analysis: Ref<Analysis | null | undefined>) {
  const entities = computed<AnalysisEntity[]>(
    () => analysis.value?.entities ?? [],
  );

  /** Ids to ask the base about: entities that live there, plus the pages local
   * entities have since been promoted to. */
  const baseIds = computed(() => {
    const ids = new Set<string>();
    for (const entity of entities.value) {
      if (!isLocalEntityId(entity.id)) ids.add(entity.id);
      else if (entity.promotedNodeId) ids.add(entity.promotedNodeId);
    }
    return Array.from(ids).sort();
  });

  const depth = computed(() => analysis.value?.depth ?? 1);

  const base = ref<GraphLayout>(emptyLayout());
  const pending = ref(false);

  /** What the answer would be for, so that adding a note - which changes the
   * analysis document, and with it `entities`'s identity - does not refetch the
   * whole neighbourhood. */
  const requestKey = computed(
    () => `${depth.value}|${baseIds.value.join(",")}`,
  );

  /** Deliberately a plain ref rather than `useAsyncData`: its cache is keyed by
   * a string fixed at setup, so two analyses opened in one session would share
   * an entry and each would flash the other's graph before its own arrived.
   * The page is `ssr: false`, so there is no payload to hand over either. */
  let latestRequest = 0;

  async function refresh() {
    if (import.meta.server) return;
    const ids = baseIds.value;
    const request = ++latestRequest;

    if (ids.length === 0) {
      base.value = emptyLayout();
      pending.value = false;
      return;
    }

    pending.value = true;
    try {
      const result = await authRequest<GraphLayout>(
        `/api/graph/local/${ids[0]}`,
        {
          method: "POST",
          body: {
            distance: Math.max(1, depth.value),
            expand: ids.slice(1),
            latest: true,
          },
        },
      );
      // Removing two entities in quick succession leaves two requests in
      // flight, and the first can answer last. Only the newest may win.
      if (request === latestRequest) base.value = result;
    } finally {
      if (request === latestRequest) pending.value = false;
    }
  }

  watch(requestKey, () => refresh(), { immediate: true });

  /** Base node ids that count as "of interest" - a promoted local entity is
   * represented by the page it became. */
  const interestBaseIds = computed(() => new Set(baseIds.value));

  const nodes = computed<Record<string, AnalysisGraphNode>>(() => {
    const result: Record<string, AnalysisGraphNode> = {};

    for (const [id, node] of Object.entries(base.value.nodes)) {
      result[id] = { ...node, ofInterest: interestBaseIds.value.has(id) };
    }

    for (const entity of entities.value) {
      if (!isLocalEntityId(entity.id)) continue;
      // A promoted entity is drawn as the page it became, so that the base's
      // own edges reach it; the local id stays only as a label fallback for
      // the moment before the node document is readable.
      if (entity.promotedNodeId && result[entity.promotedNodeId]) continue;
      result[entity.id] = localNode(entity);
    }

    if (depth.value === 0) {
      return Object.fromEntries(
        Object.entries(result).filter(([, node]) => node.ofInterest),
      );
    }
    return result;
  });

  /** Where an analysis edge's end actually sits on the canvas. */
  function resolveEnd(id: string): string {
    const entity = entities.value.find((e) => e.id === id);
    if (entity?.promotedNodeId && nodes.value[entity.promotedNodeId]) {
      return entity.promotedNodeId;
    }
    return id;
  }

  const edges = computed<Record<string, AnalysisGraphEdge>>(() => {
    const result: Record<string, AnalysisGraphEdge> = {};

    for (const edge of base.value.edges) {
      if (!nodes.value[edge.source] || !nodes.value[edge.target]) continue;
      // Several relations of the same kind between the same pair draw on top of
      // each other, so the base's duplicates are collapsed as they are in
      // composables/graph.ts.
      result[`base:${edge.source}:${edge.target}:${edge.type}`] = { ...edge };
    }

    for (const edge of analysis.value?.edges ?? []) {
      const source = resolveEnd(edge.source);
      const target = resolveEnd(edge.target);
      if (!nodes.value[source] || !nodes.value[target]) continue;
      result[`analysis:${edge.id}`] = {
        source,
        target,
        type: edge.type,
        label: edge.name || edgeTypeLabels[edge.type] || edge.type,
        content: edge.content,
        analysisLocal: true,
        analysisEdgeId: edge.id,
      };
    }

    return result;
  });

  const ready = computed(() => !pending.value || baseIds.value.length === 0);

  return { nodes, edges, ready, pending, refresh };
}
