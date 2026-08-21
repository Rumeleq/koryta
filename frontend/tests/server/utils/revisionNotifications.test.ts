import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { notifyRevisionReviewed } from "../../../server/utils/revisionNotifications";
import { notifyUser } from "../../../server/utils/notifications";

vi.mock("../../../server/utils/notifications", () => ({
  notifyUser: vi.fn(async () => "sent"),
}));

/** Documents the fake Firestore holds, keyed by `<collection>/<id>`. */
let stored: Record<string, Record<string, unknown> | undefined> = {};

function docRef(collection: string, id: string) {
  return {
    id,
    parent: { id: collection },
    get: async () => ({ data: () => stored[`${collection}/${id}`] }),
  } as unknown as DocumentReference;
}

const mockDb = {
  collection: (collection: string) => ({
    doc: (id: string) => docRef(collection, id),
  }),
} as unknown as Firestore;

/** The event `notifyUser` was handed. */
function queued() {
  return vi.mocked(notifyUser).mock.calls[0]!;
}

function approve(
  revision: Record<string, unknown>,
  targetRef = docRef("nodes", "node-1"),
) {
  return notifyRevisionReviewed(mockDb, {
    decision: "approved",
    published: true,
    revisionId: "rev-1",
    revision,
    targetRef,
    reviewerUid: "admin-uid",
    siteUrl: "https://koryta.pl",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stored = {};
});

describe("notifyRevisionReviewed", () => {
  it("writes to the author, about the page they changed", async () => {
    await approve({
      update_user: "author-uid",
      data: { name: "Jan Kowalski", type: "person" },
    });

    const [, uid, event, options] = queued();
    expect(uid).toBe("author-uid");
    expect(event).toMatchObject({
      kind: "revisionApproved",
      published: true,
      target: { name: "Jan Kowalski", path: "/osoba/jan-kowalski-node-1" },
    });
    // So the reviewer is not mailed about approving their own edit, and so a
    // re-approval of the same revision does not send a second time.
    expect(options).toMatchObject({
      actorUid: "admin-uid",
      dedupeKey: "rev-1",
    });
  });

  it("carries the reason through a rejection", async () => {
    stored["nodes/node-1"] = { name: "Jan Kowalski", type: "person" };

    await notifyRevisionReviewed(mockDb, {
      decision: "rejected",
      reason: "brak źródła",
      revisionId: "rev-1",
      revision: { update_user: "author-uid", data: {} },
      targetRef: docRef("nodes", "node-1"),
      reviewerUid: "admin-uid",
      siteUrl: "https://koryta.pl",
    });

    expect(queued()[2]).toMatchObject({
      kind: "revisionRejected",
      reason: "brak źródła",
      target: { name: "Jan Kowalski" },
    });
  });

  it("re-sends a rejection whose reason has changed, but not one repeated", async () => {
    // Approving twice is one decision restated, so it dedupes on the revision
    // alone. Turning the same suggestion down again with a better explanation
    // is something the author has not been told, so the reason is part of the
    // key.
    const reject = (reason: string) =>
      notifyRevisionReviewed(mockDb, {
        decision: "rejected",
        reason,
        revisionId: "rev-1",
        revision: { update_user: "author-uid", data: { name: "X" } },
        targetRef: docRef("nodes", "node-1"),
        reviewerUid: "admin-uid",
        siteUrl: "https://koryta.pl",
      });

    await reject("brak źródła");
    await reject("brak źródła");
    await reject("źródło nie potwierdza daty");

    const keys = vi
      .mocked(notifyUser)
      .mock.calls.map((call) => call[3].dedupeKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[2]).toContain("rev-1");
  });

  it("keys an approval on the revision alone", async () => {
    await approve({
      update_user: "author-uid",
      data: { name: "X", type: "person" },
    });

    expect(queued()[3]).toMatchObject({ dedupeKey: "rev-1" });
  });

  it("says nothing to a pipeline", async () => {
    // `update_user` on an automatic revision is a service account, and nobody
    // is waiting on the answer.
    expect(
      await approve({
        update_user: "datascience-sa",
        update_automatic: true,
        data: { name: "X", type: "person" },
      }),
    ).toBe("no-recipient");
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("has nobody to write to when the revision predates update_user", async () => {
    expect(await approve({ data: { name: "X", type: "person" } })).toBe(
      "no-recipient",
    );
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it("prefers the name being proposed over the one on the page", async () => {
    // A rename is the change most likely to be under review; quoting the old
    // name back at the author describes the wrong edit.
    stored["nodes/node-1"] = { name: "Jan Kowaski", type: "person" };

    await approve({
      update_user: "author-uid",
      data: { name: "Jan Kowalski", type: "person" },
    });

    expect(queued()[2]).toMatchObject({
      target: { name: "Jan Kowalski" },
    });
  });

  it("fills the gaps in a partial revision from the stored document", async () => {
    // The ingest endpoints write revisions carrying only the fields they know.
    stored["nodes/node-1"] = { name: "Jan Kowalski", type: "person" };

    await approve({
      update_user: "author-uid",
      data: { content: "nowy opis" },
    });

    expect(queued()[2]).toMatchObject({
      target: { name: "Jan Kowalski", path: "/osoba/jan-kowalski-node-1" },
    });
  });

  it("describes a relation by the node at its source", async () => {
    // An edge has no page of its own, and its name is a job title that means
    // nothing on its own.
    stored["nodes/person-1"] = { name: "Jan Kowalski", type: "person" };

    await approve(
      {
        update_user: "author-uid",
        data: {
          name: "Członek zarządu",
          source: "person-1",
          target: "place-1",
        },
      },
      docRef("edges", "edge-1"),
    );

    expect(queued()[2]).toMatchObject({
      target: { name: "Jan Kowalski", path: "/osoba/jan-kowalski-person-1" },
    });
  });

  it("finds the source of an edge revision that does not restate it", async () => {
    stored["edges/edge-1"] = { source: "person-1", target: "place-1" };
    stored["nodes/person-1"] = { name: "Jan Kowalski", type: "person" };

    await approve(
      { update_user: "author-uid", data: { end_date: "2024-01-01" } },
      docRef("edges", "edge-1"),
    );

    expect(queued()[2]).toMatchObject({
      target: { name: "Jan Kowalski" },
    });
  });

  it("still writes when there is no page to link to", async () => {
    // A node created by this very revision has nothing stored yet; the author
    // should hear the verdict regardless.
    await approve({ update_user: "author-uid", data: {} });

    expect(queued()[2]).toMatchObject({
      target: { name: "node-1", path: undefined },
    });
  });
});
