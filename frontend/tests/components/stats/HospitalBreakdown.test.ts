import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import HospitalBreakdown from "../../../app/components/stats/HospitalBreakdown.vue";
import type {
  Breakdown,
  BreakdownRow,
} from "../../../app/composables/stats/useHospitalBoards";
import { partyDisplay } from "../../../app/composables/stats/useHospitalBoards";
import { ink } from "../../../app/utils/chartTheme";

const row = (overrides: Partial<BreakdownRow> = {}): BreakdownRow => {
  const seats = overrides.seats ?? 16;
  const unreviewed = overrides.unreviewed === undefined ? 86 : overrides.unreviewed;
  const total = seats + (unreviewed ?? 0);
  return {
    key: "14",
    label: "mazowieckie",
    seats,
    unreviewed,
    total,
    share: total === 0 ? null : seats / total,
    segments: [{ ...partyDisplay("PO"), seats: 6 }],
    to: "/eksploruj/tabela?companyTeryt=14",
    ...overrides,
  };
};

const mount = (
  rows: BreakdownRow[],
  dimension: Breakdown = "region",
  canSeeDrafts = true,
) =>
  mountSuspended(HospitalBreakdown, {
    props: {
      title: "Miejsca w radach nadzorczych według województwa",
      rows,
      dimension,
      emptyText: "Nie mamy jeszcze w bazie żadnego miejsca.",
      canSeeDrafts,
    },
  });

describe("StatsHospitalBreakdown: one chart, three splits", () => {
  it("offers exactly the three groupings and no other control", async () => {
    // The page used to stack three charts; the whole point of this component is
    // that the reader switches the question instead of the chart. A second
    // control (sorting, scale) would compete with the only one that matters.
    const wrapper = await mount([row()]);
    const labels = wrapper
      .findAll(".breakdown__dimensions .v-btn")
      .map((b) => b.text().trim());
    expect(labels).toEqual(["Partii", "Województwa", "Szpitala"]);
  });

  it("emits the new split when a grouping button is clicked", async () => {
    const wrapper = await mount([row()]);
    const buttons = wrapper.findAll(".breakdown__dimensions .v-btn");
    await buttons[2]!.trigger("click");
    expect(wrapper.emitted("update:dimension")?.[0]).toEqual(["hospital"]);
  });

  it("keeps the chart/table toggle the card provides", async () => {
    const wrapper = await mount([row()]);
    expect(wrapper.find('[aria-label="Wykres"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="Tabela z liczbami"]').exists()).toBe(true);
  });

  it("orders by most reviewed seats, not by most seats known", async () => {
    const wrapper = await mount([
      row({ key: "a", label: "duże ale niesprawdzone", seats: 1, unreviewed: 200 }),
      row({ key: "b", label: "mniejsze ale sprawdzone", seats: 9, unreviewed: 2 }),
    ]);
    const order = wrapper
      .findAll(".breakdown__row:not(.breakdown__row--head) .breakdown__label")
      .map((n) => n.text().trim());
    expect(order[0]).toContain("mniejsze ale sprawdzone");
  });
});

describe("StatsHospitalBreakdown: the backlog", () => {
  it("draws a thin track for the unreviewed remainder", async () => {
    const wrapper = await mount([row()]);
    const track = wrapper.find(".breakdown__track");
    expect(track.exists()).toBe(true);
    // The colour arrives through the palette variable; what the stripe must
    // never carry is a background of its own.
    expect(track.attributes("style")).not.toContain("background");
    expect(wrapper.find(".breakdown").attributes("style")).toContain(ink.track);
  });

  it("never paints the backlog with the grey a reviewed party-less person wears", async () => {
    // ink.muted is somebody who holds a seat; ink.track is space nobody checked.
    expect(ink.track).not.toBe(partyDisplay("__NONE__").color);
    const wrapper = await mount([row()]);
    expect(wrapper.find(".breakdown__track").attributes("style")).not.toContain(
      partyDisplay("__NONE__").color,
    );
  });

  it("gives a party row no tail at all, and says why", async () => {
    // We do not know which party the unreviewed people belong to. `null`, not
    // zero - a zero-length tail would still assert the number is known.
    const wrapper = await mount(
      [row({ key: "PO", label: "PO", unreviewed: null, seats: 13 })],
      "party",
    );
    expect(wrapper.find(".breakdown__track").exists()).toBe(false);
    expect(wrapper.text()).toContain("nie zgadujemy");
    expect(wrapper.text()).not.toContain("jeszcze niesprawdzone — sama liczba");
  });

  it("starts the tail where the widened head really ends", async () => {
    const wrapper = await mount([
      row({ key: "big", seats: 0, unreviewed: 900, segments: [] }),
      row({ key: "tiny", seats: 1, unreviewed: 99, segments: [{ ...partyDisplay("PiS"), seats: 1 }] }),
    ]);
    const pct = (s: string | undefined, prop: string) =>
      Number(new RegExp(`${prop}:\\s*([\\d.]+)%`).exec(s ?? "")?.[1] ?? NaN);
    // Rows sort by reviewed seats, so the one-seat row leads; pick it by the
    // fact that it is the only one with a segment rather than by index.
    const r = wrapper
      .findAll(".breakdown__row:not(.breakdown__row--head)")
      .find((n) => n.find(".breakdown__seg").exists())!;
    const seg = r.find(".breakdown__seg").attributes("style");
    const track = r.find(".breakdown__track").attributes("style");
    expect(pct(track, "left")).toBeCloseTo(pct(seg, "left") + pct(seg, "width"), 5);
    // ...and the row still ends at its true total.
    expect(pct(track, "left") + pct(track, "width")).toBeCloseTo(
      (100 / 900) * 100,
      5,
    );
  });

  it("marks a row nobody has started", async () => {
    const wrapper = await mount([row({ seats: 0, unreviewed: 44, segments: [] })]);
    expect(wrapper.find(".breakdown__row--zero").exists()).toBe(true);
    expect(wrapper.findAll(".breakdown__seg")).toHaveLength(0);
    expect(wrapper.find(".breakdown__track").exists()).toBe(true);
  });
});

describe("StatsHospitalBreakdown: the work-queue button", () => {
  it("is a live, readable link for an editor - never disabled", async () => {
    const wrapper = await mount([row()], "region", true);
    const cta = wrapper.find(".breakdown__cta");
    expect(cta.attributes("disabled")).toBeUndefined();
    expect(cta.text()).toContain("Zobacz osoby");
  });

  it("sends a logged-out reader to log in, and back here afterwards", async () => {
    // A disabled tonal button is the failure this replaced: app.vue's contrast
    // override covers only elevated and flat variants, so a disabled tonal one
    // is unreadable - and it tells the reader nothing about what to do next.
    const wrapper = await mount([row()], "region", false);
    const cta = wrapper.find(".breakdown__cta");
    expect(cta.attributes("disabled")).toBeUndefined();
    expect(cta.text()).toContain("Zaloguj się");
    expect(cta.element.tagName).toBe("A");
  });

  it("wears a documented ink colour, never the 1.85:1 brand sage", async () => {
    // shared/colors.ts: `primary` is #a8c79f and fails as text; every ink-* in
    // the set clears 4.5:1 on every surface in it.
    const wrapper = await mount([row(), row({ key: "z", seats: 0, unreviewed: 5, segments: [] })]);
    const classes = wrapper.findAll(".breakdown__cta").map((c) => c.classes().join(" "));
    expect(classes.some((c) => c.includes("text-ink-info"))).toBe(true);
    expect(classes.some((c) => c.includes("text-ink-warning"))).toBe(true);
    expect(classes.some((c) => c.includes("text-primary"))).toBe(false);
  });
});

describe("StatsHospitalBreakdown: scale honesty", () => {
  it("says nothing about a correction it did not have to make", async () => {
    const wrapper = await mount([row()]);
    expect(wrapper.text()).not.toContain("Korekta minimalnej szerokości");
  });

  it("declares the correction when the floor does bite", async () => {
    const wrapper = await mount([
      row({ key: "big", seats: 0, unreviewed: 900, segments: [] }),
      row({ key: "tiny", seats: 1, unreviewed: 99, segments: [{ ...partyDisplay("PiS"), seats: 1 }] }),
    ]);
    expect(wrapper.text()).toContain("Korekta minimalnej szerokości");
  });

  it("scales the head to seats, not to party attributions", async () => {
    // A published person with two parties is counted under both.
    const wrapper = await mount([
      row({
        seats: 2,
        unreviewed: 0,
        segments: [
          { ...partyDisplay("PO"), seats: 2 },
          { ...partyDisplay("PSL"), seats: 1 },
        ],
      }),
    ]);
    const widths = wrapper
      .findAll(".breakdown__seg")
      .map((el) => Number(/width:\s*([\d.]+)%/.exec(el.attributes("style") ?? "")?.[1] ?? 0));
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
  });

  it("caps a long split and counts what it held back", async () => {
    // Silent truncation reads as "that is all there is".
    const many = Array.from({ length: 40 }, (_, i) =>
      row({ key: `h${i}`, label: `Szpital ${i}`, seats: 40 - i, unreviewed: 3 }),
    );
    const wrapper = await mount(many, "hospital");
    expect(
      wrapper.findAll(".breakdown__row:not(.breakdown__row--head)"),
    ).toHaveLength(25);
    expect(wrapper.text()).toContain("Pokaż pozostałe 15");
  });

  it("falls back to the empty text with nothing to draw", async () => {
    const wrapper = await mount([]);
    expect(wrapper.text()).toContain("Nie mamy jeszcze w bazie");
  });
});
