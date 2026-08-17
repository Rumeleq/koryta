import { describe, it, expect } from "vitest";
import { generateChunksLower } from "~~/shared/search";

describe("generateChunksLower", () => {
  it("indexes the whole name, so typing all of it finds the person", () => {
    // What the e2e specs do, and what the seed fixture had silently stopped
    // supporting: it carried suffixes ("owak", "wak") from an older scheme, so
    // `array-contains` against "anna nowak" matched nothing.
    expect(generateChunksLower("Anna Nowak")).toContain("anna nowak");
  });

  it("indexes each word, so a surname alone finds them too", () => {
    const chunks = generateChunksLower("Anna Nowak");
    expect(chunks).toContain("nowak");
    expect(chunks).toContain("anna");
  });

  it("indexes prefixes, which is what makes it a search-as-you-type index", () => {
    const chunks = generateChunksLower("Anna Nowak");
    expect(chunks).toContain("a");
    expect(chunks).toContain("ann");
    expect(chunks).toContain("anna n");
    expect(chunks).toContain("now");
  });

  it("does not index suffixes, which is the shape the fixture had drifted to", () => {
    const chunks = generateChunksLower("Anna Nowak");
    expect(chunks).not.toContain("owak");
    expect(chunks).not.toContain("wak");
  });

  it("folds case, since the query is lowercased before it is matched", () => {
    expect(generateChunksLower("Krzysztof Wójcik")).toContain(
      "krzysztof wójcik",
    );
    expect(generateChunksLower("ORLEN")).toContain("orlen");
  });

  it("handles a single word without repeating itself", () => {
    const chunks = generateChunksLower("Orlen");
    expect(chunks).toContain("orlen");
    expect(new Set(chunks).size).toBe(chunks.length);
  });
});
