import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getRevisionsForNodes,
  createRevisionTransaction,
  proposalId,
  proposeRevisionTransaction,
  sanitizeFirestoreData,
  withoutInternalFields,
} from "../../../server/utils/revisions";
import type {
  Firestore,
  WriteBatch,
  DocumentReference,
} from "firebase-admin/firestore";

vi.mock("firebase-admin/firestore", () => {
  return {
    Timestamp: {
      now: vi.fn(() => ({ toMillis: () => 1234567890 })),
    },
    // the rest are types and don't need mocking at runtime
  };
});

// Mock Firestore
const mockGet = vi.fn();
const mockWhere = vi.fn().mockReturnThis();
const mockCollection = vi.fn().mockReturnValue({
  where: mockWhere,
  get: mockGet,
  doc: vi.fn(),
});
const mockBatch = {
  set: vi.fn(),
} as unknown as WriteBatch;

const mockDb = {
  collection: mockCollection,
  batch: vi.fn().mockReturnValue(mockBatch),
} as unknown as Firestore;

describe("sanitizeFirestoreData", () => {
  it("keeps a top-level array field an array", () => {
    // The whole point: `parties` is queried with array-contains-any, which
    // matches nothing against a map and does not raise.
    expect(sanitizeFirestoreData({ parties: ["PiS", "PSL"] })).toEqual({
      parties: ["PiS", "PSL"],
    });
  });

  it("keeps an empty array an array", () => {
    // `{}` would not match the "no party" filter either, which looks for
    // `parties == []`.
    expect(sanitizeFirestoreData({ parties: [] })).toEqual({ parties: [] });
  });

  it("keeps arrays nested inside objects arrays", () => {
    expect(sanitizeFirestoreData({ note: { sources: ["a", "b"] } })).toEqual({
      note: { sources: ["a", "b"] },
    });
  });

  it("rewrites an array directly inside an array as a map", () => {
    // Firestore has no array-of-arrays, so this one really cannot be stored.
    expect(sanitizeFirestoreData({ grid: [["a", "b"], ["c"]] })).toEqual({
      grid: [{ 0: "a", 1: "b" }, { 0: "c" }],
    });
  });

  it("keeps an array of objects, including their own arrays", () => {
    expect(
      sanitizeFirestoreData({
        sources: [{ url: "u", tags: ["x"] }],
      }),
    ).toEqual({ sources: [{ url: "u", tags: ["x"] }] });
  });

  it("drops undefined and null fields", () => {
    expect(sanitizeFirestoreData({ a: 1, b: undefined, c: null })).toEqual({
      a: 1,
    });
  });

  it("drops undefined and null array elements rather than leaving holes", () => {
    // Firestore rejects an undefined element outright.
    expect(sanitizeFirestoreData({ tags: ["a", null, "b"] })).toEqual({
      tags: ["a", "b"],
    });
  });

  it("leaves primitives alone", () => {
    expect(sanitizeFirestoreData({ n: 1, s: "x", b: false })).toEqual({
      n: 1,
      s: "x",
      b: false,
    });
  });
});

/** A stand-in for a Firestore document reference. `parent` is what says which
 * collection the document is in, and the revision records it. */
function targetRefIn(collection: string, id: string) {
  return { id, parent: { id: collection } } as DocumentReference;
}

const nodeRef = (id: string) => targetRefIn("nodes", id);

describe("createRevisionTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockCollection().doc).mockReturnValue({
      id: "new-rev-id",
    } as unknown as DocumentReference);
  });

  it("should create a revision and NOT update head when updateHead=false", () => {
    const user = { uid: "test-user" };
    const targetRef = nodeRef("node-1");
    const data = { title: "New Title" };

    createRevisionTransaction(mockDb, mockBatch, user, targetRef, data);

    // Should create revision
    expect(mockCollection).toHaveBeenCalledWith("revisions");
    expect(mockBatch.set).toHaveBeenCalledTimes(2);
    // Verify first call is setting revision
    const firstCallArgs = vi.mocked(mockBatch.set).mock.calls[0];
    expect(firstCallArgs[1]).toMatchObject({
      node_id: "node-1",
      data: data,
      update_user: "test-user",
    });
    // Without approve/published the target document is just the data
    const targetData = vi.mocked(mockBatch.set).mock.calls[1][1];
    expect(targetData).toEqual(data);
  });

  it("should set revision_id on the target but not in the revision data when approving", () => {
    const user = { uid: "test-user" };
    const targetRef = nodeRef("node-1");
    const data = { title: "New Title" };

    createRevisionTransaction(
      mockDb,
      mockBatch,
      user,
      targetRef,
      data,
      false,
      true,
    );

    const revisionDoc = vi.mocked(mockBatch.set).mock.calls[0][1] as {
      data: Record<string, unknown>;
    };
    expect(revisionDoc.data).not.toHaveProperty("revision_id");

    const targetData = vi.mocked(mockBatch.set).mock.calls[1][1] as Record<
      string,
      unknown
    >;
    expect(targetData.revision_id).toEqual({ id: "new-rev-id" });
  });

  it("should write the published flag onto the target document", () => {
    const user = { uid: "test-user" };
    const targetRef = nodeRef("node-1");
    const data = { title: "New Title" };

    createRevisionTransaction(
      mockDb,
      mockBatch,
      user,
      targetRef,
      data,
      false,
      true,
      false,
    );

    const revisionDoc = vi.mocked(mockBatch.set).mock.calls[0][1] as {
      data: Record<string, unknown>;
    };
    expect(revisionDoc.data).not.toHaveProperty("published");

    const targetData = vi.mocked(mockBatch.set).mock.calls[1][1] as Record<
      string,
      unknown
    >;
    expect(targetData.published).toBe(false);
  });

  it("records which collection the revision is for", () => {
    // `node_id` holds the target's id whether the target is a node or an edge,
    // so without this a reviewer applying an edge revision writes it onto a
    // node that does not exist.
    const user = { uid: "test-user" };
    const data = { source: "node-1", target: "node-2", type: "employed" };

    createRevisionTransaction(
      mockDb,
      mockBatch,
      user,
      targetRefIn("edges", "edge-1"),
      data,
    );

    expect(vi.mocked(mockBatch.set).mock.calls[0][1]).toMatchObject({
      node_id: "edge-1",
      collection: "edges",
    });
  });
});

describe("withoutInternalFields", () => {
  it("drops the pointer to the revision the document currently says it by", () => {
    // Carrying it into a proposal would freeze a stale answer into it.
    expect(
      withoutInternalFields({
        type: "election",
        committee: "KW PiS",
        revision_id: { id: "old-rev" },
        stats: { people: 3 },
        visibility: true,
      }),
    ).toEqual({ type: "election", committee: "KW PiS" });
  });
});

describe("proposeRevisionTransaction", () => {
  const user = { uid: "test-user" };
  const targetRef = {
    id: "edge-1",
    parent: { id: "edges" },
  } as unknown as DocumentReference;
  const data = { source: "p", target: "r", type: "election", party: "PiS" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockCollection().doc).mockReturnValue({
      id: "new-rev-id",
    } as unknown as DocumentReference);
  });

  it("leaves the live document alone", () => {
    // createRevisionTransaction cannot do this: it writes the target either
    // way, so it can record a change to a document being created but cannot
    // propose one about a document that is already there.
    proposeRevisionTransaction(mockDb, mockBatch, user, targetRef, data, {
      automatic: true,
    });

    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    const [ref, written] = vi.mocked(mockBatch.set).mock.calls[0]!;
    expect(ref).not.toBe(targetRef);
    expect(written).toMatchObject({
      node_id: "edge-1",
      data,
      update_user: "test-user",
      update_automatic: true,
      status: "pending",
      collection: "edges",
    });
  });

  it("says which collection the target is in", () => {
    // `node_id` is the target's id whatever the target is, so this is the only
    // thing that makes "the pending changes to edges" a query.
    proposeRevisionTransaction(
      mockDb,
      mockBatch,
      user,
      { id: "node-1", parent: { id: "nodes" } } as unknown as DocumentReference,
      data,
    );
    expect(vi.mocked(mockBatch.set).mock.calls[0]![1]).toMatchObject({
      collection: "nodes",
    });
  });

  it("addresses a standing proposal by what it proposes", () => {
    // `committee_to_party` names about twenty-five committees, so most
    // candidacies stay pending; with a fresh id per run the pipeline would add
    // a revision per candidacy per night, forever.
    proposeRevisionTransaction(mockDb, mockBatch, user, targetRef, data);
    expect(vi.mocked(mockCollection().doc)).toHaveBeenCalledWith(
      proposalId("edge-1", data),
    );
  });
});

describe("proposalId", () => {
  it("does not depend on the order the content was assembled in", () => {
    // The proposal is built by spreading the stored edge and the payload
    // together, and property order there follows insertion.
    expect(proposalId("edge-1", { a: 1, b: 2 })).toBe(
      proposalId("edge-1", { b: 2, a: 1 }),
    );
  });

  it("keeps two different proposals about one edge apart", () => {
    expect(proposalId("edge-1", { committee: "KW PiS" })).not.toBe(
      proposalId("edge-1", { committee: "KW Nowa Lewica" }),
    );
  });

  it("keeps the same proposal about two edges apart", () => {
    expect(proposalId("edge-1", { committee: "KW PiS" })).not.toBe(
      proposalId("edge-2", { committee: "KW PiS" }),
    );
  });

  it("produces an id Firestore will accept", () => {
    const id = proposalId("edge_p_teryt1465_election_aBcDeFgHiJ", {
      committee: "KW PiS",
    });
    expect(id).not.toContain("/");
    expect(id.length).toBeLessThan(1500);
  });

  it("files one offer once, however the caller says it is worded", () => {
    // The ingest passes `edgeIdentity`, which folds the case and spacing PKW
    // varies. Without that, a re-scrape in a different case would file a second
    // proposal saying the same thing.
    expect(proposalId("edge-1", { committee: "KW PIS" }, "same-fact")).toBe(
      proposalId("edge-1", { committee: "Kw Pis" }, "same-fact"),
    );
  });
});

describe("getRevisionsForNodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty object for empty input", async () => {
    const result = await getRevisionsForNodes(mockDb, []);
    expect(result).toEqual({});
    expect(mockCollection).not.toHaveBeenCalled();
  });

  it("should fetch revisions for nodes in chunks", async () => {
    // Generate 15 IDs to force 2 chunks (since chunk size is 10)
    const ids = Array.from({ length: 15 }, (_, i) => `id-${i}`);

    mockGet
      .mockResolvedValueOnce({
        docs: [
          {
            id: "rev-1",
            data: () => ({ node_id: "id-0", title: "Rev 1" }),
          },
        ],
      })
      .mockResolvedValueOnce({
        docs: [],
      });

    const result = await getRevisionsForNodes(mockDb, ids);

    // Should call collection('revisions')
    expect(mockCollection).toHaveBeenCalledWith("revisions");

    // Should split into two calls
    expect(mockWhere).toHaveBeenCalledTimes(2);
    // First chunk
    expect(mockWhere).toHaveBeenNthCalledWith(
      1,
      "node_id",
      "in",
      ids.slice(0, 10),
    );
    // Second chunk
    expect(mockWhere).toHaveBeenNthCalledWith(
      2,
      "node_id",
      "in",
      ids.slice(10),
    );

    // Check result mapping
    expect(result["id-0"]).toHaveLength(1);
    expect(result["id-0"][0]).toEqual({
      id: "rev-1",
      node_id: "id-0",
      title: "Rev 1",
    });
    expect(result["id-1"]).toEqual([]);
  });

  it("should correctly group revisions by node_id", async () => {
    const ids = ["node-A", "node-B"];

    mockGet.mockResolvedValue({
      docs: [
        {
          id: "rev-A1",
          data: () => ({ node_id: "node-A", ver: 1 }),
        },
        {
          id: "rev-A2",
          data: () => ({ node_id: "node-A", ver: 2 }),
        },
        {
          id: "rev-B1",
          data: () => ({ node_id: "node-B", ver: 1 }),
        },
      ],
    });

    const result = await getRevisionsForNodes(mockDb, ids);

    expect(result["node-A"]).toHaveLength(2);
    expect(result["node-B"]).toHaveLength(1);
    expect(result["node-A"]).toEqual([
      { id: "rev-A1", node_id: "node-A", ver: 1 },
      { id: "rev-A2", node_id: "node-A", ver: 2 },
    ]);
  });
});
