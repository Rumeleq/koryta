import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import Card from "../../../app/components/extraction/Card.vue";
import type { ExtractionFact } from "../../../shared/model";

function fact(fields: Partial<ExtractionFact> = {}): ExtractionFact {
  return {
    id: "fact-1",
    url: "example.com/a",
    articleUrl: "example.com/a",
    articleDomain: "example.com",
    justification: "radny PiS Piotr Gajda",
    fact_type: "party_membership",
    person: "Piotr Gajda",
    party: "Prawo i Sprawiedliwość",
    tag: "v26",
    ...fields,
  } as ExtractionFact;
}

describe("ExtractionCard", () => {
  it("says nothing about the graph when nobody was matched", async () => {
    const card = await mountSuspended(Card, { props: { fact: fact() } });

    expect(card.text()).toContain("Piotr Gajda");
    expect(card.text()).toContain("osoba");
    expect(card.text()).not.toContain("osoba w bazie");
    // No match, nothing to dispute.
    expect(card.text()).not.toContain("To nie ta osoba");
    expect(card.find("a[href^='/osoba/']").exists()).toBe(false);
  });

  it("links a matched fact to the person it was attached to", async () => {
    const card = await mountSuspended(Card, {
      props: {
        fact: fact({
          personNodeId: "KIZV3jJgniMdX7AoRxN9",
          personNodeName: "Piotr Gajda",
        }),
      },
    });

    expect(card.text()).toContain("osoba w bazie");
    expect(
      card.find("a[href='/osoba/piotr-gajda-KIZV3jJgniMdX7AoRxN9']").exists(),
    ).toBe(true);
  });

  it("shows the name the article used, and links by the node's own", async () => {
    // The two differ: the article dropped the diacritics, and the url slug has
    // to be built from what the node is actually called.
    const card = await mountSuspended(Card, {
      props: {
        fact: fact({
          person: "Krzysztof Kozlowski",
          personNodeId: "08h8mNRYfRX9AsesDM85",
          personNodeName: "Krzysztof Kozłowski",
        }),
      },
    });

    expect(card.text()).toContain("Krzysztof Kozlowski");
    expect(
      card
        .find("a[href='/osoba/krzysztof-kozlowski-08h8mNRYfRX9AsesDM85']")
        .exists(),
    ).toBe(true);
  });

  it("offers the flag on a matched fact", async () => {
    const card = await mountSuspended(Card, {
      props: {
        fact: fact({
          personNodeId: "KIZV3jJgniMdX7AoRxN9",
          personNodeName: "Piotr Gajda",
        }),
      },
    });

    expect(card.text()).toContain("To nie ta osoba");
  });

  it("says so when somebody has already flagged the match", async () => {
    const card = await mountSuspended(Card, {
      props: {
        fact: fact({
          personNodeId: "KIZV3jJgniMdX7AoRxN9",
          personNodeName: "Piotr Gajda",
          stats: { votes: { wrongPerson: 1 } } as ExtractionFact["stats"],
        }),
      },
    });

    expect(card.text()).toContain("Zgłoszono złe dopasowanie");
  });

  it("cannot flag a fact it has no id for", async () => {
    // Grouped listings render facts straight from the API, and one without an
    // id has no vote document to write to.
    const card = await mountSuspended(Card, {
      props: {
        fact: fact({
          id: undefined,
          personNodeId: "KIZV3jJgniMdX7AoRxN9",
          personNodeName: "Piotr Gajda",
        }),
      },
    });

    expect(card.text()).toContain("osoba w bazie");
    expect(card.text()).not.toContain("To nie ta osoba");
  });
});
