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

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) => docRef(collection, id ?? "generated-id")),
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
    expect(result).toEqual({ id: "node-1", published: true });
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

  it("is refused to everyone but an admin", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce({ statusCode: 403 });

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });
});
