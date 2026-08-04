import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAdmin } from "../../../../server/utils/auth";
import handler from "../../../../server/api/edges/unpublished.get";

let nodes: Record<string, Record<string, unknown>> = {};
let edges: Record<string, Record<string, unknown>> = {};

/** How many documents each scan asked for, so a test can say the endpoint
 * kept scanning rather than giving up on the first page. */
const scans: { after: string | null; limit: number }[] = [];

/** A query over `edges`, built up the way the endpoint builds it.
 *
 * Only the shape the endpoint uses is modelled: one equality filter, ordered
 * by document id, optionally starting after a cursor. Ordering by id is the
 * whole point of the cursor, so the fake sorts rather than trusting insertion
 * order.
 */
function edgeQuery(field: string, value: unknown) {
  let after: string | null = null;
  let limit = Infinity;

  const query = {
    orderBy: vi.fn(() => query),
    startAfter: vi.fn((cursor: string) => {
      after = cursor;
      return query;
    }),
    limit: vi.fn((count: number) => {
      limit = count;
      return query;
    }),
    get: vi.fn(async () => {
      scans.push({ after, limit });
      const matching = Object.entries(edges)
        .filter(([, data]) => data[field] === value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .filter(([id]) => (after === null ? true : id > after))
        .slice(0, limit)
        .map(([id, data]) => ({ id, data: () => data }));
      return {
        docs: matching,
        size: matching.length,
        empty: matching.length === 0,
      };
    }),
  };
  return query;
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => ({
      id,
      path: `${collection}/${id}`,
      parent: { id: collection },
    })),
    where: vi.fn((field: string, _op: string, value: unknown) =>
      edgeQuery(field, value),
    ),
  })),
  // Endpoint nodes are read in one multi-get per 100 ids, which is what keeps
  // the page off an N+1.
  getAll: vi.fn(async (...refs: { id: string; path: string }[]) =>
    refs.map((ref) => ({
      id: ref.id,
      exists: nodes[ref.id] !== undefined,
      data: () => nodes[ref.id],
    })),
  ),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  FieldPath: { documentId: () => "__name__" },
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ uid: "admin-uid", admin: true }),
}));

const { mockGetValidatedQuery } = vi.hoisted(() => {
  const mockGetValidatedQuery = vi.fn();
  globalThis.getValidatedQuery = mockGetValidatedQuery;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockGetValidatedQuery };
});

function request(query: Record<string, unknown> = {}) {
  mockGetValidatedQuery.mockImplementation(
    async (_event: unknown, parse: (q: unknown) => unknown) => {
      try {
        return parse(query);
      } catch {
        throw { statusCode: 400, statusMessage: "Bad Request" };
      }
    },
  );
}

/** `id` padded so document ids sort the way the numbers do, which is what the
 * cursor relies on. */
function edgeId(index: number) {
  return `e${String(index).padStart(4, "0")}`;
}

type Result = {
  edges: { id: string; sourceName: string | null; targetName: string | null }[];
  nextCursor: string | null;
  scanned: number;
  truncated: boolean;
};

const call = () => handler({} as never) as Promise<Result>;

describe("api/edges/unpublished", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scans.length = 0;
    nodes = {
      live1: { name: "Anna Nowak", published: true },
      live2: { name: "Orlen", published: true },
      draft: { name: "Jan Kowalski", published: false },
    };
    edges = {};
    request();
  });

  it("lists a relation whose pages are both live", async () => {
    edges[edgeId(1)] = {
      source: "live1",
      target: "live2",
      type: "connection",
      published: false,
    };

    const result = await call();

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      id: edgeId(1),
      sourceName: "Anna Nowak",
      targetName: "Orlen",
    });
  });

  it("leaves out a relation still waiting on a draft page", async () => {
    // This is the queue of work that is *ready*, and one waiting on somebody
    // else's decision is not.
    edges[edgeId(1)] = { source: "live1", target: "draft", published: false };

    const result = await call();

    expect(result.edges).toEqual([]);
  });

  it("leaves out a relation pointing at a page that was never created", async () => {
    edges[edgeId(1)] = { source: "live1", target: "ghost", published: false };

    const result = await call();

    expect(result.edges).toEqual([]);
  });

  it("skips deleted relations and ones missing an end", async () => {
    edges[edgeId(1)] = {
      source: "live1",
      target: "live2",
      published: false,
      deleted: true,
    };
    edges[edgeId(2)] = { source: "live1", published: false };
    edges[edgeId(3)] = { target: "live2", published: false };

    const result = await call();

    expect(result.edges).toEqual([]);
  });

  it("keeps scanning until the page is full, rather than stopping at the first batch", async () => {
    // The filter runs after the read, so a scan of 300 that happens to be all
    // blocked relations would otherwise return an empty page while eligible
    // ones sat just behind it.
    for (let i = 1; i <= 400; i += 1) {
      edges[edgeId(i)] = { source: "live1", target: "draft", published: false };
    }
    edges[edgeId(350)] = { source: "live1", target: "live2", published: false };
    request({ limit: 1 });

    const result = await call();

    expect(result.edges.map((edge) => edge.id)).toEqual([edgeId(350)]);
    expect(scans.length).toBeGreaterThan(1);
  });

  it("counts what it read, not what it returned", async () => {
    for (let i = 1; i <= 10; i += 1) {
      edges[edgeId(i)] = { source: "live1", target: "draft", published: false };
    }
    edges[edgeId(11)] = { source: "live1", target: "live2", published: false };

    const result = await call();

    expect(result.edges).toHaveLength(1);
    expect(result.scanned).toBe(11);
  });

  it("says there is nothing more once the collection runs out", async () => {
    edges[edgeId(1)] = { source: "live1", target: "live2", published: false };

    const result = await call();

    expect(result.nextCursor).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it("resumes from the last relation it looked at, not the last it read", async () => {
    // Filling the page two rows into a batch of 300 and then pointing the
    // cursor at the end of that batch would drop the other 298 - eligible,
    // read, and never shown to anybody.
    for (let i = 1; i <= 400; i += 1) {
      edges[edgeId(i)] = { source: "live1", target: "live2", published: false };
    }
    request({ limit: 2 });

    const result = await call();

    expect(result.edges.map((edge) => edge.id)).toEqual([edgeId(1), edgeId(2)]);
    expect(result.nextCursor).toBe(edgeId(2));
  });

  it("returns every eligible relation across two pages, losing none", async () => {
    for (let i = 1; i <= 5; i += 1) {
      edges[edgeId(i)] = { source: "live1", target: "live2", published: false };
    }
    request({ limit: 2 });

    const first = await call();
    request({ limit: 2, cursor: first.nextCursor ?? undefined });
    const second = await call();
    request({ limit: 2, cursor: second.nextCursor ?? undefined });
    const third = await call();

    expect(
      [...first.edges, ...second.edges, ...third.edges].map((e) => e.id),
    ).toEqual([edgeId(1), edgeId(2), edgeId(3), edgeId(4), edgeId(5)]);
  });

  it("picks up where the cursor left off", async () => {
    for (let i = 1; i <= 5; i += 1) {
      edges[edgeId(i)] = { source: "live1", target: "live2", published: false };
    }
    request({ limit: 2, cursor: edgeId(3) });

    const result = await call();

    expect(result.edges.map((edge) => edge.id)).toEqual([edgeId(4), edgeId(5)]);
    expect(scans[0]?.after).toBe(edgeId(3));
  });

  it("stops on its own budget and says so", async () => {
    // Firestore cannot join, so this is a scan; admitting where it gave up is
    // better than a short page that reads as "there is nothing else".
    for (let i = 1; i <= 4000; i += 1) {
      edges[edgeId(i)] = { source: "live1", target: "draft", published: false };
    }

    const result = await call();

    expect(result.edges).toEqual([]);
    expect(result.scanned).toBe(3000);
    expect(result.truncated).toBe(true);
    expect(result.nextCursor).not.toBeNull();
  });

  it("asks only for relations that are not published", async () => {
    edges[edgeId(1)] = { source: "live1", target: "live2", published: false };

    await call();

    expect(mockDb.collection).toHaveBeenCalledWith("edges");
    const where = mockDb.collection.mock.results[0]?.value.where;
    expect(where).toHaveBeenCalledWith("published", "==", false);
  });

  it("defaults to a page of 25 and refuses to serve more than 100", async () => {
    for (let i = 1; i <= 200; i += 1) {
      edges[edgeId(i)] = { source: "live1", target: "live2", published: false };
    }

    expect((await call()).edges).toHaveLength(25);

    request({ limit: 100 });
    expect((await call()).edges).toHaveLength(100);

    request({ limit: 101 });
    await expect(call()).rejects.toMatchObject({ statusCode: 400 });
  });

  it("is refused to everyone but an admin", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce({ statusCode: 403 });

    await expect(call()).rejects.toMatchObject({ statusCode: 403 });
  });
});
