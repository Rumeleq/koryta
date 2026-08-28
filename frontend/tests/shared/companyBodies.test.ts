import { describe, it, expect } from "vitest";
import {
  supervisoryBodies,
  supervisoryBodyValues,
  supervisoryBodyTitle,
  bodyIsPaidPost,
  namesASupervisorySeat,
  displayRole,
} from "../../shared/companyBodies";

/** This module is the site's *vocabulary* of supervisory organs.
 *
 * Which institution has which organ is decided by the pipelines, in
 * `data/pipelines/src/entities/company_bodies.py`, and tested there against the
 * register's own `formaPrawna` spellings.
 */
describe("supervisoryBodies", () => {
  it("names the organs the site knows about", () => {
    expect(supervisoryBodies.map((b) => b.value)).toEqual([
      "rada-nadzorcza",
      "rada-spoleczna",
    ]);
  });

  it("gives every organ a Polish title", () => {
    for (const body of supervisoryBodies) {
      expect(body.title.trim().length).toBeGreaterThan(0);
      expect(body.title).not.toBe(body.value);
    }
  });

  it("has no duplicate values", () => {
    expect(new Set(supervisoryBodyValues).size).toBe(
      supervisoryBodyValues.length,
    );
  });
});

describe("supervisoryBodyTitle", () => {
  it("names an organ the site knows", () => {
    expect(supervisoryBodyTitle("rada-spoleczna")).toBe("Rada Społeczna");
    expect(supervisoryBodyTitle("rada-nadzorcza")).toBe("Rada Nadzorcza");
  });

  it("falls back to the stored value for one it does not", () => {
    // The pipelines and the site deploy separately, so a node can carry an
    // organ this build has never heard of - a cech's komisja rewizyjna, say.
    expect(supervisoryBodyTitle("komisja-rewizyjna")).toBe("komisja-rewizyjna");
  });
});

describe("bodyIsPaidPost", () => {
  it("treats a rada społeczna seat as unpaid", () => {
    expect(bodyIsPaidPost("rada-spoleczna")).toBe(false);
  });

  it("treats an ordinary supervisory board as a post", () => {
    expect(bodyIsPaidPost("rada-nadzorcza")).toBe(true);
  });

  it("counts anything unrecorded, which is every other company", () => {
    // The safe direction, the same one `Company.isPublic` errs in: an
    // institution nobody has classified keeps the numbers it had before this
    // module existed.
    expect(bodyIsPaidPost(undefined)).toBe(true);
    expect(bodyIsPaidPost(null)).toBe(true);
    expect(bodyIsPaidPost("")).toBe(true);
    expect(bodyIsPaidPost("komisja-rewizyjna")).toBe(true);
  });
});

describe("namesASupervisorySeat", () => {
  it("matches the role every stored supervisory seat carries", () => {
    // 9,848 of the 15,235 stored employment edges say exactly this.
    expect(namesASupervisorySeat("Rada Nadzorcza")).toBe(true);
  });

  it("matches the spellings a reviewer types by hand", () => {
    for (const role of [
      "rada nadzorcza",
      "Przewodniczący Rady Nadzorczej",
      "przewodniczący rady nadzorczej",
      "członek rady nadzorczej",
      "prezes rady nadzorczej",
    ]) {
      expect(namesASupervisorySeat(role)).toBe(true);
    }
  });

  it("matches a seat entered under the organ's real name", () => {
    expect(namesASupervisorySeat("Rada Społeczna")).toBe(true);
    expect(namesASupervisorySeat("członek rady społecznej")).toBe(true);
  });

  it("leaves management posts alone", () => {
    // Sixteen stored `Zarząd` edges point at SPZOZ hospitals, and every one of
    // them is the kierownik - a salaried director, not a council seat.
    for (const role of [
      "Zarząd",
      "zarząd",
      "prezes zarządu",
      "dyrektor",
      "Prokurent",
      "kierownik",
    ]) {
      expect(namesASupervisorySeat(role)).toBe(false);
    }
  });

  it("does not mistake an elected council or an adviser for a seat", () => {
    for (const role of [
      "rada powiatu",
      "radny dzielnicy",
      "radna",
      "przewodniczący rady",
      "kandydowała do rady",
      "doradca społeczny",
    ]) {
      expect(namesASupervisorySeat(role)).toBe(false);
    }
  });

  it("says nothing about an edge with no role", () => {
    expect(namesASupervisorySeat(undefined)).toBe(false);
    expect(namesASupervisorySeat(null)).toBe(false);
    expect(namesASupervisorySeat("")).toBe(false);
  });
});

describe("displayRole", () => {
  const hospital = { supervisoryBody: "rada-spoleczna" };

  it("puts the register's own word back on a hospital's seat", () => {
    expect(displayRole("Rada Nadzorcza", hospital)).toBe("Rada Społeczna");
    expect(displayRole("rada nadzorcza", hospital)).toBe("Rada Społeczna");
  });

  it("leaves a role somebody spelled out exactly as they typed it", () => {
    // Inflecting a reviewer's sentence into a different organ is putting words
    // in their mouth. All 892 stored SPZOZ seats carry the bare name anyway.
    expect(displayRole("Przewodniczący Rady Nadzorczej", hospital)).toBe(
      "Przewodniczący Rady Nadzorczej",
    );
  });

  it("leaves a management post at the same hospital alone", () => {
    expect(displayRole("Zarząd", hospital)).toBe("Zarząd");
  });

  it("leaves every other company's roles untouched", () => {
    expect(displayRole("Rada Nadzorcza", {})).toBe("Rada Nadzorcza");
    expect(displayRole("Rada Nadzorcza", undefined)).toBe("Rada Nadzorcza");
  });

  it("passes a missing role through", () => {
    expect(displayRole(undefined, hospital)).toBeUndefined();
    expect(displayRole("", hospital)).toBeUndefined();
  });
});
