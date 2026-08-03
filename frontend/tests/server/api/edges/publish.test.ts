import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAdmin } from "../../../../server/utils/auth";
import handler from "../../../../server/api/edges/publish.post";

const mockBatchUpdate = vi.fn();
const mockBatchSet = vi.fn();
const mockCommit = vi.fn();

let stored: Record<string, Record<string, unknown> | undefined> = {};

function docRef(collection: string, id: string) {
  return {
    id,
    path: `${collection}/${id}`,
    parent: { id: collection },
    get: vi.fn(async () => ({
      id,
      exists: stored[`${collection}/${id}`] !== undefined,
      data: () => stored[`${collection}/${id}`],
    })),
  };
}

/** Every document of one collection matching an equality filter. `stored` is
 * keyed by path, which is what the rest of the fake reads. */
function queryCollection(
  collection: string,
  field: string,
  value: unknown,
): { id: string; data: () => Record<string, unknown> }[] {
  return Object.entries(stored)
    .filter(([path]) => path.startsWith(`${collection}/`))
    .filter(([, data]) => data?.[field] === value)
    .map(([path, data]) => ({
      id: path.slice(collection.length + 1),
      data: () => data as Record<string, unknown>,
    }));
}

/** Records every equality query, so a test can say one was never run. */
const mockWhere = vi.fn();

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) => docRef(collection, id ?? "generated-id")),
    where: vi.fn((field: string, _op: string, value: unknown) => {
      mockWhere(collection, field, value);
      return {
        get: vi.fn(async () => {
          const docs = queryCollection(collection, field, value);
          return { docs, size: docs.length, empty: docs.length === 0 };
        }),
      };
    }),
  })),
  // The endpoint reads the edges, and then every node they touch, in multi-gets
  // rather than one `get` each.
  getAll: vi.fn(async (...refs: { id: string; path: string }[]) =>
    refs.map((ref) => ({
      id: ref.id,
      exists: stored[ref.path] !== undefined,
      data: () => stored[ref.path],
    })),
  ),
  batch: vi.fn(() => ({
    update: (ref: { path: string }, data: unknown) =>
      mockBatchUpdate(ref.path, data),
    set: (ref: { path: string }, data: unknown) => mockBatchSet(ref.path, data),
    commit: mockCommit,
  })),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  // `revisionTime` narrows `update_time` with `instanceof Timestamp`, so the
  // mocked module still has to export something constructible.
  Timestamp: class {
    toMillis() {
      return 0;
    }
    static now() {
      return new this();
    }
  },
  FieldValue: { delete: () => "deleted" },
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ uid: "admin-uid", admin: true }),
}));

const { mockReadValidatedBody } = vi.hoisted(() => {
  const mockReadValidatedBody = vi.fn();
  globalThis.readValidatedBody = mockReadValidatedBody;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.useStorage = () => ({ clear: vi.fn() });
  return { mockReadValidatedBody };
});

/** Makes the next request ask for `published` on `edge_ids`.
 *
 * Nitro answers a schema failure with its own 400 before the handler body
 * runs, so the stub turns a ZodError into that rather than a 500.
 */
function request(body: Record<string, unknown>) {
  mockReadValidatedBody.mockImplementation(
    async (_event: unknown, parse: (b: unknown) => unknown) => {
      try {
        return parse(body);
      } catch {
        throw { statusCode: 400, statusMessage: "Bad Request" };
      }
    },
  );
}

/** A node that is live, unless told otherwise. */
function node(name: string, published = true) {
  return { name, type: "person", published, revision_id: "revisions/r" };
}

/** The usual case: one edge between two published pages. */
function seedPublishableEdge() {
  stored["nodes/a"] = node("Anna Nowak");
  stored["nodes/b"] = node("Orlen");
  stored["edges/e1"] = { source: "a", target: "b", type: "connection" };
}

/** What the batch wrote to the edge document. */
function edgeUpdate(id = "e1") {
  return mockBatchUpdate.mock.calls.find(
    (call) => call[0] === `edges/${id}`,
  )?.[1];
}

/** The audit entries the batch filed, in order. */
function auditEntries() {
  return mockBatchSet.mock.calls
    .filter((call) => String(call[0]).startsWith("audit/"))
    .map((call) => call[1] as Record<string, unknown>);
}

describe("api/edges/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = {};
    request({ edge_ids: ["e1"], published: true });
  });

  it("publishes a relation whose pages are both live", async () => {
    seedPublishableEdge();

    const result = await handler({} as never);

    expect(edgeUpdate()).toMatchObject({ published: true });
    expect(mockCommit).toHaveBeenCalled();
    expect(result).toMatchObject({ published: true, edge_ids: ["e1"] });
  });

  it("settles the relation's outstanding proposal in the same commit", async () => {
    // Publishing a relation is the review of it. Leaving the revision pending
    // would keep the queue showing work on an edge that is already live.
    seedPublishableEdge();
    stored["revisions/rev-1"] = {
      node_id: "e1",
      collection: "edges",
      status: "pending",
      update_time: "2026-01-01T00:00:00.000Z",
      data: { source: "a", target: "b" },
    };

    const result = await handler({} as never);

    expect(mockBatchUpdate).toHaveBeenCalledWith(
      "revisions/rev-1",
      expect.objectContaining({
        status: "approved",
        review_user: "admin-uid",
      }),
    );
    expect(edgeUpdate()).toMatchObject({
      published: true,
      revision_id: expect.objectContaining({ id: "rev-1" }),
    });
    expect(result).toMatchObject({ approved: ["rev-1"] });
  });

  it("approves the newest proposal when several are waiting", async () => {
    seedPublishableEdge();
    stored["revisions/old"] = {
      node_id: "e1",
      status: "pending",
      update_time: "2025-01-01T00:00:00.000Z",
      data: {},
    };
    stored["revisions/new"] = {
      node_id: "e1",
      status: "pending",
      update_time: "2026-06-01T00:00:00.000Z",
      data: {},
    };

    const result = await handler({} as never);

    expect(result).toMatchObject({ approved: ["new"] });
    expect(mockBatchUpdate).not.toHaveBeenCalledWith(
      "revisions/old",
      expect.anything(),
    );
  });

  it("leaves a relation that already has an approved revision alone", async () => {
    // Its content was settled by whoever approved that revision; this call is
    // only about who may see it.
    seedPublishableEdge();
    stored["edges/e1"] = {
      source: "a",
      target: "b",
      type: "connection",
      revision_id: { path: "revisions/done" },
    };
    stored["revisions/rev-1"] = {
      node_id: "e1",
      status: "pending",
      update_time: "2026-01-01T00:00:00.000Z",
      data: {},
    };

    const result = await handler({} as never);

    expect(edgeUpdate()).toEqual({ published: true });
    expect(result).toMatchObject({ approved: [] });
  });

  it("publishes a relation that predates the revision machinery", async () => {
    // Ingested edges were written straight into the collection. Refusing them
    // for want of a proposal would hide relations nobody ever proposed.
    seedPublishableEdge();

    const result = await handler({} as never);

    expect(edgeUpdate()).toEqual({ published: true });
    expect(result).toMatchObject({ published: true, approved: [] });
  });

  it("refuses the whole request when one relation's other page is a draft", async () => {
    // All or nothing: a partial success leaves the reviewer reading ids to work
    // out what happened, and the form has already filtered these out.
    seedPublishableEdge();
    stored["nodes/c"] = node("Jan Kowalski", false);
    stored["edges/e2"] = { source: "a", target: "c", type: "connection" };
    request({ edge_ids: ["e1", "e2"], published: true });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("names the page that is holding a relation back", async () => {
    stored["nodes/a"] = node("Anna Nowak");
    stored["nodes/c"] = node("Jan Kowalski", false);
    stored["edges/e1"] = { source: "a", target: "c", type: "connection" };

    await expect(handler({} as never)).rejects.toMatchObject({
      message: expect.stringContaining("Jan Kowalski"),
    });
  });

  it("refuses a relation pointing at a page that was never created", async () => {
    stored["nodes/a"] = node("Anna Nowak");
    stored["edges/e1"] = { source: "a", target: "ghost", type: "connection" };

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("refuses to publish a relation somebody deleted", async () => {
    seedPublishableEdge();
    stored["edges/e1"] = {
      source: "a",
      target: "b",
      type: "connection",
      deleted: true,
    };

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("names the ids it could not find", async () => {
    seedPublishableEdge();
    request({ edge_ids: ["e1", "missing"], published: true });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringContaining("missing"),
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("hides a relation without asking anything about its pages", async () => {
    // Taking a relation off the site can never break the rule, so an
    // unpublished endpoint is no reason to refuse - it is the reason to accept.
    stored["nodes/c"] = node("Jan Kowalski", false);
    stored["edges/e1"] = {
      source: "c",
      target: "c",
      type: "connection",
      published: true,
    };
    request({ edge_ids: ["e1"], published: false });

    const result = await handler({} as never);

    expect(edgeUpdate()).toEqual({ published: false });
    expect(result).toMatchObject({ published: false, approved: [] });
    expect(mockDb.getAll).toHaveBeenCalledTimes(1); // the edges, not the nodes
  });

  it("leaves the proposal alone when hiding", async () => {
    // Hiding a relation says nothing about whether the claim was right.
    stored["edges/e1"] = { source: "a", target: "b", published: true };
    stored["revisions/rev-1"] = {
      node_id: "e1",
      status: "pending",
      update_time: "2026-01-01T00:00:00.000Z",
      data: {},
    };
    request({ edge_ids: ["e1"], published: false });

    await handler({} as never);

    expect(mockBatchUpdate).not.toHaveBeenCalledWith(
      "revisions/rev-1",
      expect.anything(),
    );
    expect(mockWhere).not.toHaveBeenCalledWith("revisions", "node_id", "e1");
  });

  it("files the decision against the edges collection", async () => {
    seedPublishableEdge();

    await handler({} as never);

    expect(auditEntries()).toContainEqual(
      expect.objectContaining({
        action: "publish",
        collection: "edges",
        target_id: "e1",
        user: "admin-uid",
      }),
    );
  });

  it("files hiding a relation as its own action", async () => {
    stored["edges/e1"] = { source: "a", target: "b", published: true };
    request({ edge_ids: ["e1"], published: false });

    await handler({} as never);

    expect(auditEntries()).toContainEqual(
      expect.objectContaining({ action: "unpublish", collection: "edges" }),
    );
  });

  it("files the approval it made on the way, alongside the publication", async () => {
    seedPublishableEdge();
    stored["revisions/rev-1"] = {
      node_id: "e1",
      status: "pending",
      update_time: "2026-01-01T00:00:00.000Z",
      data: {},
    };

    await handler({} as never);

    const actions = auditEntries().map((entry) => entry.action);
    expect(actions).toContain("approve");
    expect(actions).toContain("publish");
  });

  it("asks about each relation once, however many times it was listed", async () => {
    seedPublishableEdge();
    request({ edge_ids: ["e1", "e1", "e1"], published: true });

    const result = await handler({} as never);

    expect(result).toMatchObject({ edge_ids: ["e1"] });
    expect(
      mockBatchUpdate.mock.calls.filter((call) => call[0] === "edges/e1"),
    ).toHaveLength(1);
  });

  it("refuses a request too large to commit in one batch", async () => {
    // The cap is the batch size, so a request either fits or is refused -
    // never half-applied.
    request({
      edge_ids: Array.from({ length: 101 }, (_, i) => `e${i}`),
      published: true,
    });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("insists on at least one relation", async () => {
    request({ edge_ids: [], published: true });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("is refused to everyone but an admin", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce({ statusCode: 403 });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });
});
