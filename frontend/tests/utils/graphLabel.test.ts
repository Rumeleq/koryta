import { describe, it, expect } from "vitest";
import { wrapLabel } from "~/utils/graphLabel";

describe("wrapLabel", () => {
  it("leaves a name that fits on one line", () => {
    expect(wrapLabel("Jan Kowalski")).toBe("Jan Kowalski");
  });

  it("breaks between words rather than inside one", () => {
    const wrapped = wrapLabel("Anna Maria Wiśniewska-Nowak");
    expect(wrapped.split("\n")).toEqual(["Anna Maria", "Wiśniewska-Nowak"]);
  });

  it("keeps every line within the width", () => {
    const wrapped = wrapLabel(
      "Wojewódzki Fundusz Ochrony Środowiska w Krakowie",
      { maxChars: 18, maxLines: 10 },
    );
    for (const line of wrapped.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(18);
    }
  });

  it("cuts a word that is wider than a whole line", () => {
    expect(wrapLabel("a".repeat(25), { maxChars: 10, maxLines: 10 })).toBe(
      "aaaaaaaaaa\naaaaaaaaaa\naaaaa",
    );
  });

  it("ends in an ellipsis rather than growing past the cap", () => {
    const wrapped = wrapLabel(
      "Wojewódzki Fundusz Ochrony Środowiska i Gospodarki Wodnej w Krakowie",
      { maxChars: 18, maxLines: 3 },
    );
    expect(wrapped.split("\n")).toHaveLength(3);
    expect(wrapped.endsWith("…")).toBe(true);
  });

  it("carries the count a group node is labelled with", () => {
    expect(wrapLabel("Ministerstwo (12)", { maxChars: 18 })).toBe(
      "Ministerstwo (12)",
    );
  });

  it("says nothing about a node with no name", () => {
    expect(wrapLabel("")).toBe("");
  });
});
