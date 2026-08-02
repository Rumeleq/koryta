import { describe, it, expect, vi } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import NoteTriageCard from "../../app/components/note/TriageCard.vue";
import type { NoteRow } from "~~/shared/model";

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const row = (overrides: Partial<NoteRow> = {}): NoteRow => ({
  key: "note-1:0",
  noteId: "note-1",
  sourceIndex: 0,
  nodeId: "node-1",
  nodeName: "Jan Testowy",
  nodeType: "person",
  userUid: "user-a",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: null,
  note: "brakuje spółki",
  url: "https://www.example.com/artykul?a=1",
  kind: "change_request",
  adminStatus: null,
  adminType: null,
  adminTypeDeferred: false,
  ...overrides,
});

const mount = (overrides: Partial<NoteRow> = {}) =>
  mountSuspended(NoteTriageCard, {
    props: { row: row(overrides) },
    global: { stubs: { UserChip: true } },
  });

describe("NoteTriageCard", () => {
  it("shows the note beside the node and the source it came from", async () => {
    const wrapper = await mount();

    expect(wrapper.text()).toContain("Jan Testowy");
    expect(wrapper.text()).toContain("brakuje spółki");
    expect(wrapper.text()).toContain("Do poprawy");
    // The type is read off the source as much as the note, so the link opens
    // in its own tab rather than losing the reviewer's place in the queue.
    const link = wrapper.get("a.source-link");
    expect(link.attributes("href")).toBe("https://www.example.com/artykul?a=1");
    expect(link.attributes("target")).toBe("_blank");
    expect(link.text()).toContain("example.com");
  });

  it("says so when there is no source to read", async () => {
    const wrapper = await mount({ url: null });

    expect(wrapper.find("a.source-link").exists()).toBe(false);
    expect(wrapper.text()).toContain("Brak źródła");
  });

  it("still shows an entry written on a node with no name yet", async () => {
    // Notes are commonly written on nodes only proposed as a revision, which
    // resolve to no name - dropping the link must not drop the card.
    const wrapper = await mount({ nodeName: null, nodeType: null });

    expect(wrapper.text()).toContain("node-1");
    expect(wrapper.text()).toContain("brakuje spółki");
  });

  it("shows something readable for a url that is not one", async () => {
    const wrapper = await mount({ url: "gazeta, strona 3" });

    expect(wrapper.text()).toContain("gazeta, strona 3");
  });
});
