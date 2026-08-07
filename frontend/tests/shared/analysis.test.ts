import { describe, it, expect } from "vitest";
import {
  LOCAL_ENTITY_PREFIX,
  analysisRole,
  canDeleteAnalysis,
  canEditAnalysis,
  emptyAnalysis,
  isLocalEntityId,
} from "~~/shared/analysis";

const analysis = {
  ownerUid: "owner",
  members: {
    owner: "editor" as const,
    friend: "editor" as const,
    reader: "viewer" as const,
  },
};

describe("analysisRole", () => {
  it("gives the owner editor rights even without a members entry", () => {
    expect(analysisRole({ ownerUid: "owner", members: {} }, "owner")).toBe(
      "editor",
    );
  });

  it("reads the role out of the members map", () => {
    expect(analysisRole(analysis, "friend")).toBe("editor");
    expect(analysisRole(analysis, "reader")).toBe("viewer");
  });

  it("refuses somebody the analysis was never shared with", () => {
    expect(analysisRole(analysis, "stranger")).toBeNull();
    expect(analysisRole(analysis, undefined)).toBeNull();
    expect(analysisRole(null, "owner")).toBeNull();
  });

  it("treats an admin as an editor of every analysis", () => {
    expect(analysisRole(analysis, "stranger", true)).toBe("editor");
    // Even one they are not a member of at all, which is the moderation case.
    expect(analysisRole(analysis, undefined, true)).toBe("editor");
  });
});

describe("canEditAnalysis", () => {
  it("separates viewers from editors", () => {
    expect(canEditAnalysis(analysis, "friend")).toBe(true);
    expect(canEditAnalysis(analysis, "reader")).toBe(false);
    expect(canEditAnalysis(analysis, "stranger")).toBe(false);
  });
});

describe("canDeleteAnalysis", () => {
  it("is the owner and admins only - an editor cannot", () => {
    expect(canDeleteAnalysis(analysis, "owner")).toBe(true);
    expect(canDeleteAnalysis(analysis, "friend")).toBe(false);
    expect(canDeleteAnalysis(analysis, "friend", true)).toBe(true);
  });
});

describe("isLocalEntityId", () => {
  it("tells an analysis-only entity from a node in the base", () => {
    expect(isLocalEntityId(`${LOCAL_ENTITY_PREFIX}abc`)).toBe(true);
    // Firestore ids are opaque, so nothing about a real one may look local.
    expect(isLocalEntityId("aBcD1234")).toBe(false);
  });
});

describe("emptyAnalysis", () => {
  it("makes its creator the owner and its only member", () => {
    const created = emptyAnalysis("uid-1", "Sprawa X", "2026-08-07T10:00Z");

    expect(created.title).toBe("Sprawa X");
    expect(created.ownerUid).toBe("uid-1");
    expect(created.members).toEqual({ "uid-1": "editor" });
    // `memberUids` is what the list query filters on, so it has to repeat the
    // keys of `members` from the very first write.
    expect(created.memberUids).toEqual(["uid-1"]);
    expect(created.entities).toEqual([]);
    expect(created.depth).toBe(1);
  });
});
