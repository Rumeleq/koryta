import { describe, it, expect, vi, beforeEach } from "vitest";
import { baseNodeFields } from "../../../../server/utils/revisions";
import handler from "../../../../server/api/revisions/create.post";

const mockSet = vi.fn();
const mockCommit = vi.fn();
const mockDoc = vi.fn();
const mockDb = {
  collection: vi.fn(() => ({ doc: mockDoc })),
  batch: vi.fn(() => ({ set: mockSet, commit: mockCommit })),
};

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
  Timestamp: { now: () => "timestamp" },
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

vi.mock("../../../../server/utils/auth", () => ({
  getUser: vi.fn().mockResolvedValue({ uid: "test-user-id" }),
}));

vi.mock("../../../../server/utils/revisions", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../server/utils/revisions")
  >()),
  baseNodeFields: vi.fn().mockResolvedValue({}),
}));

const { mockReadBody } = vi.hoisted(() => {
  const mockReadBody = vi.fn();
  globalThis.readBody = mockReadBody;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.createError = (err: any) => err;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.defineEventHandler = (fn: any) => fn;
  return { mockReadBody };
});

/** The revision document the handler wrote. */
function writtenRevision() {
  return mockSet.mock.calls[0]![1];
}

describe("api/revisions/create, place edits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDoc.mockImplementation((id?: string) => ({ id: id ?? "generated-id" }));
  });

  it("records who answered the ownership question", async () => {
    // The marker is what stops the next company ingest, which has no way of
    // seeing a spółka akcyjna's shareholders, from writing its guess over this.
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "Małopolska Agencja Rozwoju Regionalnego",
      isPublic: false,
    });
    mockReadBody.mockResolvedValue({
      node_id: "marr",
      name: "Małopolska Agencja Rozwoju Regionalnego",
      isPublic: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).toMatchObject({
      type: "place",
      isPublic: true,
      isPublicSource: "manual",
    });
  });

  it("leaves an unanswered question unanswered", async () => {
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "Ministerstwo Infrastruktury",
    });
    mockReadBody.mockResolvedValue({
      node_id: "ministerstwo",
      name: "Ministerstwo Infrastruktury",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).not.toHaveProperty("isPublic");
    expect(writtenRevision().data).not.toHaveProperty("isPublicSource");
  });

  it("does not let a person edit smuggle in an ownership flag", async () => {
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "person",
      name: "Jan Kowalski",
    });
    mockReadBody.mockResolvedValue({
      node_id: "jan",
      name: "Jan Kowalski",
      isPublic: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).not.toHaveProperty("isPublic");
    expect(writtenRevision().data).not.toHaveProperty("isPublicSource");
  });

  it("keeps the fields it was not given", async () => {
    // A revision is a whole snapshot written with `set`, so anything the form
    // does not carry has to come from the stored node.
    vi.mocked(baseNodeFields).mockResolvedValueOnce({
      type: "place",
      name: "Tramwaje Śląskie",
      krsNumber: "0000145278",
      activity: ["49.31.Z"],
    });
    mockReadBody.mockResolvedValue({
      node_id: "tramwaje",
      name: "Tramwaje Śląskie",
      krsNumber: "0000145278",
      isPublic: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handler({} as any);

    expect(writtenRevision().data).toMatchObject({
      krsNumber: "0000145278",
      activity: { "0": "49.31.Z" },
    });
  });
});
