import { describe, it, expect } from "vitest";
import { categoriesFromActivity } from "../../shared/companyCategories";

describe("categoriesFromActivity", () => {
  it("returns no categories for empty or missing activity", () => {
    expect(categoriesFromActivity(undefined)).toEqual([]);
    expect(categoriesFromActivity([])).toEqual([]);
  });

  it("tags hospitals by PKD 86.10", () => {
    expect(categoriesFromActivity(["86.10.Z"])).toEqual(["szpitale"]);
  });

  it("tags water and sewage companies by PKD 36.00 and 37.00", () => {
    expect(categoriesFromActivity(["36.00.Z"])).toEqual(["wodociagi"]);
    expect(categoriesFromActivity(["37.00.Z"])).toEqual(["wodociagi"]);
  });

  it("tags railways by PKD 49.10, 49.20 and 42.12", () => {
    expect(categoriesFromActivity(["49.10.Z"])).toEqual(["koleje"]);
    expect(categoriesFromActivity(["49.20.Z"])).toEqual(["koleje"]);
    expect(categoriesFromActivity(["42.12.Z"])).toEqual(["koleje"]);
  });

  it("matches any code on the list, not just the main activity", () => {
    expect(categoriesFromActivity(["68.20.Z", "86.10.Z"])).toEqual([
      "szpitale",
    ]);
  });

  it("ignores unrelated PKD codes", () => {
    expect(categoriesFromActivity(["68.20.Z", "68.32.Z"])).toEqual([]);
    // 86.21 (medical practice) is not a hospital
    expect(categoriesFromActivity(["86.21.Z"])).toEqual([]);
    // 52.21 (support activities for land transport) and 49.31 (urban and
    // suburban transport) both cover roads and buses, so neither is rail
    expect(categoriesFromActivity(["52.21.Z"])).toEqual([]);
    expect(categoriesFromActivity(["49.31.Z"])).toEqual([]);
  });

  it("can return more than one category", () => {
    expect(categoriesFromActivity(["49.10.Z", "36.00.Z"])).toEqual([
      "wodociagi",
      "koleje",
    ]);
  });
});
