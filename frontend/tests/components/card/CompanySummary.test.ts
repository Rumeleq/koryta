import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import CompanySummary from "../../../app/components/card/CompanySummary.vue";
import type { Company } from "../../../shared/model";

const company = {
  id: "chain-company",
  type: "place",
  name: "Firma Testowa",
  regonNumber: "123456785",
  nipNumber: "5260250274",
  krsNumber: "0000357114",
} as Company;

describe("CardCompanySummary", () => {
  it("keeps a register apart from its number", async () => {
    const wrapper = await mountSuspended(CompanySummary, {
      props: { company, location: "Powiat Testowy" },
    });
    // The template writes this gap out: whitespace between two tags is dropped
    // by the compiler, and "REGON:123456785" reads as one long number. The
    // linked identifiers lose it the same way, hence KRS here too.
    expect(wrapper.text().replace(/\s+/g, " ")).toContain("REGON: 123456785");
    expect(wrapper.text().replace(/\s+/g, " ")).toContain("NIP: 5260250274");
    expect(wrapper.text().replace(/\s+/g, " ")).toContain("KRS: 0000357114");
  });
});
