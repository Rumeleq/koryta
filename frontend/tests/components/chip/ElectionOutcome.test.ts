import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ElectionOutcome from "../../../app/components/chip/ElectionOutcome.vue";

async function labelOf(props: {
  elected: boolean | null | undefined;
  showUnknown?: boolean;
}) {
  return (await mountSuspended(ElectionOutcome, { props })).text();
}

describe("ChipElectionOutcome", () => {
  it("says when the candidacy took the seat", async () => {
    expect(await labelOf({ elected: true })).toContain("Mandat zdobyty");
  });

  it("says when it did not", async () => {
    // The half of the record this site is about. `false` is an answer here,
    // not the blank it is on every other boolean on an edge.
    expect(await labelOf({ elected: false })).toContain("Bez mandatu");
  });

  it("stays silent about a result nobody recorded", async () => {
    // The default, because it is the state every stored candidacy is in: a
    // chip per row saying "wynik nieznany" would be the loudest thing on a
    // person's page and say the least.
    expect(await labelOf({ elected: undefined })).toBe("");
    expect(await labelOf({ elected: null })).toBe("");
  });

  it("says so where the caller asks it to", async () => {
    // A region's page, where every row is a candidacy and the result is what
    // distinguishes them - so the absence of one is worth one line.
    expect(await labelOf({ elected: undefined, showUnknown: true })).toContain(
      "Wynik nieznany",
    );
  });

  it("never calls an unrecorded result a loss", async () => {
    expect(
      await labelOf({ elected: undefined, showUnknown: true }),
    ).not.toContain("Bez mandatu");
  });
});
