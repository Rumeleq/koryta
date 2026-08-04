import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAdmin } from "../../../../server/utils/auth";
import handler from "../../../../server/api/nodes/publish.post";

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
      exists: stored[`${collection}/${id}`] !== undefined,
      data: () => stored[`${collection}/${id}`],
    })),
  };
}

/** Every document of one collection, for the equality queries the cascade
 * runs. `stored` is keyed by path, which is what the rest of the fake reads. */
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

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) => docRef(collection, id ?? "generated-id")),
    where: vi.fn((field: string, _op: string, value: unknown) => ({
      get: vi.fn(async () => {
        const docs = queryCollection(collection, field, value);
        return { docs, size: docs.length, empty: docs.length === 0 };
      }),
    })),
  })),
  batch: vi.fn(() => ({
    update: (ref: { path: string }, data: unknown) =>
      mockBatchUpdate(ref.path, data),
    set: (ref: { path: string }, data: unknown) => mockBatchSet(ref.path, data),
    commit: mockCommit,
  })),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
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
  return { mockReadValidatedBody };
});

/** Makes the next request ask for `published` on node-1. */
function requestPublished(published: boolean) {
  mockReadValidatedBody.mockImplementation(async (_e, parse) =>
    parse({ node_id: "node-1", published }),
  );
}

describe("api/nodes/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = {};
    requestPublished(true);
  });

  it("publishes a node that has an approved revision", async () => {
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };

    const result = await handler({} as never);

    expect(mockBatchUpdate).toHaveBeenCalledWith("nodes/node-1", {
      published: true,
    });
    expect(mockCommit).toHaveBeenCalled();
    expect(result).toEqual({ id: "node-1", published: true, hiddenEdges: [] });
  });

  it("files who published it, in the same commit as the change", async () => {
    // The node keeps only the answer. Without the log there is nothing to read
    // back when two admins disagree about whether a page should be live.
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };

    await handler({} as never);

    expect(mockBatchSet).toHaveBeenCalledWith(
      "audit/generated-id",
      expect.objectContaining({
        action: "publish",
        collection: "nodes",
        target_id: "node-1",
        user: "admin-uid",
      }),
    );
    // One batch, so a node cannot end up published with nobody named for it
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it("records hiding a page as its own action", async () => {
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };
    requestPublished(false);

    await handler({} as never);

    expect(mockBatchSet).toHaveBeenCalledWith(
      "audit/generated-id",
      expect.objectContaining({ action: "unpublish", user: "admin-uid" }),
    );
  });

  it("stamps the entry with a time", async () => {
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };

    await handler({} as never);

    const entry = mockBatchSet.mock.calls[0]?.[1] as { at: string };
    expect(Number.isNaN(Date.parse(entry.at))).toBe(false);
  });

  it("refuses to hide a node that does not exist", async () => {
    requestPublished(false);

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("refuses to publish a page with nothing approved to show", async () => {
    // Publishing is about who may see the page, not about what it says - and
    // an unapproved node has no snapshot anybody has agreed to serve.
    stored["nodes/node-1"] = { name: "X" };

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("takes the page's published relations down with it", async () => {
    // No edge may be live unless both its pages are, so hiding one of them has
    // to hide the relations that lean on it - otherwise republishing the page
    // months later brings back claims nobody looked at again.
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };
    stored["edges/e-out"] = {
      source: "node-1",
      target: "node-2",
      published: true,
    };
    stored["edges/e-in"] = {
      source: "node-3",
      target: "node-1",
      published: true,
    };
    requestPublished(false);

    const result = await handler({} as never);

    expect(mockBatchUpdate).toHaveBeenCalledWith("edges/e-out", {
      published: false,
    });
    expect(mockBatchUpdate).toHaveBeenCalledWith("edges/e-in", {
      published: false,
    });
    expect(result).toMatchObject({
      published: false,
      hiddenEdges: expect.arrayContaining(["e-out", "e-in"]),
    });
  });

  it("hides the relations before the page, so the rule holds throughout", async () => {
    // Either order ends in the same place, but only this one has no moment
    // where a published edge hangs off a hidden page.
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      published: true,
    };
    requestPublished(false);

    await handler({} as never);

    const paths = mockBatchUpdate.mock.calls.map((call) => call[0]);
    expect(paths.indexOf("edges/e-1")).toBeLessThan(
      paths.indexOf("nodes/node-1"),
    );
  });

  it("leaves relations that were already hidden alone", async () => {
    // Rewriting them would cost a write and fire onEdgeWritten for nothing.
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };
    stored["edges/e-hidden"] = { source: "node-1", target: "node-2" };
    stored["edges/e-false"] = {
      source: "node-1",
      target: "node-2",
      published: false,
    };
    requestPublished(false);

    const result = await handler({} as never);

    expect(mockBatchUpdate).not.toHaveBeenCalledWith(
      "edges/e-hidden",
      expect.anything(),
    );
    expect(result).toMatchObject({ hiddenEdges: [] });
  });

  it("does not touch relations when a page goes live", async () => {
    // Publishing a node says nothing about the relations hanging off it; those
    // are chosen one by one in the dialog.
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };
    stored["edges/e-1"] = { source: "node-1", target: "node-2" };

    const result = await handler({} as never);

    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ hiddenEdges: [] });
  });

  it("files each hidden relation in the audit log", async () => {
    stored["nodes/node-1"] = {
      name: "X",
      revision_id: { path: "revisions/r" },
    };
    stored["edges/e-1"] = {
      source: "node-1",
      target: "node-2",
      published: true,
    };
    requestPublished(false);

    await handler({} as never);

    expect(mockBatchSet).toHaveBeenCalledWith(
      "audit/generated-id",
      expect.objectContaining({
        action: "unpublish",
        collection: "edges",
        target_id: "e-1",
        user: "admin-uid",
      }),
    );
  });

  it("is refused to everyone but an admin", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce({ statusCode: 403 });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });
});
