import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/revisions/pendingEdges.get";

const mockGet = vi.fn();
const mockCount = vi.fn();
const mockGetAll = vi.fn();

/** Every query method the handler chains, each returning the same object so the
 * order of the calls does not matter to the test. */
const queryMock: Record<string, unknown> = {};
Object.assign(queryMock, {
  where: vi.fn(() => queryMock),
  orderBy: vi.fn(() => queryMock),
  offset: vi.fn(() => queryMock),
  limit: vi.fn(() => queryMock),
  count: vi.fn(() => ({ get: mockCount })),
  get: mockGet,
});

const mockDb = {
  collection: vi.fn((name: string) => ({
    ...queryMock,
    doc: (id: string) => ({ id, collection: name }),
  })),
  getAll: (...refs: unknown[]) => mockGetAll(...refs),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
}));

const mockGetUser = vi.fn();
vi.mock("../../../../server/utils/auth", () => ({
  getUser: (...args: unknown[]) => mockGetUser(...args),
}));

const { mockQuery } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  // server/utils/fetch.ts wraps a Nitro auto-import at module load, and
  // `paginate` lives there.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineCachedFunction = (fn: any) => fn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.getValidatedQuery = async (_event: any, parse: any) =>
    parse(mockQuery());
  return { mockQuery };
});

/** A stored candidacy, as all 10476 of them look: no committee. */
const storedEdge = {
  source: "person-1",
  target: "teryt1465",
  type: "election",
  name: "kandydatura",
  position: "Samorząd",
  start_date: "2024-01-01",
};

function revisionDoc(
  id: string,
  data: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    data: () => ({
      node_id: "edge-1",
      data,
      status: "pending",
      collection: "edges",
      update_time: "2026-08-03T11:00:00.000Z",
      update_user: "test-admin",
      update_automatic: true,
      ...overrides,
    }),
  };
}

function docFor(id: string, data: Record<string, unknown> | undefined) {
  return { id, exists: data !== undefined, data: () => data };
}

describe("api/revisions/pendingEdges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ uid: "u", admin: true });
    mockQuery.mockReturnValue({});
    mockCount.mockResolvedValue({ data: () => ({ count: 1 }) });
  });

  it("refuses a caller who is not an admin", async () => {
    // It reads through the admin SDK, which bypasses the Firestore rules -
    // and those deny /edges to the client outright.
    mockGetUser.mockResolvedValue({ uid: "u" });
    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("says what the proposal would change about the edge", async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        revisionDoc("proposal-1", {
          ...storedEdge,
          committee: "Komitet Wyborczy Wyborców Wspólny Kalisz",
        }),
      ],
    });
    mockGetAll
      .mockResolvedValueOnce([docFor("edge-1", storedEdge)])
      .mockResolvedValueOnce([
        docFor("person-1", { name: "Jan Kowalski", type: "person" }),
        docFor("teryt1465", { name: "Powiat kaliski", type: "region" }),
      ]);

    const result = await handler({} as never);

    expect(result.total).toBe(1);
    expect(result.revisions).toHaveLength(1);
    const [item] = result.revisions;
    expect(item!.changes).toEqual([
      {
        field: "committee",
        from: null,
        to: "Komitet Wyborczy Wyborców Wspólny Kalisz",
      },
    ]);
    // The pair is what the edge is, not what the proposal changes; restating it
    // in the diff would bury the one line that matters.
    expect(item!.changes.map((c) => c.field)).not.toContain("source");
    expect(item!.source.name).toBe("Jan Kowalski");
    expect(item!.target.name).toBe("Powiat kaliski");
    expect(item!.published).toBe(false);
    expect(item!.automatic).toBe(true);
  });

  it("drops a proposal whose edge has been deleted since", async () => {
    // Reviewing a change to a document that is gone is worse than not showing
    // it at all.
    mockGet.mockResolvedValue({
      empty: false,
      docs: [revisionDoc("proposal-1", { ...storedEdge, committee: "KW X" })],
    });
    mockGetAll.mockResolvedValueOnce([docFor("edge-1", undefined)]);

    const result = await handler({} as never);
    expect(result.revisions).toEqual([]);
  });

  it("keeps a published edge marked as published", async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [revisionDoc("proposal-1", { ...storedEdge, committee: "KW X" })],
    });
    mockGetAll
      .mockResolvedValueOnce([
        docFor("edge-1", { ...storedEdge, published: true }),
      ])
      .mockResolvedValueOnce([
        docFor("person-1", { name: "Jan Kowalski", type: "person" }),
        docFor("teryt1465", { name: "Powiat kaliski", type: "region" }),
      ]);

    const result = await handler({} as never);
    expect(result.revisions[0]!.published).toBe(true);
  });

  it("asks Firestore only for the pending changes to edges", async () => {
    // The collection holds node proposals too - /api/revisions/create writes
    // `status: "pending"` for those - and they belong on /admin/rewizje.
    mockGet.mockResolvedValue({ empty: true, docs: [] });

    await handler({} as never);

    expect(queryMock.where).toHaveBeenCalledWith("collection", "==", "edges");
    expect(queryMock.where).toHaveBeenCalledWith("status", "==", "pending");
  });

  it("returns nothing rather than reading edges when the page is empty", async () => {
    mockGet.mockResolvedValue({ empty: true, docs: [] });

    const result = await handler({} as never);

    expect(result.revisions).toEqual([]);
    expect(mockGetAll).not.toHaveBeenCalled();
  });
});
