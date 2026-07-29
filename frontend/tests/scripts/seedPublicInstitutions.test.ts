import { describe, it, expect } from "vitest";
import { isPublicInstitution } from "../../scripts/migrate/seed-public-institutions";

describe("isPublicInstitution", () => {
  it("covers the bodies that have no KRS entry to scrape", () => {
    for (const name of [
      "Ministerstwo Infrastruktury",
      "Departament Kontroli woj. mazowieckiego",
      "WFOŚiGW Katowice",
      "WFOŚIGW Gdańsk",
      "NFOŚiGW",
      "Miasto Kraków",
      "Województwo wielkopolskie",
      "Sejmik Mazowiecki",
      "Krajowy Ośrodek Wsparcia Rolnictwa",
      "Zarząd Transportu Miejskiego (ZTM) w Warszawie",
      "Rząd",
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
