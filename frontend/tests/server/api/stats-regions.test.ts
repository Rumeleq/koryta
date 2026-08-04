import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/stats/regions.get";

const { mockDocGet, mockDocSet, mockFetchNodes, mockDoc } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.defineEventHandler = (fn: unknown) => fn;
  globals.defineCachedFunction = (fn: unknown) => fn;
  globals.useEvent = () => ({ path: "/api/stats/regions" });

  return {
    mockDocGet: vi.fn(),
    mockDocSet: vi.fn(),
    mockFetchNodes: vi.fn(),
    mockDoc: vi.fn(),
  };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => {
        mockDoc(name, id);
        return { get: mockDocGet, set: mockDocSet };
      },
    }),
  }),
}));

vi.mock("~~/server/utils/fetch", () => ({ fetchNodes: mockFetchNodes }));

// The handler is wrapped in nitro's cache; here it runs straight through.
vi.mock("~~/server/utils/handlers", () => ({
  authCachedEventHandler: (fn: unknown) => fn,
}));

const call = () =>
  (handler as unknown as (event: unknown) => Promise<unknown>)({});

beforeEach(() => {
  vi.clearAllMocks();
  mockDocSet.mockResolvedValue(undefined);
});

describe("/api/stats/regions", () => {
  it("serves the precomputed rows without touching the region nodes", async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        type: "region_people",
        regions: [
          { id: "teryt1261", teryt: "1261", name: "Kraków", people: 7 },
        ],
        computedAt: "2026-08-04T00:00:00.000Z",
      }),
    });

    expect(await call()).toEqual([
      { id: "teryt1261", teryt: "1261", name: "Kraków", people: 7 },
    ]);
    expect(mockDoc).toHaveBeenCalledWith("stats", "region_people");
    // The whole point: no full scan of the region collection.
    expect(mockFetchNodes).not.toHaveBeenCalled();
    expect(mockDocSet).not.toHaveBeenCalled();
  });

  it("falls back to the nodes when nothing has computed them, and leaves the rows behind", async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    mockFetchNodes.mockResolvedValue({
      teryt1261: { teryt: "1261", name: "Kraków", stats: { people: 7 } },
      teryt0201: { teryt: "0201", name: "Bolesławiec" },
      // Not every region node carries a teryt or a name. Writing the row with
      // those fields present-but-undefined is rejected by Firestore outright,
      // which took the whole endpoint down with a 500.
      bare: { stats: { people: 2 } },
    });

    const rows = await call();

    expect(rows).toEqual([
      { id: "teryt1261", teryt: "1261", name: "Kraków", people: 7 },
      // A region nothing has counted yet reads as zero, not as undefined.
      { id: "teryt0201", teryt: "0201", name: "Bolesławiec", people: 0 },
      { id: "bare", people: 2 },
    ]);
    for (const row of rows as Record<string, unknown>[]) {
      expect(Object.values(row).some((v) => v === undefined)).toBe(false);
    }
    expect(mockFetchNodes).toHaveBeenCalledWith("region");
    // Written back, so the scan happens once rather than on every cache miss.
    expect(mockDocSet).toHaveBeenCalledTimes(1);
    expect(mockDocSet.mock.calls[0]?.[0]).toMatchObject({
      type: "region_people",
      regions: rows,
    });
  });

  it("rebuilds when the document exists but holds no rows", async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ type: "region_people" }),
    });
    mockFetchNodes.mockResolvedValue({});

    expect(await call()).toEqual([]);
    expect(mockFetchNodes).toHaveBeenCalledWith("region");
  });
});
