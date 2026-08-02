import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActivityStats } from "../../../server/api/stats/activity.get";
import handler from "../../../server/api/stats/activity.get";

const { mockGetUser, mockGetUsers, mockCollect, headers } = vi.hoisted(() => {
  const globals = globalThis as Record<string, unknown>;
  globals.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  // Nitro wraps the read-and-roll-up in its cache; here it runs straight
  // through, so each test sees the events it set up.
  globals.defineCachedFunction = (fn: unknown) => fn;

  return {
    mockGetUser: vi.fn(),
    mockGetUsers: vi.fn(),
    mockCollect: vi.fn(),
    headers: new Map<string, string>(),
  };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    getValidatedQuery: async (
      event: { query: unknown },
      parser: (q: unknown) => unknown,
    ) => parser(event.query ?? {}),
    setResponseHeader: (_event: unknown, name: string, value: string) =>
      headers.set(name, value),
  };
});

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUsers: mockGetUsers }),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({}),
}));

vi.mock("~~/server/utils/auth", () => ({ getUser: mockGetUser }));

vi.mock("~~/server/utils/activityEvents", () => ({
  collectActivityEvents: mockCollect,
}));

const call = (query: Record<string, unknown> = {}) =>
  (handler as unknown as (event: unknown) => Promise<ActivityStats>)({ query });

/** Today, so the events land inside whatever window the handler computes. */
const today = new Date().toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  headers.clear();
  mockCollect.mockResolvedValue({
    events: [
      { uid: "busy", kind: "nodeVote", at: today },
      { uid: "busy", kind: "nodeVote", at: today },
      { uid: "busy", kind: "revision", at: today },
      { uid: "quiet", kind: "extractionVote", at: today },
    ],
    truncated: [],
  });
  mockGetUsers.mockResolvedValue({
    users: [
      {
        uid: "busy",
        displayName: "Anna Nowak",
        email: "anna@example.com",
        photoURL: null,
      },
    ],
    notFound: [{ uid: "quiet" }],
  });
});

describe("/api/stats/activity", () => {
  it("gives an anonymous caller the totals but nobody's name", async () => {
    mockGetUser.mockRejectedValue(new Error("no token"));

    const result = await call();

    expect(result.identified).toBe(false);
    expect(result.contributors).toEqual([]);
    expect(result.contributorCount).toBe(2);
    expect(result.totals.nodeVote).toBe(2);
    expect(result.totals.extractionVote).toBe(1);
    expect(result.totals.revision).toBe(1);
    expect(result.total).toBe(4);
    expect(mockGetUsers).not.toHaveBeenCalled();
  });

  it("withholds identities from a signed-in non-admin too", async () => {
    mockGetUser.mockResolvedValue({ uid: "someone" });

    const result = await call();

    expect(result.identified).toBe(false);
    expect(result.contributors).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("busy");
  });

  it("ranks and names contributors for an admin", async () => {
    mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });

    const result = await call();

    expect(result.identified).toBe(true);
    expect(result.contributors.map((c) => c.uid)).toEqual(["busy", "quiet"]);
    expect(result.contributors[0]).toMatchObject({
      displayName: "Anna Nowak",
      email: "anna@example.com",
      total: 3,
      counts: { nodeVote: 2, revision: 1 },
    });
    // A uid the auth service no longer knows keeps its place in the ranking.
    expect(result.contributors[1]).toMatchObject({
      uid: "quiet",
      displayName: null,
      total: 1,
    });
  });

  it("marks an admin's response uncacheable, since it is not shareable", async () => {
    mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });

    await call();

    expect(headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("leaves a public response cacheable", async () => {
    mockGetUser.mockRejectedValue(new Error("no token"));

    await call();

    expect(headers.has("Cache-Control")).toBe(false);
  });

  it("defaults to 30 days and honours an explicit range", async () => {
    mockGetUser.mockRejectedValue(new Error("no token"));

    expect((await call()).window.days).toBe(30);
    expect((await call({ days: "7" })).window.days).toBe(7);
    expect((await call({ days: "7" })).daily).toHaveLength(7);
  });

  it("rejects a range outside what the scans can serve", async () => {
    mockGetUser.mockRejectedValue(new Error("no token"));

    await expect(call({ days: "0" })).rejects.toThrow();
    await expect(call({ days: "3650" })).rejects.toThrow();
  });

  it("passes on which kinds were cut short by their scan cap", async () => {
    mockGetUser.mockRejectedValue(new Error("no token"));
    mockCollect.mockResolvedValue({
      events: [],
      truncated: ["nodeVote", "nodeVote", "revision"],
    });

    expect((await call()).truncated).toEqual(["nodeVote", "revision"]);
  });
});
