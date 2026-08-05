import { describe, it, expect } from "vitest";
import { generateNodeUrl } from "../../app/composables/slugs";
import type { Node } from "../../shared/model";

/** A place node, with whatever identifiers the caller wants to give it. */
function place(fields: Record<string, unknown>): Node {
  return { type: "place", name: "Podmiot", ...fields } as unknown as Node;
}

describe("generateNodeUrl", () => {
  it("opens a company's page as the table filtered to it", () => {
    expect(generateNodeUrl(place({ id: "abc", krsNumber: "0000033198" }))).toBe(
      "/eksploruj/tabela?place=abc",
    );
  });

  it("filters just the same for an institution with no KRS number", () => {
    // Ministries, urzędy and wojewódzkie fundusze are not in the register.
    // Keying the link on the KRS number sent every one of them to the
    // unfiltered table, which the entity page then redirected to.
    expect(
      generateNodeUrl(
        place({ id: "ministerstwo", name: "Ministerstwo Infrastruktury" }),
      ),
    ).toBe("/eksploruj/tabela?place=ministerstwo");
  });

  it("has no url for a node that was never saved", () => {
    expect(generateNodeUrl(place({ krsNumber: "0000033198" }))).toBeUndefined();
  });

  it("gives an article the readable url the sitemap advertises", () => {
    // Articles used to fall past every branch and come back undefined, which
    // [seoType]/[slug].vue then 301'd to the site root - so every article link
    // in the sitemap, and every one ever shared, landed on the homepage.
    expect(
      generateNodeUrl({
        type: "article",
        id: "DRf5LYAdf5TwXKDZYMcP",
        name: "1,7 mln dla młodego lekarza",
      } as unknown as Node),
    ).toBe("/artykul/1-7-mln-dla-mlodego-lekarza-DRf5LYAdf5TwXKDZYMcP");
  });

  it("keeps the id's case, which the document id depends on", () => {
    const url = generateNodeUrl({
      type: "person",
      id: "SVb31mmNOMmlOy1BsPhH",
      name: "Adam Niedziałek",
    } as unknown as Node);
    expect(url).toBe("/osoba/adam-niedzialek-SVb31mmNOMmlOy1BsPhH");
  });
});
