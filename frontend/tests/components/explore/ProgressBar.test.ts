import { describe, it, expect } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import ProgressBar from "../../../app/components/explore/ProgressBar.vue";
import {
  AA_TEXT,
  brand,
  contrastRatio,
  ink,
  surface,
} from "../../../shared/colors";

// Vuetify's tooltips observe their activator, and happy-dom ships no
// ResizeObserver.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

registerEndpoint("/api/stats/progress", () => ({
  total: 100,
  approved: 40,
  reviewed: 20,
  toCheck: 40,
  withVotes: 12,
  withNotes: 3,
}));

const query = { visibility: "all" } as never;

const mount = (props: Record<string, unknown> = {}) =>
  mountSuspended(ProgressBar, { props: { query, ...props } });

/** What Vuetify's `text-medium-emphasis` composites to on white: black at
 * `--v-medium-emphasis-opacity`, 0.6 in the light theme. */
const MEDIUM_EMPHASIS = "#666666";

describe("ExploreProgressBar", () => {
  /** Both callers pass `hide-cta` - /eksploruj/nowe is the page the button
   * links to, and the query bar draws its own filled copy at the end of the
   * work row - so the tonal one here was never painted. Asserted without the
   * prop, because that is the only way the branch could have come back. */
  it("draws no „Pomóż sprawdzać” button in either variant", async () => {
    const card = await mount();
    expect(card.text()).toContain("Postęp weryfikacji");
    expect(card.text()).not.toContain("Pomóż sprawdzać");

    const band = await mount({ compact: true });
    expect(band.text()).toContain("sprawdzono");
    expect(band.text()).not.toContain("Pomóż sprawdzać");
  });

  /** The prop outlived the button: the query bar still passes it, and dropping
   * the declaration would leave `hide-cta` on the root element. */
  it("still accepts hide-cta and renders the same thing with it", async () => {
    const band = await mount({ compact: true, hideCta: true });

    expect(band.text()).not.toContain("Pomóż sprawdzać");
    expect(band.find("[hide-cta]").exists()).toBe(false);
  });

  /** The band sits eight pixels under the query bar's own row count, which is
   * painted in the palette's neutral. Two greys in one 44px row was what the
   * review called out, and it is why the whole component moved over. */
  it("writes every meta line in the palette's neutral ink", async () => {
    for (const wrapper of [await mount(), await mount({ compact: true })]) {
      // By class and not by markup: `color="medium-emphasis"` on an icon
      // resolves to the same class, and the comments in the template mention
      // the name it replaced.
      expect(wrapper.findAll(".text-medium-emphasis")).toHaveLength(0);
      expect(wrapper.findAll(".text-ink-neutral").length).toBeGreaterThan(0);
    }
  });

  /** /eksploruj/nowe mounts the card variant unconditionally, so a guest
   * reaches this link. It was `text-primary`, 1.85:1 at 14px on white. */
  it("paints the guest's „Zaloguj się” link in the palette's link ink", async () => {
    for (const wrapper of [await mount(), await mount({ compact: true })]) {
      const link = wrapper
        .findAll("a")
        .find((anchor) => anchor.text().includes("Zaloguj się"));
      expect(
        link,
        "no „Zaloguj się” link for a signed-out reader",
      ).toBeTruthy();
      expect(link!.classes()).toContain("text-ink-info");
      expect(link!.classes()).not.toContain("text-primary");
    }
  });

  it("pins the ratios the two swaps were made for", () => {
    expect(contrastRatio(ink.info, surface.white)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(contrastRatio(brand.primary, surface.white)).toBeLessThan(AA_TEXT);
    // Medium emphasis passed on its own - this half of the change is about
    // one grey per band, not about a failure.
    expect(
      contrastRatio(MEDIUM_EMPHASIS, surface.white),
    ).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(ink.neutral, surface.white)).toBeGreaterThan(
      contrastRatio(MEDIUM_EMPHASIS, surface.white),
    );
  });
});
