import { describe, it, expect, vi } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import NoteSourceCard from "../../app/components/note/SourceCard.vue";
import type { NoteSource } from "~~/shared/model";

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const mount = (source: NoteSource, isEditing = false) =>
  mountSuspended(NoteSourceCard, {
    props: { modelValue: source, isEditing },
  });

describe("NoteSourceCard", () => {
  it("labels a change request but leaves a plain source unlabelled", async () => {
    const change = await mount({ note: "zła data", kind: "change_request" });
    expect(change.text()).toContain("Do poprawy");

    const source = await mount({
      note: "ciekawe",
      url: "https://a.example",
      kind: "source",
    });
    expect(source.text()).not.toContain("Do poprawy");
    expect(source.text()).toContain("https://a.example");
  });

  it("reads an entry written before kinds existed as a source", async () => {
    const wrapper = await mount({ note: "stara", url: "https://a.example" });

    expect(wrapper.text()).not.toContain("Do poprawy");
    expect(wrapper.text()).not.toContain("Brakuje danych");
  });

  it("emits a whole new entry when the kind is switched", async () => {
    const wrapper = await mount({ note: "czegoś brak" }, true);

    const missingChip = wrapper
      .findAll(".v-chip")
      .find((c) => c.text().includes("Brakuje danych"));
    await missingChip?.trigger("click");

    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted?.at(-1)?.[0]).toEqual({
      note: "czegoś brak",
      kind: "missing",
    });
  });
});
