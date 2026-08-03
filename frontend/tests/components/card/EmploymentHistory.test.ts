import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import EmploymentHistory from "../../../app/components/card/EmploymentHistory.vue";
import type { EdgeNode } from "../../../app/composables/edges";

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
