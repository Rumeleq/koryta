import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, h, ref, watchEffect } from "vue";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { useGraph } from "~/composables/graph";
import { clearNuxtData } from "#imports";

const mockEdges = ref([
  { source: "A", target: "C" }, // A-C
  { source: "C", target: "D" }, // C-D
  { source: "D", target: "E" }, // D-E
]);

const mockNodes = ref({
  A: { type: "circle", stats: { people: 1 } },
  B: { type: "circle", stats: { people: 1 } },
  C: { type: "circle", stats: { people: 1 } },
  D: { type: "circle", stats: { people: 1 } },
  E: { type: "circle", stats: { people: 1 } },
});

// We must override $fetch locally
global.$fetch = vi.fn(() => ({
  nodes: mockNodes.value,
  edges: mockEdges.value,
  nodeGroups: [],
})) as any;

describe("useGraph node expansion", () => {
  beforeEach(() => {
    // try specifically clearing $fetch
    (global.$fetch as any).mockClear();
    vi.clearAllMocks();
    clearNuxtData();
  });

  it("should evaluate local endpoint correctly based on single expanded node", async () => {
    // 1. Single node focus
    const expandedNodes = ref(new Set(["A"]));
    const { url } = useGraph({
      focusNodeId: "A",
      expandedNodes,
    } as any);

    expect(url.value).toBe("/api/graph/local/A?distance=1");
  });

  it("should evaluate local endpoint correctly based on multiple expanded nodes", async () => {
    // 2. Multiple expanded nodes focus
    const expandedNodes2 = ref(new Set(["A", "C", "D"]));
    const { url } = useGraph({
      focusNodeId: "A",
      expandedNodes: expandedNodes2,
    } as any);

    expect(url.value).toBe("/api/graph/local/A?distance=1&expand=C,D");
  });
});

describe("useGraph with an explicit source", () => {
  // `useFetch` goes through the nitro handler rather than the `$fetch` stub the
  // url tests above use, so the layout has to be served rather than mocked.
  const layout = {
    nodes: mockNodes.value,
    edges: mockEdges.value,
    nodeGroups: [],
  };
  registerEndpoint("/api/graph/topic/t1", () => layout);
  registerEndpoint("/api/graph/local/", () => layout);

  beforeEach(() => {
    (global.$fetch as any).mockClear();
    vi.clearAllMocks();
    clearNuxtData();
  });

  it("asks the source it was given, ignoring the focus machinery", async () => {
    const { url } = useGraph({ source: "/api/graph/topic/t1" } as any);

    expect(url.value).toBe("/api/graph/topic/t1");
  });

  /** `useGraph` calls `useFetch`, which only resolves inside a component's
   * setup - which is why the tests above assert on `url` alone. Anything that
   * reads the layout has to be mounted. */
  async function layoutFrom(opts: Record<string, unknown>) {
    const seen: { nodes: string[]; edges: number; ready: boolean } = {
      nodes: [],
      edges: 0,
      ready: false,
    };
    await mountSuspended(
      defineComponent({
        setup() {
          const { nodesFiltered, edgesFiltered, ready } = useGraph(opts as any);
          watchEffect(() => {
            seen.ready = ready.value;
            seen.nodes = Object.keys(nodesFiltered.value ?? {}).sort();
            seen.edges = (edgesFiltered.value ?? []).length;
          });
          return () => h("div");
        },
      }),
    );
    // `useGraph` fetches lazily, so suspense resolves before the layout does.
    await vi.waitFor(() => expect(seen.ready).toBe(true));
    return seen;
  }

  it("draws the whole layout, not an empty `filtered` list", async () => {
    // The trap this guards. `nodesFiltered` and `edgesFiltered` both used to
    // branch on `focusNodeId` alone, and a topic graph has no focus node - the
    // relations returned are already the whole answer. Without `source`
    // counting as "whole layout" the page rendered an empty canvas rather than
    // failing, which is the kind of bug nobody reports as a bug.
    const seen = await layoutFrom({ source: "/api/graph/topic/t1" });

    expect(seen.nodes).toEqual(["A", "B", "C", "D", "E"]);
    expect(seen.edges).toBe(3);
  });

  it("still narrows to `filtered` when there is neither source nor focus", async () => {
    const seen = await layoutFrom({ focusNodeId: "", filtered: ["A", "C"] });

    expect(seen.nodes).toEqual(["A", "C"]);
  });

  it("drops an edge whose other end was filtered out", async () => {
    // A company nobody in the layout works at is dropped by `interestingNodes`,
    // and two hops out that happens for real - a colleague's other employer
    // arrives with only that colleague on it. The edge to it has nothing left
    // to join, and the canvas looks a node's position up by id: a dangling one
    // is a line drawn to the origin.
    const withOrphan = {
      ...mockNodes.value,
      F: { type: "rect", stats: { people: 0 } },
    };
    registerEndpoint("/api/graph/topic/orphan", () => ({
      nodes: withOrphan,
      edges: [...mockEdges.value, { source: "E", target: "F" }],
      nodeGroups: [],
    }));

    const seen = await layoutFrom({ source: "/api/graph/topic/orphan" });

    expect(seen.nodes).not.toContain("F");
    expect(seen.edges).toBe(3);
  });
});
