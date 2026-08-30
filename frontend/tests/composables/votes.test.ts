import { describe, it, expect } from "vitest";
import { voteCategoryConfig } from "../../app/composables/votes";
import { AA_TEXT, contrastRatio, ink, surface } from "../../shared/colors";

/** The two colour fields of a vote category are written verbatim into
 * `text-<name>` on the count and into `:color` on the arrows by
 * `button/vote/Number.vue`, on a `bg-surface` pill - white in the light theme.
 *
 * They used to be Vuetify's `success` and `warning`, which are fills: on that
 * pill the „Twój głos” count in /eksploruj/tabela measured 2.78:1 and 2.37:1,
 * the second of the failures the owner reported on that page. Held here rather
 * than in a component test because the names are chosen here and the component
 * only concatenates them. */
describe("vote colours", () => {
  const inkByToken: Record<string, string> = {
    "ink-success": ink.success,
    "ink-danger": ink.danger,
    "ink-warning": ink.warning,
  };

  it("names an ink token, never a fill", () => {
    for (const [category, config] of Object.entries(voteCategoryConfig)) {
      expect(inkByToken[config.color], `${category}.color`).toBeDefined();
      expect(
        inkByToken[config.downColor],
        `${category}.downColor`,
      ).toBeDefined();
    }
  });

  it("reads on the white pill it is painted on", () => {
    for (const [category, config] of Object.entries(voteCategoryConfig)) {
      for (const token of [config.color, config.downColor]) {
        expect(
          contrastRatio(inkByToken[token]!, surface.white),
          `${category} ${token}`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it("keeps up and down apart, so the sign is not read from the number alone", () => {
    // `insufficient` and `wrongPerson` are deliberately one colour both ways:
    // neither direction of those two is good news, so an up vote in green
    // would say the opposite of what it means.
    expect(voteCategoryConfig.interesting.color).not.toBe(
      voteCategoryConfig.interesting.downColor,
    );
    expect(voteCategoryConfig.quality.color).not.toBe(
      voteCategoryConfig.quality.downColor,
    );
    expect(voteCategoryConfig.correct.color).not.toBe(
      voteCategoryConfig.correct.downColor,
    );
  });
});
