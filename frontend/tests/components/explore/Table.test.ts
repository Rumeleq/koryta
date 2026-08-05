import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import Table from "../../../app/components/explore/Table.vue";

const vuetify = createVuetify({ components, directives });

vi.mock("~/composables/usePersonSearch", () => ({
  executeSearchAll: vi.fn(),
}));
vi.mock("~/composables/votes", () => ({
  voteScaleSummary: vi.fn(() => ""),
}));

const headers = [
  { title: "Imię i nazwisko", key: "name", sortable: true },
  { title: "Firmy", key: "companies", sortable: false },
];

const items = [
  {
    id: "p1",
    name: "Jan Kowalski",
    type: "person" as const,
    companies: [{ id: "c1", name: "Firma A" }],
    elections: [],
    experience: 3,
  },
];

function mountTable(props: Record<string, unknown> = {}) {
  return mount(Table, {
    props: { headers, items, totalItems: 1, pending: false, ...props },
    global: {
      plugins: [vuetify],
      stubs: {
        ButtonVoteNumber: true,
        ExploreTableColumnHeader: true,
        NuxtLink: { template: "<a><slot /></a>" },
      },
    },
  });
}

describe("ExploreTable", () => {
  it("asks the host to open the company behind a chip", async () => {
    const wrapper = mountTable();

    const chip = wrapper.find(".v-chip");
    expect(chip.text()).toContain("Firma A");

    await chip.trigger("click");

    expect(wrapper.emitted("focus:company")).toEqual([
      [{ id: "c1", name: "Firma A" }],
    ]);
  });

  it("leaves the chip inert where the host cannot focus anything", async () => {
    const wrapper = mountTable({ disableFocus: true });

    await wrapper.find(".v-chip").trigger("click");

    expect(wrapper.emitted("focus:company")).toBeUndefined();
  });
});
