import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/notes/admin.get";
import { resetNoteNodeNames } from "../../../server/utils/notes";
import type { NoteRow } from "../../../shared/model";

const { mockGetUser, mockNotesGet, mockGetAll, mockRevisionsGet } = vi.hoisted(
  () => {
    (globalThis as Record<string, unknown>).createError = (opts: {
      statusCode: number;
      message?: string;
    }) => Object.assign(new Error(opts.message), opts);

    return {
      mockGetUser: vi.fn(),
      mockNotesGet: vi.fn(),
      mockGetAll: vi.fn(),
      mockRevisionsGet: vi.fn(),
    };
  },
);

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    getValidatedQuery: async (
      event: { query: unknown },
      parser: (q: unknown) => unknown,
    ) => parser(event.query),
  };
});

vi.mock("~~/server/utils/auth", () => ({ getUser: mockGetUser }));

vi.mock("firebase-admin/firestore", () => {
  const revisionsQuery = {
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    get: mockRevisionsGet,
  };
  revisionsQuery.where.mockReturnValue(revisionsQuery);
  revisionsQuery.orderBy.mockReturnValue(revisionsQuery);
  revisionsQuery.limit.mockReturnValue(revisionsQuery);

  return {
    getFirestore: () => ({
      collection: (name: string) =>
        name === "notes"
          ? { get: mockNotesGet }
          : name === "revisions"
            ? revisionsQuery
            : { doc: (id: string) => ({ id }) },
      getAll: mockGetAll,
    }),
  };
});

const callHandler = (query: Record<string, unknown> = {}) =>
  (handler as unknown as (event: unknown) => Promise<unknown>)({ query });

type Result = { notes: NoteRow[]; total: number };

const noteDoc = (
  id: string,
  data: Record<string, unknown>,
  updateTime = "2026-01-01T00:00:00.000Z",
) => ({ id, data: () => data, updateTime });

const nodeDoc = (id: string, name: string, type = "person") => ({
  id,
  data: () => ({ name, type }),
});

describe("/api/notes/admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNoteNodeNames();
    mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });
    mockNotesGet.mockResolvedValue({ docs: [] });
    mockGetAll.mockResolvedValue([]);
    mockRevisionsGet.mockResolvedValue({ docs: [] });
  });

  it("rejects callers without the admin claim", async () => {
    mockGetUser.mockResolvedValue({ uid: "user-1" });

    await expect(callHandler()).rejects.toMatchObject({ statusCode: 403 });
    expect(mockNotesGet).not.toHaveBeenCalled();
  });

  it("flattens each source into its own row, newest first", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-old", {
          nodeId: "node-1",
          userUid: "user-a",
          updatedAt: "2026-01-02T00:00:00.000Z",
          sources: [
            { note: "pierwsza", url: "https://a.example" },
            { note: "druga", kind: "change_request" },
          ],
        }),
        noteDoc("note-new", {
          nodeId: "node-2",
          userUid: "user-b",
          updatedAt: "2026-03-01T00:00:00.000Z",
          sources: [{ note: "inna" }],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([
      nodeDoc("node-1", "Jan Testowy", "person"),
      nodeDoc("node-2", "Spółka Testowa", "place"),
    ]);

    const result = (await callHandler()) as Result;

    expect(result.total).toBe(3);
    expect(result.notes[0]).toMatchObject({
      key: "note-new:0",
      nodeName: "Spółka Testowa",
      nodeType: "place",
      userUid: "user-b",
    });
    expect(result.notes[1]).toEqual({
      key: "note-old:0",
      noteId: "note-old",
      sourceIndex: 0,
      nodeId: "node-1",
      nodeName: "Jan Testowy",
      nodeType: "person",
      userUid: "user-a",
      updatedAt: "2026-01-02T00:00:00.000Z",
      note: "pierwsza",
      url: "https://a.example",
      // Entries written before kinds existed read back as sources.
      kind: "source",
      adminStatus: null,
      adminType: null,
    });
    expect(result.notes[2]).toMatchObject({ kind: "change_request" });
  });

  it("falls back to the document write time when a note has no updatedAt", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc(
          "legacy",
          { nodeId: "node-1", userUid: "user-a", sources: [{ note: "stara" }] },
          "2025-06-01T10:00:00.000Z",
        ),
      ],
    });

    const result = (await callHandler()) as Result;

    expect(result.notes[0]?.updatedAt).toBe("2025-06-01T10:00:00.000Z");
  });

  it("resolves names of nodes that only exist as a proposed revision", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "proposed-1",
          userUid: "user-a",
          sources: [{ note: "o kimś nowym" }],
        }),
      ],
    });
    // Absent from `nodes`, so `getAll` returns a snapshot with no data.
    mockGetAll.mockResolvedValue([{ id: "proposed-1", data: () => undefined }]);
    mockRevisionsGet.mockResolvedValue({
      docs: [
        { data: () => ({ data: { name: "Nowa Osoba", type: "person" } }) },
      ],
    });

    const result = (await callHandler()) as Result;

    expect(result.notes[0]).toMatchObject({
      nodeName: "Nowa Osoba",
      nodeType: "person",
    });
  });

  it("filters by kind, node type and triage state", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "node-1",
          userUid: "user-a",
          sources: [
            { note: "źródło" },
            { note: "poprawka", kind: "change_request" },
            {
              note: "załatwione",
              kind: "change_request",
              adminStatus: "resolved",
              adminType: "missing_data",
            },
          ],
        }),
        noteDoc("note-2", {
          nodeId: "node-2",
          userUid: "user-b",
          sources: [{ note: "o spółce", kind: "change_request" }],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([
      nodeDoc("node-1", "Jan Testowy", "person"),
      nodeDoc("node-2", "Spółka Testowa", "place"),
    ]);

    const byKind = (await callHandler({ kind: "change_request" })) as Result;
    expect(byKind.total).toBe(3);

    const byNodeType = (await callHandler({ nodeType: "place" })) as Result;
    expect(byNodeType.notes.map((n) => n.note)).toEqual(["o spółce"]);

    // "none" is the queue of entries nobody has looked at yet.
    const untriaged = (await callHandler({ status: "none" })) as Result;
    expect(untriaged.total).toBe(3);

    const resolved = (await callHandler({ status: "resolved" })) as Result;
    expect(resolved.notes.map((n) => n.note)).toEqual(["załatwione"]);

    const byAdminType = (await callHandler({
      adminType: "missing_data",
    })) as Result;
    expect(byAdminType.notes.map((n) => n.note)).toEqual(["załatwione"]);
  });

  it("searches the note, its url and the name of the node it is on", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "node-1",
          userUid: "user-a",
          sources: [
            { note: "coś o przetargu" },
            { note: "bez związku", url: "https://przetargi.example" },
            { note: "trzecia" },
          ],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([nodeDoc("node-1", "Jan Testowy")]);

    const byText = (await callHandler({ q: "PRZETARG" })) as Result;
    expect(byText.total).toBe(2);

    const byName = (await callHandler({ q: "testowy" })) as Result;
    expect(byName.total).toBe(3);
  });

  it("pages and sorts on a column the admin picked", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "node-1",
          userUid: "user-a",
          sources: [{ note: "a" }, { note: "b" }, { note: "c" }],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([nodeDoc("node-1", "Jan Testowy")]);

    const firstPage = (await callHandler({ limit: "2" })) as Result;
    expect(firstPage.notes).toHaveLength(2);
    expect(firstPage.total).toBe(3);

    const secondPage = (await callHandler({ limit: "2", page: "2" })) as Result;
    expect(secondPage.notes).toHaveLength(1);
    expect(secondPage.total).toBe(3);

    const sorted = (await callHandler({
      sortBy: "nodeName",
      sortDesc: "false",
    })) as Result;
    expect(sorted.notes[0]?.nodeName).toBe("Jan Testowy");
  });

  it("shows a note written since the last request", async () => {
    // The queue exists to triage notes as they arrive, so nothing may cache
    // the list itself - an empty read must not outlive the write after it.
    mockNotesGet.mockResolvedValue({ docs: [] });
    expect(((await callHandler()) as Result).total).toBe(0);

    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "node-1",
          userUid: "user-a",
          sources: [{ note: "świeża" }],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([nodeDoc("node-1", "Jan Testowy")]);

    const after = (await callHandler()) as Result;
    expect(after.notes.map((n) => n.note)).toEqual(["świeża"]);
  });

  it("resolves a node name once and reuses it across requests", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "node-1",
          userUid: "user-a",
          sources: [{ note: "a" }],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([nodeDoc("node-1", "Jan Testowy")]);

    await callHandler({ page: "1" });
    await callHandler({ page: "2" });
    await callHandler({ kind: "source" });

    // Re-read every time, joined once - the join is the expensive half.
    expect(mockNotesGet).toHaveBeenCalledTimes(3);
    expect(mockGetAll).toHaveBeenCalledTimes(1);
  });

  it("does not re-query a node id that resolved to nothing", async () => {
    mockNotesGet.mockResolvedValue({
      docs: [
        noteDoc("note-1", {
          nodeId: "ghost-1",
          userUid: "user-a",
          sources: [{ note: "o duchu" }],
        }),
      ],
    });
    mockGetAll.mockResolvedValue([{ id: "ghost-1", data: () => undefined }]);
    mockRevisionsGet.mockResolvedValue({ docs: [] });

    await callHandler();
    await callHandler();

    expect(mockRevisionsGet).toHaveBeenCalledTimes(1);
    const result = (await callHandler()) as Result;
    expect(result.notes[0]?.nodeName).toBeNull();
  });

  it("rejects a limit the page would never ask for", async () => {
    await expect(callHandler({ limit: "500" })).rejects.toThrow();
  });
});
