import { describe, it, expect } from "vitest";
import {
  isPublicInstitution,
  nodeOwnershipUpdate,
} from "../../scripts/migrate/seed-public-institutions";

describe("isPublicInstitution", () => {
  it("covers the bodies that have no KRS entry to scrape", () => {
    for (const name of [
      "Departament Kontroli woj. mazowieckiego",
      "WFOŚiGW Katowice",
      "WFOŚIGW Gdańsk",
      "NFOŚiGW",
      "Krajowy Ośrodek Wsparcia Rolnictwa",
      "Zarząd Transportu Miejskiego (ZTM) w Warszawie",
      "ZGN Praga-Południe",
    ]) {
      expect(isPublicInstitution(name), name).toBe(true);
    }
  });

  it("leaves anything short of certain alone", () => {
    // A wrong `true` inflates the public-sector experience of everyone who
    // worked there, so a name that only hints at the state does not qualify.
    // The state-owned companies here do have a KRS entry - these no-KRS nodes
    // are drafts duplicating a scraped one, and deduplication is their fix.
    for (const name of [
      "Orlen",
      "Enea",
      "Polska Grupa Zbrojeniowa",
      "Instytut Strategie 2050",
      "PSL Białołęka",
      "Sok z buraka",
      "Łódzka specjalna Strefa Ekonomiczna",
      "Towarzystwo Budownictwa Społecznego w Zgierzu",
      undefined,
      "",
    ]) {
      expect(isPublicInstitution(name), String(name)).toBe(false);
    }
  });

  it("matches a prefix, not a substring", () => {
    // "Fundacja Promocji Kultury Miasta Krakowa" is not Miasto Kraków.
    expect(
      isPublicInstitution("Fundacja Promocji Kultury Miasta Krakowa"),
    ).toBe(false);
  });
});

describe("nodeOwnershipUpdate", () => {
  it("touches nothing but the ownership answer", () => {
    // This ran against production writing the revision snapshot over the node,
    // which deleted every field a revision leaves out. Losing `stats` took 37
    // institutions out of /api/search - it orders by `stats.nodeGroupSize`, and
    // Firestore returns no document missing the field it orders on - so
    // WFOŚiGW, Departament and Urząd entries could not be found at all.
    expect(Object.keys(nodeOwnershipUpdate()).sort()).toEqual([
      "isPublic",
      "isPublicSource",
    ]);
    for (const field of [
      "stats",
      "revisions",
      "votes",
      "nameChunksLower",
      "name",
      "krsNumber",
    ]) {
      expect(nodeOwnershipUpdate({ id: "rev1" })).not.toHaveProperty(field);
    }
  });

  it("records the answer as a human one", () => {
    // What stops the next company ingest, which cannot see a spółka akcyjna's
    // shareholders, from writing its own guess over this.
    expect(nodeOwnershipUpdate()).toMatchObject({
      isPublic: true,
      isPublicSource: "manual",
    });
  });

  it("republishes a node that was published, and only that one", () => {
    // A node with no current revision is an unapproved draft, and marking its
    // owner must not publish it.
    expect(nodeOwnershipUpdate({ id: "rev1" }).revision_id).toEqual({
      id: "rev1",
    });
    expect(nodeOwnershipUpdate()).not.toHaveProperty("revision_id");
  });
});
