import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/edges/[id]/references.post";

let stored: Record<string, Record<string, unknown> | undefined> = {};
let writes: { path: string; data: Record<string, unknown> }[] = [];

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

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) => docRef(collection, id ?? "generated")),
  })),
  batch: vi.fn(() => ({
    set: vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
      writes.push({ path: ref.path, data });
      stored[ref.path] = data;
    }),
    commit: vi.fn(async () => {}),
  })),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  Timestamp: class {
    toMillis() {
      return 0;
    }
    static now() {
      return new this();
    }
  },
  FieldValue: { delete: () => "delete" },
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));
vi.mock("../../../../server/utils/auth", () => ({
  getUser: vi.fn().mockResolvedValue({ uid: "reader-uid" }),
}));
vi.mock("../../../../server/utils/audit", () => ({ recordAudit: vi.fn() }));

let body: Record<string, unknown> = {};

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});

globalThis.readBody = vi.fn(async () => body);
globalThis.getRouterParam = vi.fn(() => "edge-1");

const edgeNow = () => stored["edges/edge-1"] as Record<string, unknown>;

describe("POST /api/edges/[id]/references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writes = [];
    stored = {
      "edges/edge-1": {
        source: "person-1",
        target: "place-1",
        type: "employed",
        name: "prezes",
        references: ["article-1"],
        published: true,
        stats: { votes: { interesting: 3 } },
      },
      "nodes/article-1": { type: "article", name: "Pierwszy" },
      "nodes/article-2": { type: "article", name: "Drugi" },
      "nodes/person-1": { type: "person", name: "Ktoś" },
    };
  });

  it("keeps a claim's existing sources when adding another", async () => {
    // A relation can rest on several articles, so this is a union rather than
    // a replacement.
    body = { add: ["article-2"] };
    const result = await handler({} as never);

    expect(result.references.sort()).toEqual(["article-1", "article-2"]);
    expect(edgeNow().references).toEqual(["article-1", "article-2"]);
  });

  it("merges against what is stored, not against what the caller last saw", async () => {
    // The lost-update this is built to avoid: somebody loaded the page when the
    // edge cited only article-1, and by the time they attach article-2 another
    // reader has already added article-3. Sending the whole list would drop it;
    // naming only the addition cannot.
    stored["edges/edge-1"]!.references = ["article-1", "article-3"];

    body = { add: ["article-2"] };
    const result = await handler({} as never);

    expect(result.references.sort()).toEqual([
      "article-1",
      "article-2",
      "article-3",
    ]);
  });

  it("detaches only the source named", async () => {
    stored["edges/edge-1"]!.references = ["article-1", "article-2"];

    body = { remove: ["article-1"] };
    const result = await handler({} as never);

    expect(result.references).toEqual(["article-2"]);
  });

  it("is safe to replay", async () => {
    body = { add: ["article-2"] };
    await handler({} as never);
    const second = await handler({} as never);

    expect(second.references.sort()).toEqual(["article-1", "article-2"]);
  });

  it("leaves the relation published and its counters intact", async () => {
    // `createRevisionTransaction` writes the target with `set`, so a caller
    // that does not hand back what the document owns deletes it. A citation
    // must not take a live relation off the site or reset its votes.
    body = { add: ["article-2"] };
    await handler({} as never);

    expect(edgeNow().published).toBe(true);
    expect(edgeNow().stats).toEqual({ votes: { interesting: 3 } });
  });

  it("refuses a source that is not an article", async () => {
    body = { add: ["person-1"] };

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(writes).toHaveLength(0);
  });

  it("refuses a relation that is not there", async () => {
    delete stored["edges/edge-1"];
    body = { add: ["article-2"] };

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("rejects a request that changes nothing", async () => {
    body = {};
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
