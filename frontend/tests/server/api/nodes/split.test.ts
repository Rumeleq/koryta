import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAdmin } from "../../../../server/utils/auth";
import handler from "../../../../server/api/nodes/split.post";

const mockBatchUpdate = vi.fn();
const mockBatchSet = vi.fn();
const mockCommit = vi.fn();
const mockCacheClear = vi.fn();

let stored: Record<string, Record<string, unknown> | undefined> = {};

/** Sequential ids, so a test can name the page the split created. */
let generated = 0;

function snapshot(collection: string, id: string) {
  return {
    id,
    exists: stored[`${collection}/${id}`] !== undefined,
    data: () => stored[`${collection}/${id}`],
  };
}

function docRef(collection: string, id: string) {
  return {
    id,
    path: `${collection}/${id}`,
    parent: { id: collection },
    get: vi.fn(async () => snapshot(collection, id)),
  };
}

function queryCollection(collection: string, field: string, value: unknown) {
  return Object.entries(stored)
    .filter(([path]) => path.startsWith(`${collection}/`))
    .filter(([, data]) => data?.[field] === value)
    .map(([path, data]) => ({
      id: path.slice(collection.length + 1),
      data: () => data as Record<string, unknown>,
    }));
}

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id?: string) =>
      docRef(collection, id ?? `generated-${++generated}`),
    ),
    where: vi.fn((field: string, _op: string, value: unknown) => ({
      get: vi.fn(async () => {
        const docs = queryCollection(collection, field, value);
        return { docs, size: docs.length, empty: docs.length === 0 };
      }),
    })),
  })),
  getAll: vi.fn(async (...refs: { parent: { id: string }; id: string }[]) =>
    refs.map((ref) => snapshot(ref.parent.id, ref.id)),
  ),
  batch: vi.fn(() => ({
    update: (ref: { path: string }, data: unknown) =>
      mockBatchUpdate(ref.path, data),
    set: (ref: { path: string }, data: unknown) => mockBatchSet(ref.path, data),
    commit: mockCommit,
  })),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  Timestamp: { now: () => ({}) },
  // The mark is answered by the split that follows it, so the field is deleted
  // rather than set to anything; the sentinel is what the write carries.
  FieldValue: { delete: () => "<delete>" },
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ uid: "admin-uid", admin: true }),
}));

const { mockReadValidatedBody } = vi.hoisted(() => {
  const mockReadValidatedBody = vi.fn();
  globalThis.readValidatedBody = mockReadValidatedBody;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockReadValidatedBody };
});

function request(body: Record<string, unknown>) {
  mockReadValidatedBody.mockImplementation(
    async (_event: unknown, parse: (b: unknown) => unknown) => {
      try {
        return parse(body);
      } catch {
        throw { statusCode: 400, statusMessage: "Bad Request" };
      }
    },
  );
}

function wrote(path: string) {
  return (
    mockBatchUpdate.mock.calls.find((call) => call[0] === path)?.[1] ??
    mockBatchSet.mock.calls.find((call) => call[0] === path)?.[1]
  );
}

function writtenTo(prefix: string) {
  return mockBatchSet.mock.calls.find((call) =>
    String(call[0]).startsWith(prefix),
  )?.[1] as Record<string, unknown> | undefined;
}

/** The page that turned out to be two people, with a relation belonging to
 * each of them. 36 nodes are in this state: a second human's register entry
 * overwrote the first's on the way in, and both careers landed on one page. */
function onePageForTwoHumans() {
  stored["nodes/dwoje"] = {
    type: "person",
    name: "Michał Nowak",
    published: true,
  };
  stored["edges/e-1961"] = {
    source: "dwoje",
    target: "szpital",
    type: "employed",
    name: "Dyrektor",
    start_date: "2015-01-01",
  };
  stored["edges/e-1972"] = {
    source: "dwoje",
    target: "gmina",
    type: "employed",
    name: "Radny",
    start_date: "2018-01-01",
  };
}

describe("api/nodes/split", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stored = {};
    generated = 0;
    globalThis.useStorage = () => ({ clear: mockCacheClear }) as never;
    onePageForTwoHumans();
    request({
      node_id: "dwoje",
      reason: "Dwie osoby o tym samym imieniu i nazwisku",
      edge_ids: ["e-1972"],
      into_person: { name: "Michał Nowak (ur. 1972)" },
    });
  });

  describe("marking a page without taking it apart", () => {
    it("records who said it is two people, and touches nothing else", async () => {
      // Noticing that a page is two people takes a moment; telling their forty
      // relations apart takes an afternoon, and the two rarely happen together.
      request({
        node_id: "dwoje",
        reason: "Dwie osoby o tym samym nazwisku",
        mark_only: true,
      });

      const result = await handler({} as never);

      expect(wrote("nodes/dwoje")).toEqual({
        needs_split: {
          reason: "Dwie osoby o tym samym nazwisku",
          at: expect.any(String),
          user: "admin-uid",
        },
      });
      expect(result).toMatchObject({ marked: true, applied: true });
      // No relation moved, and no second page invented for them.
      expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
      expect(mockBatchSet.mock.calls.map((call) => call[0])).toEqual([
        "audit/generated-1",
      ]);
    });

    it("stamps the mark with a readable time", async () => {
      request({ node_id: "dwoje", reason: "Powód", mark_only: true });

      await handler({} as never);

      const mark = (wrote("nodes/dwoje") as { needs_split: { at: string } })
        .needs_split;
      expect(Number.isNaN(Date.parse(mark.at))).toBe(false);
    });

    it("files the mark as a split in the audit log", async () => {
      request({ node_id: "dwoje", reason: "Powód", mark_only: true });

      await handler({} as never);

      expect(writtenTo("audit/")).toMatchObject({
        action: "split",
        collection: "nodes",
        target_id: "dwoje",
        user: "admin-uid",
        reason: "Powód",
      });
    });

    it("writes nothing for a marking dry run", async () => {
      request({
        node_id: "dwoje",
        reason: "Powód",
        mark_only: true,
        dry_run: true,
      });

      const result = await handler({} as never);

      expect(result).toMatchObject({ marked: true, applied: false });
      expect(mockBatchUpdate).not.toHaveBeenCalled();
      expect(mockBatchSet).not.toHaveBeenCalled();
      expect(mockCommit).not.toHaveBeenCalled();
    });
  });

  describe("taking the page apart", () => {
    it("creates the second person and moves only the relations named", async () => {
      // Everything not listed stays put: a relation nobody has attributed is
      // still evidence about the page it was found on.
      const result = await handler({} as never);

      expect(result.created_into).toBe(true);
      expect(result.into_id).toBe("generated-1");
      expect(wrote("nodes/generated-1")).toMatchObject({
        name: "Michał Nowak (ur. 1972)",
        type: "person",
        // A draft: whoever splits checks it reads right before anybody sees it.
        published: false,
      });
      expect(wrote("edges/e-1972")).toEqual({ source: "generated-1" });
      expect(wrote("edges/e-1961")).toBeUndefined();
      expect(result.counts).toMatchObject({ moved: 1 });
    });

    it("approves the new page as it writes it", async () => {
      // An admin separating two people has reviewed the one they are
      // describing; the review queue is for claims somebody disagrees with.
      await handler({} as never);

      expect(writtenTo("revisions/")).toMatchObject({
        node_id: "generated-1",
        collection: "nodes",
        status: "approved",
        review_user: "admin-uid",
      });
    });

    it("moves them onto a page an admin already made by hand", async () => {
      // The usual case: noticing the collapse and creating the second person
      // is one sitting.
      stored["nodes/druga"] = { type: "person", name: "Michał Nowak" };
      request({
        node_id: "dwoje",
        reason: "Dwie osoby",
        edge_ids: ["e-1972"],
        into_id: "druga",
      });

      const result = await handler({} as never);

      expect(result).toMatchObject({ into_id: "druga", created_into: false });
      expect(wrote("edges/e-1972")).toEqual({ source: "druga" });
      // Nothing was invented: the only node written is the one being split.
      expect(mockBatchSet.mock.calls.map((call) => call[0])).not.toContain(
        "nodes/generated-1",
      );
    });

    it("moves an inbound relation by its other end", async () => {
      stored["edges/e-artykul"] = {
        source: "artykul",
        target: "dwoje",
        type: "mentions",
      };
      stored["nodes/druga"] = { type: "person", name: "Michał Nowak" };
      request({
        node_id: "dwoje",
        reason: "Dwie osoby",
        edge_ids: ["e-artykul"],
        into_id: "druga",
      });

      await handler({} as never);

      expect(wrote("edges/e-artykul")).toEqual({ target: "druga" });
    });

    it("leaves a relation the destination already states where it is", async () => {
      // This is a split, and the case for removing a relation is the merge's
      // case, which nobody has made here.
      stored["nodes/druga"] = { type: "person", name: "Michał Nowak" };
      stored["edges/e-druga"] = {
        source: "druga",
        target: "gmina",
        type: "employed",
        name: "Radny",
        start_date: "2018-01-01",
      };
      request({
        node_id: "dwoje",
        reason: "Dwie osoby",
        edge_ids: ["e-1972"],
        into_id: "druga",
      });

      const result = await handler({} as never);

      expect(result.counts).toMatchObject({ collapsed: 1, moved: 0 });
      expect(wrote("edges/e-1972")).toBeUndefined();
      expect(wrote("edges/e-druga")).toBeUndefined();
    });

    it("answers the mark it was made against", async () => {
      stored["nodes/dwoje"] = {
        type: "person",
        name: "Michał Nowak",
        needs_split: { reason: "Dwie osoby", at: "2026-08-01", user: "u" },
      };

      await handler({} as never);

      expect(wrote("nodes/dwoje")).toEqual({ needs_split: "<delete>" });
    });

    it("files the split naming the page the relations went to", async () => {
      await handler({} as never);

      expect(writtenTo("audit/")).toMatchObject({
        action: "split",
        collection: "nodes",
        target_id: "dwoje",
        user: "admin-uid",
        reason: "Dwie osoby o tym samym imieniu i nazwisku",
        merge: { into: "generated-1", moved: ["e-1972"], collapsed: [] },
      });
    });

    it("drops the cached pages, which still draw both careers as one person", async () => {
      await handler({} as never);

      expect(mockCacheClear).toHaveBeenCalledWith("nitro:handlers");
    });

    it("writes nothing at all for a dry run", async () => {
      request({
        node_id: "dwoje",
        reason: "Dwie osoby",
        edge_ids: ["e-1972"],
        into_person: { name: "Michał Nowak (ur. 1972)" },
        dry_run: true,
      });

      const result = await handler({} as never);

      expect(result).toMatchObject({ applied: false, created_into: true });
      expect(result.edges).toMatchObject([
        { edge_id: "e-1972", disposition: "moved" },
      ]);
      expect(mockBatchUpdate).not.toHaveBeenCalled();
      expect(mockBatchSet).not.toHaveBeenCalled();
      expect(mockCommit).not.toHaveBeenCalled();
      expect(mockCacheClear).not.toHaveBeenCalled();
    });
  });

  describe("what it refuses", () => {
    it("refuses a relation that does not belong to this page", async () => {
      // An id from a stale dialog could name a relation that has since moved,
      // and re-pointing that one would take a fact off a third page.
      stored["edges/e-obcy"] = {
        source: "ktos-inny",
        target: "gmina",
        type: "employed",
      };
      request({
        node_id: "dwoje",
        reason: "Dwie osoby",
        edge_ids: ["e-obcy"],
        into_person: { name: "Michał Nowak (ur. 1972)" },
      });

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it("refuses to split a page onto itself", async () => {
      request({
        node_id: "dwoje",
        reason: "Dwie osoby",
        edge_ids: ["e-1972"],
        into_id: "dwoje",
      });

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it("refuses a destination that does not exist", async () => {
      request({
        node_id: "dwoje",
        reason: "Dwie osoby",
        edge_ids: ["e-1972"],
        into_id: "nie-ma-takiej",
      });

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("refuses a split with nowhere to put the relations", async () => {
      request({ node_id: "dwoje", reason: "Dwie osoby", edge_ids: ["e-1972"] });

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it("refuses both an existing page and a new one at once", async () => {
      stored["nodes/druga"] = { type: "person", name: "Michał Nowak" };
      request({
        node_id: "dwoje",
        reason: "Dwie osoby",
        edge_ids: ["e-1972"],
        into_id: "druga",
        into_person: { name: "Michał Nowak (ur. 1972)" },
      });

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it("refuses an id that names no page", async () => {
      delete stored["nodes/dwoje"];

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it("sends a merged-away page back to the one that survived it", async () => {
      // Splitting the page a reader never reaches would move relations off a
      // document nothing renders.
      stored["nodes/dwoje"] = {
        type: "person",
        name: "Michał Nowak",
        merged_into: "surv",
      };

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it("is refused to everyone but an admin", async () => {
      vi.mocked(requireAdmin).mockRejectedValueOnce({ statusCode: 403 });

      await expect(handler({} as never)).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(mockCommit).not.toHaveBeenCalled();
    });
  });
});
