import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { ref, computed } from "vue";
import Container from "./Container.vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({ components, directives });

/** What the real composable hands back, minus the fetch. `maxDepth` is captured
 * so the depth control can be checked against the url the container would ask
 * for. */
const asked: { maxDepth?: unknown }[] = [];

vi.mock("~/composables/graph", () => {
  return {
    useGraph: vi.fn().mockImplementation((opts: { maxDepth?: unknown }) => {
      asked.push(opts);
      return {
        nodesFiltered: ref({
          "2": { name: "Orlen", type: "rect", color: "#6b7a83" },
        }),
        edgesFiltered: ref([]),
        ready: ref(true),
        omitted: computed(() => 0),
      };
    }),
  };
});

describe("GraphContainer unit tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asked.length = 0;
  });

  it("names what the reader picked, and offers its page", async () => {
    const component = await mountSuspended(Container, {
      global: { plugins: [vuetify], stubs: { GraphCanvas: true } },
      props: { focusNodeId: "1" },
    });

    expect(component.exists()).toBe(true);
    // Nothing picked yet: the footer says how to use the canvas rather than
    // sitting empty.
    expect(component.text()).toContain("Najedź na węzeł");

    const canvas = component.findComponent({ name: "GraphCanvas" });
    canvas.vm.$emit("select", "2");
    await component.vm.$nextTick();

    expect(component.text()).toContain("Orlen");
    expect(component.text()).toContain("Otwórz stronę");
  });

  it("asks for the reach the page wanted", async () => {
    await mountSuspended(Container, {
      global: { plugins: [vuetify], stubs: { GraphCanvas: true } },
      props: { focusNodeId: "1", maxDepth: 2 },
    });

    // A ref rather than a number: the bar above the canvas lets the reader
    // change it, and the url has to follow.
    expect(asked[0]?.maxDepth).toMatchObject({ value: 2 });
  });

  it("explains what the nodes are", async () => {
    const component = await mountSuspended(Container, {
      global: { plugins: [vuetify], stubs: { GraphCanvas: true } },
      props: { focusNodeId: "1" },
    });

    expect(component.text()).toContain("Osoba");
    expect(component.text()).toContain("Instytucja");
    expect(component.text()).toContain("Region");
  });
});
