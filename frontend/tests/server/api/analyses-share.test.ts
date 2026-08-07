import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/analyses/share.post";

const { mockGetUserByEmail, mockGetUser, mockDoc, mockUpdate, mockGet } =
  vi.hoisted(() => {
    // Nitro auto-imports createError in server handlers; stub it for tests.
    (globalThis as Record<string, unknown>).createError = (opts: {
      statusCode: number;
      message?: string;
    }) => Object.assign(new Error(opts.message), opts);

    return {
      mockGetUserByEmail: vi.fn(),
      mockGetUser: vi.fn(),
      mockDoc: vi.fn(),
      mockUpdate: vi.fn(),
      mockGet: vi.fn(),
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

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUserByEmail: mockGetUserByEmail }),
}));

vi.mock("firebase-admin/app", () => ({ getApp: vi.fn() }));

// Stubbed at the firestore layer rather than at `analysesCollection`, so that
// `requireAnalysis` - the membership check this endpoint leans on - runs for
// real. It calls the collection helper through the module's own binding, which
// a partial module mock would not replace.
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: () => ({ doc: mockDoc }) }),
  FieldValue: {
    delete: () => "__delete__",
    arrayUnion: (value: string) => ({ arrayUnion: value }),
    arrayRemove: (value: string) => ({ arrayRemove: value }),
  },
}));

vi.mock("~~/server/utils/auth", () => ({ getUser: mockGetUser }));

const analysis = {
  ownerUid: "owner",
  members: { owner: "editor", reader: "viewer" },
  memberUids: ["owner", "reader"],
};

const call = (body: unknown) =>
  (handler as unknown as (event: unknown) => Promise<unknown>)({ body });

describe("/api/analyses/share", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ exists: true, id: "a1", data: () => analysis });
    mockDoc.mockReturnValue({ get: mockGet, update: mockUpdate });
    mockGetUserByEmail.mockResolvedValue({
      uid: "invited",
      displayName: "Ewa",
      email: "ewa@example.com",
    });
  });

  it("adds a member, keeping members and memberUids in step", async () => {
    mockGetUser.mockResolvedValue({ uid: "owner" });

    const result = await call({
      id: "a1",
      email: "ewa@example.com",
      role: "editor",
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        "members.invited": "editor",
        memberUids: { arrayUnion: "invited" },
      }),
    );
    expect(result).toMatchObject({ uid: "invited", role: "editor" });
  });

  it("lets an editor share, since a case is worked on together", async () => {
    mockGetUser.mockResolvedValue({ uid: "owner" });
    mockGet.mockResolvedValue({
      exists: true,
      id: "a1",
      data: () => ({
        ...analysis,
        ownerUid: "somebody-else",
        members: { ...analysis.members, owner: "editor" },
      }),
    });

    await expect(
      call({ id: "a1", email: "ewa@example.com", role: "viewer" }),
    ).resolves.toBeTruthy();
  });

  it("refuses a viewer", async () => {
    mockGetUser.mockResolvedValue({ uid: "reader" });

    await expect(
      call({ id: "a1", email: "ewa@example.com", role: "editor" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("tells a stranger the analysis does not exist", async () => {
    mockGetUser.mockResolvedValue({ uid: "stranger" });

    await expect(
      call({ id: "a1", email: "ewa@example.com", role: "editor" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("lets an admin share any analysis", async () => {
    mockGetUser.mockResolvedValue({ uid: "stranger", admin: true });

    await expect(
      call({ id: "a1", email: "ewa@example.com", role: "viewer" }),
    ).resolves.toBeTruthy();
  });

  it("says so when the address has no account here", async () => {
    mockGetUser.mockResolvedValue({ uid: "owner" });
    mockGetUserByEmail.mockRejectedValue(new Error("not found"));

    await expect(
      call({ id: "a1", email: "nikt@example.com", role: "editor" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("removes a member from both fields", async () => {
    mockGetUser.mockResolvedValue({ uid: "owner" });

    await call({ id: "a1", uid: "reader", role: null });

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        "members.reader": "__delete__",
        memberUids: { arrayRemove: "reader" },
      }),
    );
  });

  it("will not remove the owner, who is the only one who can delete it", async () => {
    mockGetUser.mockResolvedValue({ uid: "owner" });

    await expect(
      call({ id: "a1", uid: "owner", role: null }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("will not demote the owner to a viewer", async () => {
    mockGetUser.mockResolvedValue({ uid: "owner" });
    mockGetUserByEmail.mockResolvedValue({
      uid: "owner",
      email: "owner@example.com",
    });

    await expect(
      call({ id: "a1", email: "owner@example.com", role: "viewer" }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects a malformed address before touching anything", async () => {
    mockGetUser.mockResolvedValue({ uid: "owner" });

    await expect(
      call({ id: "a1", email: "nie-adres", role: "editor" }),
    ).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
