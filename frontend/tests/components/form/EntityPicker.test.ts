import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import EntityPicker from "../../../app/components/form/EntityPicker.vue";

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).$fetch = mockFetch;

const vuetify = createVuetify({ components, directives });

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
global.visualViewport = {
  width: 1024,
  height: 768,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
} as unknown as VisualViewport;

function mountPicker(entity: unknown) {
  return mount(EntityPicker, {
    props: { entity, label: "Szukaj" },
    global: {
      plugins: [vuetify],
      stubs: { DialogProposeEditNode: true },
    },
    attachTo: document.body,
  });
}

/** Types a name and waits out the 300ms debounce, which is what gates both the
 * results and the "add to base" entries.
 *
 * Real time rather than fake timers: the debounce comes from @vueuse's
 * `refDebounced`, which vitest's fake clock does not drive, so the search never
 * ran and the list stayed empty while the add entries appeared anyway. */
async function searchFor(
  wrapper: ReturnType<typeof mountPicker>,
  term: string,
) {
  await wrapper.find("input").setValue(term);
  await new Promise((resolve) => setTimeout(resolve, 450));
  await flushPromises();
  await wrapper.vm.$nextTick();
}

const addEntries = () =>
  Array.from(
    document.querySelectorAll('[data-testid^="entity-picker-add-new-"]'),
  ).map((el) => el.getAttribute("data-testid"));

describe("EntityPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    mockFetch.mockResolvedValue([]);
  });

  it("offers to add a person the search could not find", async () => {
    const wrapper = mountPicker("person");
    await wrapper.find("input").trigger("focus");
    await searchFor(wrapper, "Ktoś Nieznany");

    expect(addEntries()).toEqual(["entity-picker-add-new-person"]);
  });

  it("still offers to add one when several kinds are searched at once", async () => {
    // The relation composer on a person's page searches people, companies and
    // regions together. Offering nothing there left somebody who had just
    // failed to find a person with no way to add them - which is exactly when
    // they most need it.
    const wrapper = mountPicker(["person", "place", "region"]);
    await wrapper.find("input").trigger("focus");
    await searchFor(wrapper, "Ktoś Nieznany");

    expect(addEntries()).toEqual([
      "entity-picker-add-new-person",
      "entity-picker-add-new-place",
    ]);
  });

  it("says which kind each entry would create, when there is a choice", async () => {
    const wrapper = mountPicker(["person", "place"]);
    await wrapper.find("input").trigger("focus");
    await searchFor(wrapper, "Nowa Nazwa");

    expect(document.body.textContent).toContain("jako osobę.");
    expect(document.body.textContent).toContain("jako firmę lub instytucję.");
  });

  it("does not name the kind when there is only one", async () => {
    const wrapper = mountPicker("person");
    await wrapper.find("input").trigger("focus");
    await searchFor(wrapper, "Nowa Nazwa");

    expect(document.body.textContent).toContain("do bazy.");
    expect(document.body.textContent).not.toContain("jako osobę.");
  });

  it("offers nothing to create where nothing may be", async () => {
    // A region has no schema /api/revisions/create would accept.
    const wrapper = mountPicker(["region"]);
    await wrapper.find("input").trigger("focus");
    await searchFor(wrapper, "Nowy Region");

    expect(addEntries()).toEqual([]);
  });
});
