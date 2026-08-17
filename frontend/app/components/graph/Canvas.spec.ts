import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { GraphCanvas } from "#components";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { ForceLayout } from "v-network-graph/lib/force-layout";
import type { Node as GraphNode } from "~~/shared/graph/model";

const vuetify = createVuetify({ components, directives });

const twoPeople: Record<string, GraphNode> = {
  p1: { name: "Anna Nowak", type: "circle", color: "#000" },
  p2: { name: "Krzysztof Wójcik", type: "circle", color: "#000" },
};

describe("GraphCanvas", () => {
  it("can mount some component", async () => {
    const component = await mountSuspended(GraphCanvas, {
      global: { plugins: [vuetify] },
    });
    expect(component.text()).toMatchInlineSnapshot(`"Ładuję..."`);
  });

  it("installs a force layout for a graph it is handed on first render", async () => {
    // The regression this pins. Both watchers here used to wait for a change,
    // so a page whose data was already in hand when it first rendered - a
    // reload, where the server sends the graph with the markup - tripped
    // neither: the nodes arrive with the first render, and the focus node is
    // pinned by a `key` so it never moves. Nothing installed a layout handler,
    // v-network-graph fell back to its default, and every node was drawn at the
    // same spot. It read as the simulation pulling nodes together; it was the
    // simulation never being asked to run.
    const component = await mountSuspended(GraphCanvas, {
      props: {
        nodes: twoPeople,
        edges: [{ source: "p1", target: "p2", type: "connection" }],
        ready: true,
        focusNodeId: "p1",
      },
      global: { plugins: [vuetify] },
    });

    const configs = (
      component.vm as unknown as {
        configs: { view: { layoutHandler?: unknown } };
      }
    ).configs;

    expect(configs.view.layoutHandler).toBeInstanceOf(ForceLayout);
  });
});
