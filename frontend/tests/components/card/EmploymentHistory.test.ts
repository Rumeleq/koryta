import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import EmploymentHistory from "../../../app/components/card/EmploymentHistory.vue";
import PartyChip from "../../../app/components/PartyChip.vue";
import ChipPublicCompany from "../../../app/components/chip/PublicCompany.vue";
import ChipRelativeDuration from "../../../app/components/chip/RelativeDuration.vue";
import type { EdgeNode } from "../../../app/composables/edges";

const vuetify = createVuetify({ components, directives });

function edge(fields: Partial<EdgeNode>): EdgeNode {
  return {
    id: "e1",
    type: "employed",
    label: "Zarząd",
    source: "person",
    target: "place",
    richNode: { id: "place", type: "place", name: "PKP" },
    ...fields,
  } as EdgeNode;
}

async function render(edges: EdgeNode[]) {
  return await mountSuspended(EmploymentHistory, { props: { edges } });
}

describe("CardEmploymentHistory", () => {
  it("shows the period of a dated relation", async () => {
    const wrapper = await render([
      edge({ start_date: "2014-11-06", end_date: "2017-08-25" }),
    ]);
    expect(wrapper.text()).toContain("2014-11-06 - 2017-08-25");
    // Anchors the selector the undated case asserts the absence of.
    expect(
      wrapper.findComponent({ name: "ChipRelativeDuration" }).exists(),
    ).toBe(true);
  });

  it("drops the duration bar for a relation that carries no dates", async () => {
    // `connection` has no date fields in the schema, so every one of them would
    // otherwise draw a full-width bar over a span nobody recorded.
    const wrapper = await render([
      edge({ type: "connection", label: "kolega z zarządu" }),
    ]);
    expect(wrapper.text()).toContain("kolega z zarządu");
    expect(
      wrapper.findComponent({ name: "ChipRelativeDuration" }).exists(),
    ).toBe(false);
  });

  it("never renders undefined for an undated employment", async () => {
    const wrapper = await render([edge({ label: "zastępca prezesa" })]);
    expect(wrapper.text()).not.toContain("undefined");
  });
});

/** The shape `useEdges` hands the card, narrowed to what this card reads. */
function candidacy(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    type: "election",
    label: "Kandydował/a w",
    source: "person1",
    target: "teryt1261",
    start_date: "2024-01-01",
    richNode: { id: "teryt1261", type: "region", name: "Kraków" },
    ...overrides,
  };
}

function mountHistory(edges: unknown[]) {
  return mount(EmploymentHistory, {
    global: {
      plugins: [vuetify],
      components: { PartyChip, ChipPublicCompany, ChipRelativeDuration },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    props: { edges: edges as any },
  });
}

describe("EmploymentHistory", () => {
  it("names the party and the committee of a candidacy", () => {
    const wrapper = mountHistory([
      candidacy({
        party: "PiS",
        committee: "Komitet Wyborczy Prawo i Sprawiedliwość",
      }),
    ]);

    expect(wrapper.text()).toContain("Kraków");
    expect(wrapper.text()).toContain("PiS");
    expect(wrapper.text()).toContain("Komitet Wyborczy Prawo i Sprawiedliwość");
  });

  it("names a local committee that maps onto no party", () => {
    const wrapper = mountHistory([
      candidacy({ committee: "Komitet Wyborczy Wyborców Wspólny Kalisz" }),
    ]);

    expect(wrapper.text()).toContain(
      "Komitet Wyborczy Wyborców Wspólny Kalisz",
    );
    expect(wrapper.findComponent(PartyChip).exists()).toBe(false);
  });

  it("does not repeat a committee that is spelled like its party", () => {
    const wrapper = mountHistory([
      candidacy({ party: "PSL", committee: "psl" }),
    ]);

    expect(wrapper.findComponent(PartyChip).exists()).toBe(true);
    expect(wrapper.text()).not.toContain("psl");
  });

  it("leaves a candidacy with neither field as it was", () => {
    const wrapper = mountHistory([candidacy()]);

    expect(wrapper.text()).toContain("Kandydował/a w");
    expect(wrapper.findComponent(PartyChip).exists()).toBe(false);
  });

  it("shows no party chip for an employment that carries one", () => {
    const wrapper = mountHistory([
      candidacy({ type: "employed", label: "Prezes", party: "PiS" }),
    ]);

    expect(wrapper.findComponent(PartyChip).exists()).toBe(false);
  });
});
