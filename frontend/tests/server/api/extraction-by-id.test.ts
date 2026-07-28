import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/extractions/[id].get";

const { doc, docRef, routerParam } = vi.hoisted(() => {
  const routerParam: { id: string | undefined } = { id: "f1" };
  globalThis.getRouterParam = () => routerParam.id;
  globalThis.createError = (opts: { statusCode: number; message: string }) =>
    Object.assign(new Error(opts.message), opts);

  const doc: { exists: boolean; id: string; data: () => object } = {
    exists: true,
    id: "f1",
    data: () => ({}),
  };
  const docRef = vi.fn(() => ({ get: async () => doc }));
  return { doc, docRef, routerParam };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: () => ({ doc: docRef }) }),
}));
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
// Unwrap the Nitro cache layer so the handler can be called directly.
vi.mock("~~/server/utils/handlers", () => ({
  authCachedEventHandler: (fn: any) => fn,
}));

describe("GET /api/extractions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerParam.id = "f1";
    doc.exists = true;
    doc.id = "f1";
    doc.data = () => ({});
  });

  it("serves a reviewed fact, which is the whole point of the route", async () => {
    doc.data = () => ({
      articleUrl: "https://example.com/a",
      justification: "bo tak",
      createdAt: { toDate: () => new Date("2026-07-27T10:00:00.000Z") },
      stats: { votes: { humanVoted: true, correct: 1 } },
    });

    const result = (await handler({} as any)) as {
      fact: { id?: string; reviewed?: boolean; createdAt?: string };
    };

    expect(result.fact.id).toBe("f1");
    expect(result.fact.reviewed).toBe(true);
    expect(result.fact.createdAt).toBe("2026-07-27T10:00:00.000Z");
    expect(docRef).toHaveBeenCalledWith("f1");
  });

  it("reports an unreviewed fact as such", async () => {
    doc.data = () => ({ stats: { votes: { humanVoted: false } } });

    const result = (await handler({} as any)) as {
      fact: { reviewed?: boolean };
    };

    expect(result.fact.reviewed).toBe(false);
  });

  it("404s on an id that is not there", async () => {
    doc.exists = false;
    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("400s when the route param is missing", async () => {
    routerParam.id = undefined;
    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
