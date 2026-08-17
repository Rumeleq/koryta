import { describe, it, expect, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  articleIdsForTopic,
  edgesCitingArticles,
} from "../../../server/utils/topics";

type Doc = Record<string, unknown>;

/** A Firestore stand-in that understands only the two shapes these helpers
 * build: chained equality filters, and one `array-contains-any`. */
function fakeDb(
  edges: Record<string, Doc>,
  onQuery?: (values: unknown) => void,
) {
  const matches = (doc: Doc, field: string, op: string, value: unknown) => {
    if (op === "array-contains-any") {
      const held = (doc[field] as string[] | undefined) ?? [];
      return (value as string[]).some((wanted) => held.includes(wanted));
    }
    return doc[field] === value;
  };

  const build = (filters: [string, string, unknown][]) => ({
    where: (field: string, op: string, value: unknown) => {
      if (op === "array-contains-any") onQuery?.(value);
      return build([...filters, [field, op, value]]);
    },
    get: async () => ({
      docs: Object.entries(edges)
        .filter(([, doc]) =>
          filters.every(([field, op, value]) => matches(doc, field, op, value)),
        )
        .map(([id, doc]) => ({ id, data: () => doc })),
    }),
  });

  return {
    collection: vi.fn(() => build([])),
  } as unknown as Firestore;
}

describe("articleIdsForTopic", () => {
  const edges = {
    t1: { source: "a1", target: "topic", type: "tagged", published: true },
    t2: { source: "a2", target: "topic", type: "tagged", published: false },
    t3: { source: "a3", target: "topic", type: "tagged", deleted: true },
    t4: { source: "a4", target: "other", type: "tagged", published: true },
    m1: { source: "a5", target: "topic", type: "mentions", published: true },
  };

  it("returns only approved tags for a logged out reader", async () => {
    expect(await articleIdsForTopic(fakeDb(edges), "topic", false)).toEqual([
      "a1",
    ]);
  });

  it("includes drafts for someone who may see them", async () => {
    const ids = await articleIdsForTopic(fakeDb(edges), "topic", true);
    expect(ids.sort()).toEqual(["a1", "a2"]);
  });

  it("never returns an article whose tag was removed", async () => {
    const ids = await articleIdsForTopic(fakeDb(edges), "topic", true);
    expect(ids).not.toContain("a3");
  });
});

describe("edgesCitingArticles", () => {
  it("finds the relations an article is cited by", async () => {
    const edges = {
      e1: {
        source: "p1",
        target: "c1",
        type: "employed",
        published: true,
        references: ["a1"],
      },
      e2: {
        source: "p2",
        target: "c2",
        type: "employed",
        published: true,
        references: ["a9"],
      },
    };

    const found = await edgesCitingArticles(fakeDb(edges), ["a1"], false);
    expect(found.map((edge) => edge.id)).toEqual(["e1"]);
  });

  it("hides an unapproved relation from a logged out reader", async () => {
    const edges = {
      e1: { source: "p1", target: "c1", type: "employed", references: ["a1"] },
    };

    expect(await edgesCitingArticles(fakeDb(edges), ["a1"], false)).toEqual([]);
    expect(
      (await edgesCitingArticles(fakeDb(edges), ["a1"], true)).map((e) => e.id),
    ).toEqual(["e1"]);
  });

  it("asks in chunks of 30, which is the array-contains-any limit", async () => {
    const articleIds = Array.from({ length: 71 }, (_, i) => `a${i}`);
    const asked: unknown[] = [];
    const db = fakeDb({}, (values) => asked.push(values));

    await edgesCitingArticles(db, articleIds, true);

    // 71 articles is three passes, and no pass may exceed the limit or
    // Firestore rejects the query outright.
    expect(asked).toHaveLength(3);
    for (const chunk of asked) {
      expect((chunk as string[]).length).toBeLessThanOrEqual(30);
    }
    expect((asked as string[][]).flat()).toEqual(articleIds);
  });

  it("returns an edge once even when several of its sources are in the story", async () => {
    // The same relation cited to two articles comes back from two different
    // chunks; merging on the edge id is what stops it being drawn twice.
    const articleIds = Array.from({ length: 40 }, (_, i) => `a${i}`);
    const edges = {
      e1: {
        source: "p1",
        target: "c1",
        type: "employed",
        published: true,
        references: ["a0", "a35"],
      },
    };

    const found = await edgesCitingArticles(fakeDb(edges), articleIds, false);
    expect(found).toHaveLength(1);
  });

  it("asks nothing when the story has no articles", async () => {
    const asked: unknown[] = [];
    await edgesCitingArticles(
      fakeDb({}, (v) => asked.push(v)),
      [],
      true,
    );
    expect(asked).toHaveLength(0);
  });
});
