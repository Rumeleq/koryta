import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { defineComponent, h } from "vue";
import { VApp } from "vuetify/components";
import NodeDrawer from "../../../app/components/explore/NodeDrawer.vue";
import {
  AA_LARGE_TEXT,
  brand,
  contrastRatio,
  ink,
  surface,
} from "../../../shared/colors";
import type { NodeMaybeRich } from "../../../shared/model";

// Vuetify's overlay machinery observes its activator, and happy-dom ships no
// ResizeObserver - without this the drawer throws instead of rendering.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

/** A company, so the drawer draws its own title instead of handing the node to
 * CardExplorePerson. This is the branch the note queues open. */
const company = (): NodeMaybeRich =>
  ({
    id: "c1",
    type: "company",
    name: "FIRMA SPÓŁKA Z O.O.",
  }) as NodeMaybeRich;

/** A navigation drawer is a layout item, and Vuetify throws „Could not find
 * injected layout” without one above it. */
const Host = defineComponent({
  setup: () => () =>
    h(VApp, null, {
      default: () => h(NodeDrawer, { modelValue: true, node: company() }),
    }),
});

const mount = () =>
  mountSuspended(Host, {
    global: {
      stubs: {
        NoteEditor: true,
        CardEmploymentHistory: true,
        DialogRemoveEdgeHost: true,
        ChartPersonLocations: true,
      },
    },
  });

describe("ExploreNodeDrawer", () => {
  /** The drawer's title link was `text-decoration-none text-primary`: the
   * brand's pale sage as 24px ink on the drawer's white measures 1.85:1,
   * against the 3:1 that size has to clear. */
  it("titles a node in the palette's sage ink, underlined", async () => {
    const wrapper = await mount();

    const link = wrapper.find(".v-card-title a");
    expect(link.exists()).toBe(true);
    expect(link.text()).toContain("FIRMA SPÓŁKA Z O.O.");
    expect(link.classes()).toContain("text-ink-sage");
    // The underline is the affordance that survives for a reader who cannot
    // resolve sage from grey, so it must not come back.
    expect(link.classes()).not.toContain("text-decoration-none");
    expect(link.classes()).not.toContain("text-primary");
  });

  it("clears the large-text bar with that ink and not with the fill it replaced", () => {
    expect(contrastRatio(ink.sage, surface.white)).toBeGreaterThanOrEqual(
      AA_LARGE_TEXT,
    );
    expect(contrastRatio(brand.primary, surface.white)).toBeLessThan(
      AA_LARGE_TEXT,
    );
  });
});
