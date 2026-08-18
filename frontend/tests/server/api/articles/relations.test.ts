import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/articles/[id]/relations.get";

/** Every edge in the base, keyed by id. */
let edges: Record<string, Record<string, unknown>> = {};
/** Every node, keyed by id. */
let nodes: Record<string, Record<string, unknown>> = {};
let latest = false;

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn(() => ({ doc: (id: string) => ({ id }) })),
    getAll: async (...refs: { id: string }[]) =>
      refs.map((ref) => ({ id: ref.id, data: () => nodes[ref.id] })),
  })),
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));
vi.mock("../../../../server/utils/handlers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorFreshCachedEventHandler: (fn: any) => fn,
  wantsLatest: () => latest,
}));
vi.mock("../../../../server/utils/edgePublication", () => ({
  fetchEdgesForNode: async (_db: unknown, nodeId: string) =>
    Object.entries(edges)
      .filter(([, e]) => e.source === nodeId || e.target === nodeId)
      .map(([id, e]) => ({ id, ...e })),
}));

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
});
globalThis.getRouterParam = vi.fn(() => "article-1");

const call = () =>
  handler({} as never) as unknown as Promise<{
    topics: { nodeId: string; name: string | null; published: boolean }[];
    mentions: { nodeId: string; name: string | null; published: boolean }[];
  }>;

describe("GET /api/articles/[id]/relations", () => {
  beforeEach(() => {
    latest = false;
    nodes = {
      "person-1": { type: "person", name: "Anna Nowak" },
      "person-2": { type: "person", name: "Bogdan Zyx" },
      "topic-a": { type: "topic", name: "Sprawa" },
    };
    edges = {};
  });

  it("reads a mention the pipeline wrote, which points at the article", async () => {
    // `ingest/person.post.ts` writes person -> article and produced most of
    // them. Reading only outgoing edges left the section showing a fraction of
    // what the pipeline had found.
    edges.m1 = {
      source: "person-1",
      target: "article-1",
      type: "mentions",
      published: true,
    };

    const { mentions } = await call();
    expect(mentions).toMatchObject([
      { nodeId: "person-1", name: "Anna Nowak" },
    ]);
  });

  it("reads a mention the article page wrote, which points away from it", async () => {
    edges.m1 = {
      source: "article-1",
      target: "person-1",
      type: "mentions",
      published: true,
    };

    const { mentions } = await call();
    expect(mentions).toMatchObject([{ nodeId: "person-1" }]);
  });

  it("draws one chip when both writers recorded the same person", async () => {
    edges.m1 = {
      source: "person-1",
      target: "article-1",
      type: "mentions",
      published: true,
    };
    edges.m2 = {
      source: "article-1",
      target: "person-1",
      type: "mentions",
      published: false,
    };

    latest = true;
    const { mentions } = await call();
    // And it is the published one that is kept: it is what the public would be
    // shown, so it is what decides whether the chip reads as a draft.
    expect(mentions).toMatchObject([{ nodeId: "person-1", published: true }]);
  });

  it("keeps a tag only in the direction it is stored", async () => {
    edges.t1 = {
      source: "article-1",
      target: "topic-a",
      type: "tagged",
      published: true,
    };
    // A topic pointing at the article is not a thing anything writes, and
    // reading it would put the article itself on the far end.
    edges.t2 = {
      source: "topic-a",
      target: "article-1",
      type: "tagged",
      published: true,
    };

    const { topics } = await call();
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({ nodeId: "topic-a" });
  });

  it("hides an unapproved mention from the public", async () => {
    edges.m1 = {
      source: "article-1",
      target: "person-2",
      type: "mentions",
      published: false,
    };

    expect((await call()).mentions).toEqual([]);
    latest = true;
    expect((await call()).mentions).toMatchObject([{ nodeId: "person-2" }]);
  });
});
