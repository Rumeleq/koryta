import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import CompanyCategories from "../../../app/components/chip/CompanyCategories.vue";
import type { Company } from "../../../shared/model";

function company(fields: Partial<Company>): Company {
  return { type: "place", name: "Podmiot", ...fields } as Company;
}

async function mount(props: { company: Company | undefined }) {
  return await mountSuspended(CompanyCategories, { props });
}

describe("ChipCompanyCategories", () => {
  it("names a stored category in Polish", async () => {
    const wrapper = await mount({
      company: company({ categories: ["koleje"] }),
    });
    expect(wrapper.text()).toContain("Koleje");
  });

  it("shows every category a company carries", async () => {
    const wrapper = await mount({
      company: company({ categories: ["szpitale", "koleje"] }),
    });
    expect(wrapper.text()).toContain("Szpitale");
    expect(wrapper.text()).toContain("Koleje");
  });

  it("renders each chip as a link, not a bare label", async () => {
    // The category is only useful as a way into the rest of the sector. Where
    // the link points is `categoryFilterUrl`'s job and is asserted in
    // `tests/shared/companyCategories.test.ts`: Vuetify resolves `to` through
    // the router, which emits no href under the test harness.
    const wrapper = await mount({
      company: company({ categories: ["koleje"] }),
    });
    expect(wrapper.find("a.v-chip--link").exists()).toBe(true);
  });

  it("reads a category stored in the sanitized map shape", async () => {
    // Nodes written before 2026-07-28 hold `{"0": "koleje"}` where an array
    // belongs, and `unwrap-array-fields.ts` has not been run against prod.
    const wrapper = await mount({
      company: company({
        categories: { 0: "koleje" } as unknown as string[],
      }),
    });
    expect(wrapper.text()).toContain("Koleje");
  });

  it("renders nothing for a company with no categories", async () => {
    expect((await mount({ company: company({ categories: [] }) })).text()).toBe(
      "",
    );
    expect((await mount({ company: company({}) })).text()).toBe("");
    expect((await mount({ company: undefined })).text()).toBe("");
  });

  it("shows a category the site does not name yet, as itself", async () => {
    // The pipelines and the site deploy separately. Hiding the value would
    // hide that the two have drifted apart.
    const wrapper = await mount({
      company: company({ categories: ["lotniska"] }),
    });
    expect(wrapper.text()).toContain("lotniska");
  });
});
