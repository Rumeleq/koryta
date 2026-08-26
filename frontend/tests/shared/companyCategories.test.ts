import { describe, it, expect } from "vitest";
import {
  companyCategories,
  companyCategoryValues,
  categoryFilterUrl,
  categoryTitle,
  isKnownCategory,
} from "../../shared/companyCategories";

/** This module is the site's *vocabulary* of sectors, nothing more.
 *
 * Which company belongs to which sector is decided by the pipelines, in
 * `data/pipelines/src/entities/company_categories.py`, and tested there against
 * real KRS numbers - see `entities/tests/test_company_categories.py`. It used
 * to be decided here by matching PKD prefixes, and the tests that pinned that
 * moved with the logic.
 */
describe("companyCategories", () => {
  it("offers the three sectors the filter knows about", () => {
    expect(companyCategories.map((c) => c.value)).toEqual([
      "szpitale",
      "wodociagi",
      "koleje",
    ]);
  });

  it("gives every category a Polish title", () => {
    for (const category of companyCategories) {
      expect(category.title.trim().length).toBeGreaterThan(0);
      expect(category.title).not.toBe(category.value);
    }
  });

  it("has no duplicate values", () => {
    expect(new Set(companyCategoryValues).size).toBe(
      companyCategoryValues.length,
    );
  });

  it("exposes the values as a non-empty tuple, which z.enum needs", () => {
    expect(companyCategoryValues.length).toBeGreaterThan(0);
    expect(companyCategoryValues).toEqual(
      companyCategories.map((c) => c.value),
    );
  });
});

describe("categoryTitle", () => {
  it("names a category the site knows", () => {
    expect(categoryTitle("koleje")).toBe("Koleje");
    expect(categoryTitle("wodociagi")).toBe("Wodociągi i kanalizacja");
  });

  it("falls back to the stored value for one it does not", () => {
    // The pipelines and the site deploy separately, so a node can carry a
    // category this build has never heard of. Showing the raw value beats an
    // empty chip: it is visible that something needs adding here.
    expect(categoryTitle("lotniska")).toBe("lotniska");
  });
});

describe("categoryFilterUrl", () => {
  it("points at the table filtered to that sector", () => {
    expect(categoryFilterUrl("koleje")).toBe(
      "/eksploruj/tabela?category=koleje",
    );
  });

  it("escapes a value that is not URL-safe", () => {
    expect(categoryFilterUrl("a b&c")).toBe(
      "/eksploruj/tabela?category=a%20b%26c",
    );
  });

  it("builds a working url for every category the site offers", () => {
    for (const category of companyCategories) {
      const url = new URL(
        categoryFilterUrl(category.value),
        "https://koryta.pl",
      );
      expect(url.pathname).toBe("/eksploruj/tabela");
      expect(url.searchParams.get("category")).toBe(category.value);
    }
  });
});

describe("isKnownCategory", () => {
  it("accepts the offered values and rejects anything else", () => {
    expect(isKnownCategory("szpitale")).toBe(true);
    expect(isKnownCategory("koleje")).toBe(true);
    expect(isKnownCategory("lotniska")).toBe(false);
    expect(isKnownCategory("")).toBe(false);
    expect(isKnownCategory("Koleje")).toBe(false);
  });
});
