import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/articles/topics.get";

/** Documents to hand back, keyed by collection. */
let docs: Record<string, Record<string, Record<string, unknown>>> = {};
/** What `wantsLatest` answers, i.e. whether the caller is signed in. */
let latest = false;

const mockDb = {
  collection: vi.fn((collection: string) => ({
    where: vi.fn(() => ({
      get: async () => ({
        docs: Object.entries(docs[collection] ?? {}).map(([id, data]) => ({
          id,
          data: () => data,
        })),
      }),
    })),
  })),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
}));
vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));
vi.mock("../../../../server/utils/handlers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorFreshCachedEventHandler: (fn: any) => fn,
  wantsLatest: () => latest,
}));

const call = () =>
  handler({} as never) as unknown as Promise<{
    byArticle: Record<
      string,
      { id: string; name: string; published: boolean }[]
    >;
  }>;

describe("GET /api/articles/topics", () => {
  beforeEach(() => {
    latest = false;
    docs = {
      nodes: {
        "topic-a": { type: "topic", name: "Powodzianie KRR", published: true },
        "topic-b": { type: "topic", name: "Inna sprawa", published: true },
        "topic-draft": { type: "topic", name: "Szkic", published: false },
      },
      edges: {
        "edge-1": {
          type: "tagged",
          source: "article-1",
          target: "topic-a",
          published: true,
        },
        "edge-2": {
          type: "tagged",
          source: "article-1",
          target: "topic-b",
          published: true,
        },
      },
    };
  });

  it("groups the topics under the article tagged into them, by name", async () => {
    const { byArticle } = await call();

    expect(byArticle["article-1"]).toEqual([
      { id: "topic-b", name: "Inna sprawa", published: true },
      { id: "topic-a", name: "Powodzianie KRR", published: true },
    ]);
  });

  it("leaves an untagged article out rather than mapping it to nothing", async () => {
    const { byArticle } = await call();

    expect(byArticle["article-2"]).toBeUndefined();
  });

  it("hides a draft tag from the public and shows it to a signed in reader", async () => {
    docs.edges!["edge-3"] = {
      type: "tagged",
      source: "article-2",
      target: "topic-a",
      published: false,
    };

    expect((await call()).byArticle["article-2"]).toBeUndefined();

    latest = true;
    expect((await call()).byArticle["article-2"]).toEqual([
      { id: "topic-a", name: "Powodzianie KRR", published: false },
    ]);
  });

  it("drops a tag whose topic is a draft this reader may not see", async () => {
    docs.edges!["edge-3"] = {
      type: "tagged",
      source: "article-2",
      target: "topic-draft",
      published: true,
    };

    expect((await call()).byArticle["article-2"]).toBeUndefined();

    // Visible to an editor, and marked as not live even though the tag itself
    // is - a link to a page the public cannot open is still a draft.
    latest = true;
    expect((await call()).byArticle["article-2"]).toEqual([
      { id: "topic-draft", name: "Szkic", published: false },
    ]);
  });

  it("drops a deleted tag and a deleted topic", async () => {
    docs.edges!["edge-2"]!.deleted = true;
    docs.nodes!["topic-a"]!.deleted = true;

    expect((await call()).byArticle["article-1"]).toBeUndefined();
  });

  it("counts the same article tagged twice into one topic once", async () => {
    docs.edges!["edge-3"] = {
      type: "tagged",
      source: "article-1",
      target: "topic-a",
      published: true,
    };

    expect((await call()).byArticle["article-1"]).toHaveLength(2);
  });
});
