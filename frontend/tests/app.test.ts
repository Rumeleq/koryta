import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { AA_TEXT, contrastRatio, ink, surface } from "../shared/colors";

/** app.vue's second `<style>` block is global on purpose - it patches Vuetify
 * defaults that every page inherits - and no stylesheet is applied in the test
 * DOM, so the rules are read from the file. */
const RELATIVE = "app/app.vue";
const source = readFileSync(
  existsSync(resolve(process.cwd(), RELATIVE))
    ? resolve(process.cwd(), RELATIVE)
    : resolve(process.cwd(), "frontend", RELATIVE),
  "utf8",
);

/** Black at an opacity, over white. Both of the numbers below are composites:
 * Vuetify writes a field label as `rgba(0, 0, 0, 0.87)` and then fades the
 * whole element to `--v-medium-emphasis-opacity`. */
const blackOverWhite = (alpha: number) => {
  const channel = Math.round(255 * (1 - alpha));
  return `#${channel.toString(16).padStart(2, "0").repeat(3)}`;
};

const HIGH_EMPHASIS = 0.87;
const MEDIUM_EMPHASIS = 0.6;

describe("the global field-label rule", () => {
  it("names the palette's neutral ink at full opacity", () => {
    const rule = /\.v-field \.v-label\.v-field-label \{([^}]*)\}/.exec(source);
    expect(rule, "no .v-field-label rule in app.vue").toBeTruthy();
    expect(rule![1]).toContain("opacity: 1;");
    expect(rule![1]).toContain("color: rgb(var(--v-theme-ink-neutral));");
  });

  /** What the rule is for: a label that is the only thing naming a control
   * once the control holds a value, at 12px, under AA. */
  it("replaces a label that did not clear AA with one that does", () => {
    const painted = blackOverWhite(HIGH_EMPHASIS * MEDIUM_EMPHASIS);
    expect(painted).toBe("#7a7a7a");
    expect(contrastRatio(painted, surface.white)).toBeLessThan(AA_TEXT);

    expect(contrastRatio(ink.neutral, surface.white)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });
});
