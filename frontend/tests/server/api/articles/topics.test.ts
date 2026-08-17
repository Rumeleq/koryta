import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/articles/[id]/topics.post";

/** Every document, keyed by `collection/id`. */
let stored: Record<string, Record<string, unknown> | undefined> = {};
/** Writes the committed batch made, in order. */
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

let generated = 0;

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) =>
      docRef(collection, id ?? `generated-${++generated}`),
    ),
    where: vi.fn(function chain(
      this: unknown,
      field: string,
      _op: string,
      value: unknown,
    ) {
      const filters: [string, unknown][] = [[field, value]];
      const build = () => ({
        where: (nextField: string, _nextOp: string, nextValue: unknown) => {
          filters.push([nextField, nextValue]);
          return build();
        },
        get: async () => ({
          docs: Object.entries(stored)
            .filter(([path]) => path.startsWith(`${collection}/`))
            .filter(([, data]) => filters.every(([f, v]) => data?.[f] === v))
            .map(([path, data]) => ({
              id: path.slice(collection.length + 1),
              ref: docRef(collection, path.slice(collection.length + 1)),
              data: () => data as Record<string, unknown>,
            })),
        }),
      });
      return build();
    }),
  })),
  getAll: vi.fn(async (...refs: { id: string; path: string }[]) =>
    refs.map((ref) => ({
      id: ref.id,
      exists: stored[ref.path] !== undefined,
      data: () => stored[ref.path],
    })),
  ),
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

vi.mock("../../../../server/utils/audit", () => ({
  recordAudit: vi.fn(),
}));

let body: Record<string, unknown> = {};

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});

globalThis.readBody = vi.fn(async () => body);
globalThis.getRouterParam = vi.fn(() => "article-1");

/** The `tagged` edges written by the last call, as the batch saw them. */
const taggedWrites = () =>
  writes.filter((write) => write.data.type === "tagged");

describe("POST /api/articles/[id]/topics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generated = 0;
    writes = [];
    stored = {
      "nodes/article-1": { type: "article", name: "Artykuł" },
      "nodes/topic-a": { type: "topic", name: "Powodzianie KRR" },
      "nodes/topic-b": { type: "topic", name: "Inna sprawa" },
      "nodes/person-1": { type: "person", name: "Ktoś" },
    };
  });

  it("writes a tag as a draft, so only signed in readers see it", async () => {
    body = { add: ["topic-a"] };
    await handler({} as never);

    const [edge] = taggedWrites();
    expect(edge?.data).toMatchObject({
      source: "article-1",
      target: "topic-a",
      type: "tagged",
      published: false,
    });
  });

  it("does not write a second edge for a tag already there", async () => {
    stored["edges/existing"] = {
      source: "article-1",
      target: "topic-a",
      type: "tagged",
      published: true,
    };

    body = { add: ["topic-a"] };
    await handler({} as never);

    expect(taggedWrites()).toHaveLength(0);
  });

  it("refuses an id that is not a topic", async () => {
    body = { add: ["person-1"] };

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 422,
    });
    // Nothing may be written when part of the request is bad.
    expect(writes).toHaveLength(0);
  });

  it("refuses to tag something that is not an article", async () => {
    globalThis.getRouterParam = vi.fn(() => "person-1");
    body = { add: ["topic-a"] };

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 404,
    });
    globalThis.getRouterParam = vi.fn(() => "article-1");
  });

  it("marks a removed tag deleted", async () => {
    stored["edges/tag-1"] = {
      source: "article-1",
      target: "topic-a",
      type: "tagged",
      published: true,
    };

    body = { remove: ["topic-a"] };
    await handler({} as never);

    expect(stored["edges/tag-1"]).toMatchObject({ deleted: true });
  });

  it("removes a tag whose edge was stored with `deleted: false`", async () => {
    // The regression this guards: `deleted` is a field the document owns, so
    // `createRevisionTransaction` layers `stored`'s value back over the
    // revision. An edge written by the old client helper carries an explicit
    // `deleted: false`, and carrying that across would undo the removal - the
    // request would answer 200 and change nothing.
    stored["edges/tag-1"] = {
      source: "article-1",
      target: "topic-a",
      type: "tagged",
      published: true,
      deleted: false,
    };

    body = { remove: ["topic-a"] };
    await handler({} as never);

    expect(stored["edges/tag-1"]).toMatchObject({ deleted: true });
  });

  it("rejects a request that changes nothing", async () => {
    body = {};
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
