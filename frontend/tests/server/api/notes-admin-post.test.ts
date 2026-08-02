import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/notes/admin.post";
import type { NoteSource } from "../../../shared/model";

const { mockGetUser, mockDocGet, mockUpdate } = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).createError = (opts: {
    statusCode: number;
    message?: string;
  }) => Object.assign(new Error(opts.message), opts);

  return {
    mockGetUser: vi.fn(),
    mockDocGet: vi.fn(),
    mockUpdate: vi.fn(),
  };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    readValidatedBody: async (
      event: { body: unknown },
      parser: (b: unknown) => unknown,
    ) => parser(event.body),
  };
});

vi.mock("~~/server/utils/auth", () => ({ getUser: mockGetUser }));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => ({ doc: (id: string) => ({ id }) }),
    // The handler reads and writes the note inside a transaction; the sources
    // array it hands to `update` is what these tests are about.
    runTransaction: (fn: (tx: unknown) => Promise<void>) =>
      fn({ get: mockDocGet, update: mockUpdate }),
  }),
}));

const callHandler = (body: Record<string, unknown>) =>
  (handler as unknown as (event: unknown) => Promise<unknown>)({ body });

/** The note the handler will read, with the sources a test cares about. */
const seedNote = (sources: NoteSource[]) =>
  mockDocGet.mockResolvedValue({ exists: true, data: () => ({ sources }) });

/** The sources as they were written back. */
const written = (): NoteSource[] => mockUpdate.mock.calls.at(-1)?.[1].sources;

describe("POST /api/notes/admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ uid: "admin-1", admin: true });
  });

  it("rejects callers without the admin claim", async () => {
    mockGetUser.mockResolvedValue({ uid: "user-1" });

    await expect(
      callHandler({ noteId: "note-1", sourceIndex: 0, adminType: "context" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("writes the type onto the source the admin triaged", async () => {
    seedNote([{ note: "pierwsza" }, { note: "druga" }]);

    await callHandler({
      noteId: "note-1",
      sourceIndex: 1,
      adminType: "new_connection",
    });

    expect(written()[0]).toEqual({ note: "pierwsza" });
    expect(written()[1]).toMatchObject({ adminType: "new_connection" });
  });

  it("records that the phone queue could not classify an entry", async () => {
    seedNote([{ note: "za mało kontekstu" }]);

    await callHandler({
      noteId: "note-1",
      sourceIndex: 0,
      adminType: null,
      adminTypeDeferred: true,
    });

    expect(written()[0]).toEqual({
      note: "za mało kontekstu",
      adminTypeDeferred: true,
    });
  });

  it("clears the deferral once any view gives the entry a type", async () => {
    // Otherwise an entry classified in the table would keep asking the table
    // to classify it.
    seedNote([{ note: "oceniona w tabeli", adminTypeDeferred: true }]);

    await callHandler({
      noteId: "note-1",
      sourceIndex: 0,
      adminType: "missing_data",
    });

    expect(written()[0]).toEqual({
      note: "oceniona w tabeli",
      adminType: "missing_data",
    });
  });

  it("leaves a field the caller did not mention alone", async () => {
    seedNote([
      { note: "a", adminStatus: "unresolved", adminTypeDeferred: true },
    ]);

    await callHandler({
      noteId: "note-1",
      sourceIndex: 0,
      adminStatus: "resolved",
    });

    expect(written()[0]).toEqual({
      note: "a",
      adminStatus: "resolved",
      adminTypeDeferred: true,
    });
  });

  it("404s on a source that is not there", async () => {
    seedNote([{ note: "jedyna" }]);

    await expect(
      callHandler({ noteId: "note-1", sourceIndex: 3, adminType: "other" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
