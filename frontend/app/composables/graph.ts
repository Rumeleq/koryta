import type { Ref } from "vue";
import type { GraphLayout } from "~~/shared/graph/util";
import type { Node as GraphNode, NodeStats, Edge } from "~~/shared/graph/model";
import { authFetch } from "@/composables/auth";

export type GraphOptions = {
  focusNodeId: string;
  maxDepth?: number;
  filtered?: string[];
  expandedNodes?: Ref<Set<string>>;
  /** Where to get the layout, for a graph that is not one node's neighbourhood.
   * The topic view passes `/api/graph/topic/<id>`, whose response is the same
   * `GraphLayout` and needs no focus node: the relations it returns are already
   * the whole answer, so there is nothing to centre on or expand from. */
  source?: string;
};

export function useGraph(opts: GraphOptions) {
  const url = computed(() => {
    if (opts.source) return opts.source;
    let u = `/api/graph/local/${opts.focusNodeId}?distance=${opts.maxDepth ?? 1}`;
    if (opts.expandedNodes?.value && opts.expandedNodes.value.size > 0) {
      const expand = Array.from(opts.expandedNodes.value)
        .filter((id) => id !== opts.focusNodeId)
        .join(",");
      if (expand) {
        u += `&expand=${expand}`;
      }
    }
    return u;
  });

  const { data: graph } = authFetch<GraphLayout>(url, { lazy: true });

  const nodeGroupsMap = computed(() => {
    const groups = graph.value?.nodeGroups;
    if (!Array.isArray(groups)) return {};
    return groups.reduce(
      (acc, curr) => {
        acc[curr.id] = curr;
        return acc;
      },
      {} as Record<string, GraphLayout["nodeGroups"][number]>,
    );
  });

  const nodes = computed(() => graph.value?.nodes);
  const ready = computed(() => !!nodes.value);
  const edgesRaw = computed(() => graph.value?.edges);
  const edges = useEntitiesFiltering(edgesRaw);
  const nodesFiltered1 = useEntitiesFiltering(nodes);

  const interestingNodes = computed<
    Record<string, GraphNode & { stats: NodeStats }>
  >(() => {
    return Object.fromEntries(
      Object.entries(nodesFiltered1.value ?? {}).filter(([_, node]) => {
        if (!node) return false;
        // Only show circles (people), documents (articles/regions) or rects (places) with people
        if (node.type === "rect") {
          return node.stats?.people > 0;
        }
        return true;
      }),
    );
  });

  /** Whether the response is already the whole graph to draw.
   *
   * True for a focused neighbourhood, and for anything fetched from an explicit
   * `source` - the topic layout is the relations a story rests on, and there is
   * no shorter list to narrow it to. Only the caller that passes neither is
   * asking to be cut down to `filtered`. */
  const wholeLayout = computed(() => !!opts.source || !!opts.focusNodeId);

  const nodesFiltered = computed(() => {
    if (wholeLayout.value) {
      return interestingNodes.value;
    }

    return Object.fromEntries(
      Object.entries(interestingNodes.value).filter(([key, _]) =>
        (opts.filtered ?? []).includes(key),
      ),
    );
  });

  const edgesFilteredDuplicates = computed(() => {
    if (wholeLayout.value && graph.value) {
      return graph.value.edges;
    }
    return edges.value;
  });

  const edgesFiltered = computed(() => {
    if (!edgesFilteredDuplicates.value) return undefined;

    const unique = new Map<string, Edge>();
    for (const edge of edgesFilteredDuplicates.value) {
      if (edge) {
        unique.set(edge.source + edge.target + edge.type, edge);
      }
    }
    return Array.from(unique.values());
  });

  return {
    nodesFiltered,
    nodeGroupsMap,
    edgesFiltered,
    ready,
    url,
  };
}
