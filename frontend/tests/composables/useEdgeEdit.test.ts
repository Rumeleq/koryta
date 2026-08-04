import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import type { Edge, Link, NodeType } from "~~/shared/model";
import { useEdgeEdit, type NodeRef } from "../../app/composables/useEdgeEdit";

const authRequest = vi.fn();
vi.mock("~/composables/auth", () => ({
  authRequest: (...args: unknown[]) => authRequest(...args),
}));

/** The node whose page the form was opened on. */
function on(type: NodeType, id: string): NodeRef {
  return { id, type, ref: ref<Link<NodeType> | undefined>(undefined) };
}

/** What `processEdge` sent, as the endpoint saw it. */
function sentBody() {
  return authRequest.mock.calls[0]![1].body;
}

describe("useEdgeEdit", () => {
  beforeEach(() => {
    authRequest.mockReset();
    authRequest.mockResolvedValue({ id: "new-edge" });
  });

  it("puts the page's person on the source end of a connection", () => {
    const { layout, edgeLabel } = useEdgeEdit({
      fixedNode: on("person", "jan"),
      edgeType: "connection",
      initialDirection: "outgoing",
    });

    expect(layout.source.id.value).toBe("jan");
    expect(layout.target.id.value).toBeUndefined();
    expect(layout.target.type.value).toBe("person");
    expect(edgeLabel.value).toBe("Powiązanie z");
  });

  it("writes a connection between two people", async () => {
    const onUpdate = vi.fn();
    const { layout, newEdge, readyToSubmit, processEdge } = useEdgeEdit({
      fixedNode: on("person", "jan"),
      edgeType: "connection",
      initialDirection: "outgoing",
      onUpdate,
    });

    expect(readyToSubmit.value).toBe(false);
    layout.target.ref.value = { type: "person", id: "anna", name: "Anna" };
    newEdge.value.name = "żona";
    expect(readyToSubmit.value).toBe(true);

    await processEdge();

    expect(authRequest).toHaveBeenCalledWith("/api/edges/create", {
      method: "POST",
      body: expect.objectContaining({
        source: "jan",
        target: "anna",
        type: "connection",
        name: "żona",
      }),
    });
    expect(onUpdate).toHaveBeenCalled();
  });

  it("writes an employment from the employee's page", async () => {
    const { layout, newEdge, processEdge } = useEdgeEdit({
      fixedNode: on("person", "jan"),
      edgeType: "employed",
      initialDirection: "outgoing",
    });

    expect(layout.target.type.value).toBe("place");
    layout.target.ref.value = { type: "place", id: "spolka", name: "Spółka" };
    newEdge.value.name = "prezes zarządu";
    newEdge.value.start_date = "2020-01-01";

    await processEdge();

    expect(sentBody()).toMatchObject({
      source: "jan",
      target: "spolka",
      type: "employed",
      name: "prezes zarządu",
      start_date: "2020-01-01",
    });
  });

  it("keeps the company as the employer when opened on its page", async () => {
    // Same relation from the other end: the page's node is the target, so the
    // person goes on the source end rather than being written as the employer.
    const { layout, processEdge } = useEdgeEdit({
      fixedNode: on("place", "spolka"),
      edgeType: "employed",
      initialDirection: "incoming",
    });

    expect(layout.target.id.value).toBe("spolka");
    expect(layout.source.id.value).toBeUndefined();
    expect(layout.source.type.value).toBe("person");

    layout.source.ref.value = { type: "person", id: "jan", name: "Jan" };
    await processEdge();

    expect(sentBody()).toMatchObject({
      source: "jan",
      target: "spolka",
      type: "employed",
    });
  });

  it("refuses to connect a node to itself", async () => {
    const { layout, isSelfEdge, readyToSubmit, processEdge } = useEdgeEdit({
      fixedNode: on("person", "jan"),
      edgeType: "connection",
      initialDirection: "outgoing",
    });

    layout.target.ref.value = { type: "person", id: "jan", name: "Jan" };

    expect(isSelfEdge.value).toBe(true);
    expect(readyToSubmit.value).toBe(false);
    await processEdge();
    expect(authRequest).not.toHaveBeenCalled();
  });

  it("attaches the article the relation was read in", async () => {
    const referenceNode: NodeRef = {
      type: "article",
      ref: ref<Link<NodeType> | undefined>({
        type: "article",
        id: "artykul",
        name: "Onet",
      }),
    };
    const { layout, processEdge } = useEdgeEdit({
      fixedNode: on("person", "jan"),
      referenceNode,
      edgeType: "connection",
      initialDirection: "outgoing",
    });

    layout.target.ref.value = { type: "person", id: "anna", name: "Anna" };
    await processEdge();

    expect(sentBody().references).toEqual(["artykul"]);
  });

  it("stores the three ownership options under the one type they share", async () => {
    const { layout, processEdge } = useEdgeEdit({
      fixedNode: on("place", "spolka"),
      edgeType: "owns_region",
      initialDirection: "incoming",
    });

    layout.source.ref.value = { type: "region", id: "teryt12", name: "Region" };
    await processEdge();

    expect(sentBody()).toMatchObject({
      source: "teryt12",
      target: "spolka",
      type: "owns",
    });
  });

  it("says what went wrong instead of reporting a write that did not happen", async () => {
    const onUpdate = vi.fn();
    authRequest.mockRejectedValueOnce({ data: { message: "Brak tokenu" } });

    const { layout, processEdge, error, saving } = useEdgeEdit({
      fixedNode: on("person", "jan"),
      edgeType: "connection",
      initialDirection: "outgoing",
      onUpdate,
    });

    layout.target.ref.value = { type: "person", id: "anna", name: "Anna" };
    await processEdge();

    expect(error.value).toBe("Brak tokenu");
    expect(saving.value).toBe(false);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  describe("availableEdgeTypes", () => {
    const cases: Array<{
      nodeType: NodeType;
      direction: "incoming" | "outgoing";
      expected: string[];
    }> = [
      {
        nodeType: "person",
        direction: "outgoing",
        expected: ["connection", "employed", "election"],
      },
      {
        nodeType: "person",
        direction: "incoming",
        expected: ["connection", "mentioned_person"],
      },
      { nodeType: "place", direction: "outgoing", expected: ["owns_child"] },
      {
        nodeType: "place",
        direction: "incoming",
        expected: [
          "employed",
          "mentioned_company",
          "owns_parent",
          "owns_region",
        ],
      },
    ];

    for (const { nodeType, direction, expected } of cases) {
      it(`lists ${expected.join(", ")} for a ${nodeType} (${direction})`, () => {
        const { availableEdgeTypes } = useEdgeEdit({
          fixedNode: on(nodeType, "node-1"),
          initialDirection: direction,
        });

        expect(availableEdgeTypes.value.map((o) => o.value).sort()).toEqual(
          [...expected].sort(),
        );
      });
    }
  });

  describe("openEditEdge", () => {
    it("puts the other end of an existing edge into the form", () => {
      const { openEditEdge, layout, newEdge } = useEdgeEdit({
        fixedNode: on("person", "jan"),
        edgeType: "connection",
      });

      openEditEdge({
        type: "connection",
        source: "jan",
        target: "anna",
        richNode: { id: "anna", type: "person", name: "Anna Nowak" },
      } as Edge);

      expect(newEdge.value.direction).toBe("outgoing");
      expect(layout.target.ref.value).toEqual({
        id: "anna",
        type: "person",
        name: "Anna Nowak",
      });
    });

    it("tells a region owner from a parent company", () => {
      const region = useEdgeEdit({
        fixedNode: on("place", "spolka"),
        edgeType: "owns_parent",
      });
      region.openEditEdge({
        type: "owns",
        source: "teryt12",
        target: "spolka",
        richNode: { id: "teryt12", type: "region", name: "Region" },
      } as Edge);
      expect(region.edgeType.value).toBe("owns_region");

      const parent = useEdgeEdit({
        fixedNode: on("place", "spolka"),
        edgeType: "owns_parent",
      });
      parent.openEditEdge({
        type: "owns",
        source: "matka",
        target: "spolka",
        richNode: { id: "matka", type: "place", name: "Matka" },
      } as Edge);
      expect(parent.edgeType.value).toBe("owns_parent");
    });
  });

  it("does not duplicate an edge it was asked to edit", async () => {
    // There is no endpoint that revises an edge, so submitting would write a
    // second copy rather than change the one on screen.
    const { layout, processEdge, error } = useEdgeEdit({
      fixedNode: on("person", "jan"),
      edgeType: "connection",
      initialDirection: "outgoing",
      editedEdge: "edge-1",
    });

    layout.target.ref.value = { type: "person", id: "anna", name: "Anna" };
    await processEdge();

    expect(authRequest).not.toHaveBeenCalled();
    expect(error.value).toContain("nie jest jeszcze możliwa");
  });
});
