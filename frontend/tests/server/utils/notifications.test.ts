import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { notifyUser } from "../../../server/utils/notifications";
import { getAuth } from "firebase-admin/auth";
import type { NotificationEvent } from "../../../shared/notifications";

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: { now: () => "now" },
}));

const mockGetUser = vi.fn();
vi.mock("firebase-admin/auth", () => ({
  getAuth: vi.fn(() => ({ getUser: mockGetUser })),
}));

/** `users/<uid>` documents the fake Firestore holds. */
let users: Record<string, Record<string, unknown> | undefined> = {};
const mockCreate = vi.fn();

const mockDb = {
  collection: vi.fn((collection: string) => ({
    doc: vi.fn((id: string) => ({
      id,
      create: mockCreate,
      get: async () => ({
        exists: users[id] !== undefined,
        data: () => (collection === "users" ? users[id] : undefined),
      }),
    })),
  })),
} as unknown as Firestore;

const APPROVED: NotificationEvent = {
  kind: "revisionApproved",
  target: { name: "Jan Kowalski", path: "/osoba/jan-kowalski-n1" },
  published: true,
};

const OPTIONS = { dedupeKey: "rev-1", siteUrl: "https://koryta.pl" };

function call(event = APPROVED, options = {}) {
  return notifyUser(mockDb, "author-uid", event, { ...OPTIONS, ...options });
}

beforeEach(() => {
  vi.clearAllMocks();
  users = {};
  mockGetUser.mockResolvedValue({
    email: "autor@example.com",
    emailVerified: true,
  });
  mockCreate.mockResolvedValue(undefined);
  vi.mocked(getAuth).mockReturnValue({
    getUser: mockGetUser,
  } as unknown as ReturnType<typeof getAuth>);
});

describe("notifyUser", () => {
  it("queues a document the mail extension can deliver", async () => {
    expect(await call()).toBe("sent");

    const [written] = mockCreate.mock.calls[0]!;
    expect(written.to).toEqual(["autor@example.com"]);
    expect(written.message.subject).toContain("Jan Kowalski");
    expect(written.message.html).toContain("https://koryta.pl/osoba");
    // Our own bookkeeping, so a bounce in the console traces back to a cause.
    expect(written).toMatchObject({
      kind: "revisionApproved",
      uid: "author-uid",
    });
  });

  it("sends to a user who has never opened their settings", async () => {
    // These messages are about the recipient's own work, so silence is consent.
    expect(await call()).toBe("sent");
  });

  it("respects an opt out", async () => {
    users["author-uid"] = { notifications: { revisionApproved: false } };

    expect(await call()).toBe("opted-out");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("opting out of one kind leaves the other alone", async () => {
    users["author-uid"] = { notifications: { revisionApproved: false } };

    const rejected: NotificationEvent = {
      kind: "revisionRejected",
      target: { name: "Jan Kowalski" },
      reason: "brak źródła",
    };
    expect(await call(rejected)).toBe("sent");
  });

  it("refuses an address whose owner never proved they own it", async () => {
    // Anybody can register with anybody's email; without this, a stranger's
    // proposal turns an admin's review into unsolicited mail.
    mockGetUser.mockResolvedValue({
      email: "ktos@example.com",
      emailVerified: false,
    });

    expect(await call()).toBe("unverified-address");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("has nothing to do for an account with no email", async () => {
    mockGetUser.mockResolvedValue({ email: undefined, emailVerified: false });

    expect(await call()).toBe("no-address");
  });

  it("does not tell an admin what they just did themselves", async () => {
    expect(await call(APPROVED, { actorUid: "author-uid" })).toBe("self");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("sends once for the same decision", async () => {
    // Approving is idempotent and a double-clicked button is one decision, so
    // the document id is derived from the revision rather than generated.
    mockCreate.mockRejectedValueOnce({ code: 6 });

    expect(await call()).toBe("duplicate");
  });

  it("keys the queue document by kind and revision", async () => {
    const docs = vi.fn((id: string) => ({ id, create: mockCreate }));
    const db = {
      collection: vi.fn((collection: string) =>
        collection === "mail"
          ? { doc: docs }
          : { doc: () => ({ get: async () => ({ data: () => undefined }) }) },
      ),
    } as unknown as Firestore;

    await notifyUser(db, "author-uid", APPROVED, OPTIONS);

    expect(docs).toHaveBeenCalledWith("revisionApproved_rev-1");
  });

  it("never fails the action it is reporting on", async () => {
    // The approval is already committed by the time this runs; a Firestore
    // hiccup here must not turn a successful review into a 500.
    mockCreate.mockRejectedValue(new Error("firestore down"));

    await expect(call()).resolves.toBe("failed");
  });

  it("survives an auth lookup that throws", async () => {
    mockGetUser.mockRejectedValue(new Error("no such user"));

    await expect(call()).resolves.toBe("failed");
  });
});
