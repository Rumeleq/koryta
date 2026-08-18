import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/articles/[id]/mentions.post";

/** The firestore double is the one `topics.test.ts` uses: both handlers are
 * `changeArticleEdges` with a different kind of far end, and the point of these
 * cases is what differs - the far end may be a person or a place, and the edges
 * saying so are stored with the article at either end.
 */

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

/** The `mentions` edges written by the last call, as the batch saw them. */
const mentionWrites = () =>
  writes.filter((write) => write.data.type === "mentions");

describe("POST /api/articles/[id]/mentions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generated = 0;
    writes = [];
    body = {};
    globalThis.getRouterParam = vi.fn(() => "article-1");
    stored = {
      "nodes/article-1": { type: "article", name: "Artyku\u0142" },
      "nodes/person-1": { type: "person", name: "Anna Nowak" },
      "nodes/place-1": { type: "place", name: "Sp\u00f3\u0142ka" },
      "nodes/topic-a": { type: "topic", name: "Sprawa" },
    };
  });

  it("writes a mention as a draft, pointing from the article", async () => {
    body = { add: ["person-1"] };
    await handler({} as never);

    const [edge] = mentionWrites();
    expect(edge?.data).toMatchObject({
      source: "article-1",
      target: "person-1",
      type: "mentions",
      published: false,
    });
  });

  it("accepts an institution as well as a person", async () => {
    body = { add: ["place-1"] };
    await handler({} as never);

    expect(mentionWrites()).toHaveLength(1);
  });

  it("refuses an id that is neither", async () => {
    body = { add: ["topic-a"] };

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(writes).toHaveLength(0);
  });

  it("does not write a second edge for a mention the pipeline already wrote", async () => {
    // `ingest/person.post.ts` writes them person -> article, and produced most
    // of the ones in the database. Reading one direction would have offered to
    // add a mention that is already there.
    stored["edges/existing"] = {
      source: "person-1",
      target: "article-1",
      type: "mentions",
      published: true,
    };

    body = { add: ["person-1"] };
    await handler({} as never);

    expect(mentionWrites()).toHaveLength(0);
  });

  it("removes a mention stored the other way round", async () => {
    stored["edges/existing"] = {
      source: "person-1",
      target: "article-1",
      type: "mentions",
      published: true,
    };

    body = { remove: ["person-1"] };
    await handler({} as never);

    expect(stored["edges/existing"]).toMatchObject({ deleted: true });
  });

  it("removes every edge saying the same thing, not just the first", async () => {
    // Two writers who do not know about each other can each have recorded it.
    // Removing one would put the chip straight back on the next read.
    stored["edges/from-pipeline"] = {
      source: "person-1",
      target: "article-1",
      type: "mentions",
      published: true,
    };
    stored["edges/from-reader"] = {
      source: "article-1",
      target: "person-1",
      type: "mentions",
      published: false,
    };

    body = { remove: ["person-1"] };
    await handler({} as never);

    expect(stored["edges/from-pipeline"]).toMatchObject({ deleted: true });
    expect(stored["edges/from-reader"]).toMatchObject({ deleted: true });
  });

  it("refuses to record a mention on something that is not an article", async () => {
    globalThis.getRouterParam = vi.fn(() => "person-1");
    body = { add: ["place-1"] };

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
