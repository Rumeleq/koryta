import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextTick, ref } from "vue";
import { clearNuxtData } from "#imports";
import { useAnalysisGraph } from "~/composables/analysisGraph";
import { LOCAL_ENTITY_PREFIX, type Analysis } from "~~/shared/analysis";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({ authRequest: mockAuthRequest }));

/** What the base knows: Anna works at Firma, and Firma also employs Bogdan,
 * who is nobody's entity of interest. */
const baseGraph = {
  nodes: {
    anna: { name: "Anna", type: "circle", color: "#4466cc", stats: {} },
    firma: { name: "Firma", type: "rect", color: "gray", stats: {} },
    bogdan: { name: "Bogdan", type: "circle", color: "#4466cc", stats: {} },
  },
  edges: [
    { source: "anna", target: "firma", type: "employed", label: "pracuje" },
    { source: "bogdan", target: "firma", type: "employed", label: "pracuje" },
  ],
  nodeGroups: [],
};

function analysisRef(overrides: Partial<Analysis> = {}) {
  return ref<Analysis>({
    id: "a1",
    title: "Sprawa",
    ownerUid: "owner",
    members: { owner: "editor" },
    memberUids: ["owner"],
    entities: [
      {
        id: "anna",
        type: "person",
        name: "Anna",
        addedBy: "owner",
        addedAt: "2026-08-07T10:00:00Z",
      },
      {
        id: "firma",
        type: "place",
        name: "Firma",
        addedBy: "owner",
        addedAt: "2026-08-07T10:00:00Z",
      },
    ],
    edges: [],
    notes: [],
    depth: 1,
    createdAt: "2026-08-07T10:00:00Z",
    updatedAt: "2026-08-07T10:00:00Z",
    ...overrides,
  });
}

/** useAsyncData resolves on the microtask queue; the computeds that read it
 * settle a tick later. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
}

describe("useAnalysisGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearNuxtData();
    mockAuthRequest.mockResolvedValue(baseGraph);
  });

  it("asks the base about every entity of interest at once", async () => {
    const analysis = analysisRef();
    useAnalysisGraph(analysis);
    await settle();

    expect(mockAuthRequest).toHaveBeenCalledWith(
      "/api/graph/local/anna",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ distance: 1, expand: ["firma"] }),
      }),
    );
  });

  it("marks entities of interest apart from the neighbours around them", async () => {
    const analysis = analysisRef();
    const { nodes } = useAnalysisGraph(analysis);
    await settle();

    expect(nodes.value.anna?.ofInterest).toBe(true);
    expect(nodes.value.firma?.ofInterest).toBe(true);
    // Pulled in by the depth setting, not chosen.
    expect(nodes.value.bogdan?.ofInterest).toBeFalsy();
  });

  it("drops the neighbours at depth 0, keeping the edges between the chosen", async () => {
    const analysis = analysisRef({ depth: 0 });
    const { nodes, edges } = useAnalysisGraph(analysis);
    await settle();

    // Still asks for one hop: an edge between two entities of interest only
    // appears in a response that went out at least that far.
    expect(mockAuthRequest).toHaveBeenCalledWith(
      "/api/graph/local/anna",
      expect.objectContaining({
        body: expect.objectContaining({ distance: 1 }),
      }),
    );
    expect(Object.keys(nodes.value).sort()).toEqual(["anna", "firma"]);
    expect(Object.values(edges.value)).toHaveLength(1);
    expect(Object.values(edges.value)[0]).toMatchObject({
      source: "anna",
      target: "firma",
    });
  });

  it("draws entities that exist only in the analysis", async () => {
    const localId = `${LOCAL_ENTITY_PREFIX}1`;
    const analysis = analysisRef({
      entities: [
        {
          id: localId,
          type: "person",
          name: "Kuzyn",
          addedBy: "owner",
          addedAt: "2026-08-07T10:00:00Z",
        },
      ],
    });
    const { nodes } = useAnalysisGraph(analysis);
    await settle();

    // Nothing to ask the base about, so no request goes out at all.
    expect(mockAuthRequest).not.toHaveBeenCalled();
    expect(nodes.value[localId]).toMatchObject({
      name: "Kuzyn",
      type: "circle",
      analysisLocal: true,
      ofInterest: true,
    });
  });

  it("keeps a relation added here, labelled and marked as local", async () => {
    const analysis = analysisRef({
      edges: [
        {
          id: "e1",
          source: "anna",
          target: "firma",
          type: "connection",
          name: "szwagier",
          content: "tak twierdzi rozmówca",
          addedBy: "owner",
          addedAt: "2026-08-07T10:00:00Z",
        },
      ],
    });
    const { edges } = useAnalysisGraph(analysis);
    await settle();

    expect(edges.value["analysis:e1"]).toMatchObject({
      source: "anna",
      target: "firma",
      label: "szwagier",
      analysisLocal: true,
      analysisEdgeId: "e1",
    });
    // The base's own edge is still there, and told apart from it.
    expect(edges.value["base:anna:firma:employed"]?.analysisLocal).toBeFalsy();
  });

  it("falls back to the relation type when it was given no name", async () => {
    const analysis = analysisRef({
      edges: [
        {
          id: "e2",
          source: "anna",
          target: "firma",
          type: "employed",
          addedBy: "owner",
          addedAt: "2026-08-07T10:00:00Z",
        },
      ],
    });
    const { edges } = useAnalysisGraph(analysis);
    await settle();

    expect(edges.value["analysis:e2"]?.label).toBe("Zatrudniony/a w");
  });

  it("draws a promoted local entity as the page it became", async () => {
    const localId = `${LOCAL_ENTITY_PREFIX}2`;
    const analysis = analysisRef({
      entities: [
        {
          id: localId,
          type: "person",
          name: "Anna",
          promotedNodeId: "anna",
          addedBy: "owner",
          addedAt: "2026-08-07T10:00:00Z",
        },
        {
          id: "firma",
          type: "place",
          name: "Firma",
          addedBy: "owner",
          addedAt: "2026-08-07T10:00:00Z",
        },
      ],
      edges: [
        {
          id: "e3",
          source: localId,
          target: "firma",
          type: "connection",
          addedBy: "owner",
          addedAt: "2026-08-07T10:00:00Z",
        },
      ],
    });
    const { nodes, edges } = useAnalysisGraph(analysis);
    await settle();

    // The base is asked about the promoted id, and the local placeholder is not
    // drawn a second time beside it.
    expect(mockAuthRequest).toHaveBeenCalledWith(
      "/api/graph/local/anna",
      expect.anything(),
    );
    expect(nodes.value[localId]).toBeUndefined();
    expect(nodes.value.anna?.ofInterest).toBe(true);
    // The relation follows it across rather than dangling off a missing node.
    expect(edges.value["analysis:e3"]).toMatchObject({
      source: "anna",
      target: "firma",
    });
  });

  it("drops a relation whose other end is not on the canvas", async () => {
    const analysis = analysisRef({
      depth: 0,
      edges: [
        {
          id: "e4",
          source: "anna",
          target: "bogdan",
          type: "connection",
          addedBy: "owner",
          addedAt: "2026-08-07T10:00:00Z",
        },
      ],
    });
    const { edges } = useAnalysisGraph(analysis);
    await settle();

    expect(edges.value["analysis:e4"]).toBeUndefined();
  });
});
