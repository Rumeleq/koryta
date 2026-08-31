import { describe, it, expect } from "vitest";
import {
  anchorToken,
  generateChunksLower,
  nameMatchesTokens,
  searchTokens,
} from "~~/shared/search";

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

  it("flattens the whitespace the register puts in a name", () => {
    // One person arrived behind a stray tab and a handful of companies carry
    // their full style across two lines. Split on the literal space, the word
    // after the break kept the break on its front and nothing anybody could
    // type ever reached it.
    const chunks = generateChunksLower("   \t Grzegorz Franciszek Franczak");
    expect(chunks).toContain("grzegorz");
    expect(chunks).toContain("grzegorz franciszek franczak");

    expect(
      generateChunksLower("PEC SPÓŁKA Z OGRANICZONĄ \nODPOWIEDZIALNOŚCIĄ"),
    ).toContain("odpowiedzialnością");
  });

  it("handles a single word without repeating itself", () => {
    const chunks = generateChunksLower("Orlen");
    expect(chunks).toContain("orlen");
    expect(new Set(chunks).size).toBe(chunks.length);
  });
});

describe("searchTokens", () => {
  it("splits on whitespace and folds case", () => {
    expect(searchTokens("Andrzej Namysło")).toEqual(["andrzej", "namysło"]);
  });

  it("drops the padding a typed query collects", () => {
    // A trailing space used to be searched for literally: "nowak " is not a
    // chunk of "Anna Nowak", so pressing space after a surname emptied the menu.
    expect(searchTokens("  anna   nowak ")).toEqual(["anna", "nowak"]);
  });

  it("gives an empty query no tokens, which every name answers", () => {
    expect(searchTokens("   ")).toEqual([]);
    expect(nameMatchesTokens("Anna Nowak", [])).toBe(true);
  });
});

describe("anchorToken", () => {
  it("picks the longest word, the only proxy for the rarest", () => {
    expect(anchorToken(["andrzej", "namysło"])).toBe("namysło");
  });

  it("stays on the finished word while the next one is being typed", () => {
    expect(anchorToken(["andrzej", "n"])).toBe("andrzej");
  });

  it("breaks a tie towards the surname", () => {
    // "Piotr" is on four hundred people, "Pięta" on a handful.
    expect(anchorToken(["piotr", "pięta"])).toBe("pięta");
  });
});

describe("nameMatchesTokens", () => {
  it("finds a person by first and last name past their middle one", () => {
    // The whole point: two of every five people carry a middle name, and no
    // chunk of theirs spans it, so the index alone can never answer this.
    expect(
      nameMatchesTokens("Andrzej Józef Namysło", ["andrzej", "namysło"]),
    ).toBe(true);
  });

  it("still matches while the second word is being typed", () => {
    expect(nameMatchesTokens("Andrzej Józef Namysło", ["andrzej", "n"])).toBe(
      true,
    );
  });

  it("does not care what order the words were typed in", () => {
    expect(
      nameMatchesTokens("Andrzej Józef Namysło", ["namysło", "andrzej"]),
    ).toBe(true);
  });

  it("matches words by prefix, not by any substring", () => {
    expect(nameMatchesTokens("Anna Nowak", ["now"])).toBe(true);
    expect(nameMatchesTokens("Anna Nowak", ["owak"])).toBe(false);
  });

  it("needs a different word for each typed word", () => {
    expect(nameMatchesTokens("Jan Kowalski", ["jan", "jan"])).toBe(false);
    expect(nameMatchesTokens("Jan Kowalski", ["jan", "nowak"])).toBe(false);
  });

  it("takes back a word it took too early", () => {
    // Greedy in typed order would spend "Janusz" on "j" and then have nothing
    // left for "janusz"; longest first, plus the retry behind it, does not.
    expect(nameMatchesTokens("Janusz Jan", ["j", "janusz"])).toBe(true);
  });

  it("cannot match more words than the name has", () => {
    expect(nameMatchesTokens("Anna Nowak", ["anna", "maria", "nowak"])).toBe(
      false,
    );
  });

  it("matches an institution the same way", () => {
    expect(
      nameMatchesTokens("Zakład Gospodarki Komunalnej i Mieszkaniowej", [
        "zakład",
        "mieszkaniowej",
      ]),
    ).toBe(true);
  });
});
