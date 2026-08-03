import { describe, it, expect } from "vitest";
import {
  approvedRevisionId,
  pageIsPublic,
  revisionCollection,
  revisionIsPending,
} from "../../shared/model";

describe("pageIsPublic", () => {
  it("reads the explicit flag when there is one", () => {
    expect(pageIsPublic({ published: true })).toBe(true);
    expect(pageIsPublic({ published: false })).toBe(false);
  });

  it("keeps a page with no flag hidden", () => {
    // Until the backfill ran this fell back to the approved revision, so an
    // absent flag on an approved page meant public. Every document carries the
    // field now, and an absent one is a draft nobody has put live.
    expect(pageIsPublic({})).toBe(false);
  });

  it("ignores the approved revision entirely", () => {
    // Approval says what the page would show, publication says who may see it.
    // The two came apart deliberately, so `revision_id` no longer votes - it
    // is not even a field this function reads any more.
    const approvedButHidden = { published: false, revision_id: "revisions/r1" };
    expect(pageIsPublic(approvedButHidden)).toBe(false);
    expect(pageIsPublic({ published: true })).toBe(true);
  });

  it("an approved removal outranks everything", () => {
    expect(pageIsPublic({ deleted: true, published: true })).toBe(false);
  });
});

describe("revisionCollection", () => {
  it("uses the recorded collection", () => {
    expect(revisionCollection({ collection: "edges", data: {} })).toBe("edges");
    expect(revisionCollection({ collection: "nodes", data: {} })).toBe("nodes");
  });

  it("infers edges from a revision carrying both ends of a link", () => {
    // `node_id` is the target's id whatever the target is, so the shape of the
    // data is all the older revisions left to go on.
    expect(
      revisionCollection({ data: { source: "a", target: "b", type: "owns" } }),
    ).toBe("edges");
  });

  it("infers nodes for anything else", () => {
    expect(revisionCollection({ data: { name: "Jan", type: "person" } })).toBe(
      "nodes",
    );
    expect(revisionCollection({})).toBe("nodes");
  });
});

describe("revisionIsPending", () => {
  it("treats a revision written before statuses existed as waiting", () => {
    expect(revisionIsPending({})).toBe(true);
  });

  it("is done with a reviewed one either way", () => {
    expect(revisionIsPending({ status: "approved" })).toBe(false);
    expect(revisionIsPending({ status: "rejected" })).toBe(false);
    expect(revisionIsPending({ status: "pending" })).toBe(true);
  });
});

describe("approvedRevisionId", () => {
  it("reads every shape a revision_id arrives in", () => {
    expect(approvedRevisionId("revisions/r1")).toBe("r1");
    expect(approvedRevisionId({ path: "revisions/r1" })).toBe("r1");
    expect(approvedRevisionId({ id: "r1" })).toBe("r1");
    expect(approvedRevisionId(undefined)).toBeUndefined();
    expect(approvedRevisionId(null)).toBeUndefined();
  });
});
