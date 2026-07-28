import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/admin/summary.get";

/** A chainable query that remembers which collection it came from and what it
 * was filtered by, so one mock can serve the five different reads the handler
 * makes without the test depending on the order they happen in. */
type Where = [unknown, string, unknown];

const results = {
  notes: [] as unknown[],
  unapprovedNodes: { count: 0, docs: [] as unknown[] },
  edgeRevisions: { count: 0, docs: [] as unknown[] },
  newFeedback: { count: 0, docs: [] as unknown[] },
  namedNodes: [] as unknown[],
};

function makeQuery(collection: string, wheres: Where[] = []) {
  const query = {
    where: (...w: Where) => makeQuery(collection, [...wheres, w]),
    select: () => query,
    orderBy: () => query,
    limit: () => query,
    count: () => ({ get: async () => ({ data: () => ({ count: total() }) }) }),
    get: async () => {
      const docs = resolve();
      return { docs, empty: docs.length === 0 };
    },
  };

  function isEdgeRevisions() {
    return collection === "revisions";
  }
  function isUnapprovedNodes() {
    return (
      collection === "nodes" &&
      wheres.some((w) => w[0] === "revisions.has_unapproved")
    );
  }
  function isNewFeedback() {
    return collection === "feedback";
  }

  function total() {
    if (isEdgeRevisions()) return results.edgeRevisions.count;
    if (isUnapprovedNodes()) return results.unapprovedNodes.count;
    if (isNewFeedback()) return results.newFeedback.count;
    throw new Error(`unexpected count() on ${collection}`);
  }
  function resolve() {
    if (collection === "notes") return results.notes;
    if (isEdgeRevisions()) return results.edgeRevisions.docs;
    if (isUnapprovedNodes()) return results.unapprovedNodes.docs;
    if (isNewFeedback()) return results.newFeedback.docs;
    // The remaining read on `nodes` resolves names for the notes sample.
    return results.namedNodes;
  }

  return query;
}

/** Documents handed back by `getAll`, keyed by the collection asked for. */
const byId: Record<string, Record<string, Record<string, unknown>>> = {
  revisions: {},
  edges: {},
  nodes: {},
};

const mockDb = {
  collection: (name: string) => ({
    ...makeQuery(name),
    doc: (id: string) => ({ id, __collection: name }),
  }),
  getAll: async (...refs: { id: string; __collection: string }[]) =>
    refs.map((ref) => doc(ref.id, byId[ref.__collection]?.[ref.id])),
};

function doc(id: string, data?: Record<string, unknown>) {
  return {
    id,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) =>
      field
        .split(".")
        .reduce<unknown>(
          (value, key) =>
            value === undefined || value === null
              ? undefined
              : (value as Record<string, unknown>)[key],
          data as unknown,
        ),
  };
}

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  FieldPath: { documentId: () => "__name__" },
}));

const mockGetUser = vi.fn();
vi.mock("../../../../server/utils/auth", () => ({
  getUser: (...args: unknown[]) => mockGetUser(...args),
}));

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});

/** A pending edge revision, as the ingest and the relation form both write it:
 * `collection: "edges"`, and `update_automatic` only when the pipeline filed
 * it. */
function edgeRevision(id: string, edgeId: string, automatic = false) {
  return doc(id, {
    node_id: edgeId,
    collection: "edges",
    status: "pending",
    update_time: "2026-08-04T00:00:00.000Z",
    update_user: "user-1",
    ...(automatic ? { update_automatic: true } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });
  results.notes = [];
  results.unapprovedNodes = { count: 0, docs: [] };
  results.edgeRevisions = { count: 0, docs: [] };
  results.newFeedback = { count: 0, docs: [] };
  results.namedNodes = [];
  byId.revisions = {};
  byId.edges = {};
  byId.nodes = {};
});

describe("GET /api/admin/summary", () => {
  it("refuses a caller who is not an admin", async () => {
    mockGetUser.mockResolvedValue({ uid: "reader-1", admin: false });
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("counts unsettled edge revisions alongside unapproved nodes", async () => {
    results.unapprovedNodes = {
      count: 3,
      docs: [
        doc("node-1", { name: "Jan Kowalski", type: "person", revisions: {} }),
      ],
    };
    results.edgeRevisions = {
      count: 2,
      docs: [edgeRevision("rev-1", "edge-1")],
    };
    byId.edges["edge-1"] = {
      source: "person-1",
      target: "teryt1465",
      type: "election",
    };
    byId.nodes["person-1"] = { name: "Jan Kowalski" };
    byId.nodes["teryt1465"] = { name: "Powiat kaliski" };

    const summary = await handler({} as never);

    // 3 nodes whose latest revision is unapproved, plus 2 edge proposals.
    expect(summary.revisions.unapproved).toBe(5);
    // Of the ones we could inspect: one node, one edge, both filed by a human.
    expect(summary.revisions.unapprovedManual).toBe(2);
    expect(summary.revisions.sample).toEqual([
      { kind: "node", id: "node-1", name: "Jan Kowalski", type: "person" },
      {
        kind: "edge",
        id: "rev-1",
        name: "Jan Kowalski → Powiat kaliski",
        type: "election",
      },
    ]);
  });

  it("leaves the pipeline's own proposals out of the manual count", async () => {
    // What the candidacy ingest files: a committee its curated table does not
    // recognise, proposed rather than applied. It belongs in
    // /admin/rewizje-krawedzi, not in the count of work a human has queued.
    results.edgeRevisions = {
      count: 40,
      docs: [
        edgeRevision("rev-auto-1", "edge-1", true),
        edgeRevision("rev-auto-2", "edge-2", true),
      ],
    };

    const summary = await handler({} as never);

    expect(summary.revisions.unapproved).toBe(40);
    expect(summary.revisions.unapprovedManual).toBe(0);
    expect(summary.revisions.sample).toEqual([]);
  });

  it("reports truncation when more edge proposals wait than it inspected", async () => {
    results.edgeRevisions = {
      count: 500,
      docs: [edgeRevision("rev-1", "edge-1")],
    };
    byId.edges["edge-1"] = { source: "a", target: "b", type: "employed" };

    const summary = await handler({} as never);

    expect(summary.revisions.truncated).toBe(true);
    expect(summary.revisions.inspected).toBe(1);
  });

  it("names an edge whose endpoints it cannot resolve by its id", async () => {
    // The edge was deleted after the proposal was filed. It is still waiting on
    // somebody, so it still counts.
    results.edgeRevisions = {
      count: 1,
      docs: [edgeRevision("rev-1", "edge-gone")],
    };

    const summary = await handler({} as never);

    expect(summary.revisions.unapprovedManual).toBe(1);
    expect(summary.revisions.sample).toEqual([
      { kind: "edge", id: "rev-1", name: "edge-gone", type: "" },
    ]);
  });

  it("gives each kind half the sample rather than letting one crowd the other", async () => {
    results.unapprovedNodes = {
      count: 10,
      docs: Array.from({ length: 10 }, (_, i) =>
        doc(`node-${i}`, { name: `Osoba ${i}`, type: "person", revisions: {} }),
      ),
    };
    results.edgeRevisions = {
      count: 6,
      docs: Array.from({ length: 6 }, (_, i) =>
        edgeRevision(`rev-${i}`, `edge-${i}`),
      ),
    };
    for (let i = 0; i < 6; i++) {
      byId.edges[`edge-${i}`] = { source: "a", target: "b", type: "employed" };
    }
    byId.nodes["a"] = { name: "A" };
    byId.nodes["b"] = { name: "B" };

    const summary = await handler({} as never);

    const kinds = summary.revisions.sample.map((item) => item.kind);
    expect(kinds).toHaveLength(8);
    expect(kinds.filter((k) => k === "node")).toHaveLength(4);
    expect(kinds.filter((k) => k === "edge")).toHaveLength(4);
  });

  it("lets one kind spread into the slots the other leaves unused", async () => {
    results.unapprovedNodes = {
      count: 10,
      docs: Array.from({ length: 10 }, (_, i) =>
        doc(`node-${i}`, { name: `Osoba ${i}`, type: "person", revisions: {} }),
      ),
    };
    results.edgeRevisions = { count: 1, docs: [edgeRevision("rev-1", "e-1")] };
    byId.edges["e-1"] = { source: "a", target: "b", type: "employed" };
    byId.nodes["a"] = { name: "A" };
    byId.nodes["b"] = { name: "B" };

    const summary = await handler({} as never);

    const kinds = summary.revisions.sample.map((item) => item.kind);
    expect(kinds.filter((k) => k === "node")).toHaveLength(7);
    expect(kinds.filter((k) => k === "edge")).toHaveLength(1);
  });
});
