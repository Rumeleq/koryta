import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import SelectedCompanies from "../../../app/components/explore/SelectedCompanies.vue";
import type { Company } from "../../../shared/model";

const companies = (count: number) =>
  Array.from(
    { length: count },
    (_, i) =>
      ({
        id: `company-${i}`,
        type: "place",
        name: `Firma ${i}`,
        location: undefined,
      }) as Company & { id: string; location: string | undefined },
  );

describe("ExploreSelectedCompanies", () => {
  it("shows the full summaries for a couple of companies", async () => {
    const wrapper = await mountSuspended(SelectedCompanies, {
      props: { companies: companies(2) },
    });

    expect(wrapper.text()).toContain("Firma 0");
    expect(wrapper.text()).toContain("Zaproponuj zmianę");
    expect(wrapper.text()).not.toContain("Pokaż szczegóły");
  });

  it("folds three or more down to their names", async () => {
    const wrapper = await mountSuspended(SelectedCompanies, {
      props: { companies: companies(3) },
    });

    expect(wrapper.text()).toContain("Wybrane firmy (3)");
    expect(wrapper.text()).toContain("Firma 2");
    // The summaries are what make the table unreachable, so they stay out of
    // the DOM until asked for.
    expect(wrapper.text()).not.toContain("Zaproponuj zmianę");

    await wrapper.find("button").trigger("click");

    expect(wrapper.text()).toContain("Zaproponuj zmianę");
    expect(wrapper.text()).toContain("Zwiń");
  });
});
