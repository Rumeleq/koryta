import { describe, it, expect, vi } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import Filters from "../../../app/components/form/EksplorujTabelaFilters.vue";

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const mount = (props: Record<string, unknown> = {}) =>
  mountSuspended(Filters, {
    props: {
      availableParties: [{ title: "PiS", value: "PiS" }],
      availableRegions: [{ title: "Mazowieckie", value: "teryt14" }],
      availableCompanies: [{ title: "Spółka", value: "company-1" }],
      ...props,
    },
  });

/** The block the phone toggle folds away. Above 960px the stylesheet ignores
 * the class, so its presence in the DOM is the whole of what can be asserted
 * in jsdom - which is also all the component decides. */
const panel = (wrapper: Awaited<ReturnType<typeof mount>>) =>
  wrapper.get(".tabela-filters");

const toggle = (wrapper: Awaited<ReturnType<typeof mount>>) =>
  wrapper
    .findAll(".v-btn")
    .find((b) => b.text().startsWith("Filtry")) as ReturnType<
    typeof wrapper.findAll
  >[number];

describe("the table's filter panel", () => {
  it("starts folded and unfolds on the button", async () => {
    const wrapper = await mount();
    expect(panel(wrapper).classes()).toContain("tabela-filters--collapsed");

    await toggle(wrapper).trigger("click");
    expect(panel(wrapper).classes()).not.toContain("tabela-filters--collapsed");

    await toggle(wrapper).trigger("click");
    expect(panel(wrapper).classes()).toContain("tabela-filters--collapsed");
  });

  it("counts the filters it is hiding, so none of them work in secret", async () => {
    const wrapper = await mount();
    expect(toggle(wrapper).text()).toBe("Filtry i wyszukiwanie");

    // Two narrowing filters, and two that are set to the value that narrows
    // nothing - those must not be counted.
    await wrapper.setProps({
      party: ["PiS"],
      teryt: "teryt14",
      visibility: "all",
      hideVoted: "all",
    });
    expect(toggle(wrapper).text()).toBe("Filtry (2)");

    await wrapper.setProps({ visibility: "private" });
    expect(toggle(wrapper).text()).toBe("Filtry (3)");
  });

  it("does not count an empty selection as a filter", async () => {
    const wrapper = await mount();
    await wrapper.setProps({ party: [], place: [], teryt: null });
    expect(toggle(wrapper).text()).toBe("Filtry i wyszukiwanie");
  });
});
