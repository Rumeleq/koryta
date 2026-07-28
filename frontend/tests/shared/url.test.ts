import { describe, it, expect } from "vitest";
import { normalizeUrl } from "../../shared/url";

describe("normalizeUrl", () => {
  it("matches a scheme-less url against a stored one", () => {
    // The case that kept every extracted fact from finding its article: the
    // pipeline sends no scheme, the crawler stored https.
    expect(normalizeUrl("wpolityce.pl/polityka/736478-sad")).toBe(
      normalizeUrl("https://wpolityce.pl/polityka/736478-sad"),
    );
  });

  it("ignores www., the scheme, case in the host and a trailing slash", () => {
    const forms = [
      "https://www.Example.pl/a/",
      "http://example.pl/a",
      "example.pl/a",
      "www.example.pl/a/",
    ];
    const normalized = new Set(forms.map(normalizeUrl));
    expect([...normalized]).toEqual(["example.pl/a"]);
  });

  it("keeps the path case, which servers do distinguish", () => {
    expect(normalizeUrl("example.pl/Artykul")).not.toBe(
      normalizeUrl("example.pl/artykul"),
    );
  });

  it("keeps the query string, which some sites use as the article id", () => {
    expect(normalizeUrl("example.pl/news?id=7")).not.toBe(
      normalizeUrl("example.pl/news?id=8"),
    );
  });

  it("falls back to comparing verbatim when the url will not parse", () => {
    expect(normalizeUrl("  NOT A URL  ")).toBe("not a url");
  });
});
