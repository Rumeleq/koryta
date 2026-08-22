import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { useAuthState } from "../../app/composables/auth";
import { mount } from "@vue/test-utils";
import DefaultLayout from "../../app/layouts/default.vue";
import type { MockAuthState } from "../shared/types";

import { createVuetify } from "vuetify";

// Mock dependencies
vi.mock("../../app/composables/auth");

// The toolbar counts what this user still has to check on /qa, which means a
// firestore read the moment a user is present. Stubbed here so this file stays
// a test of the layout rather than of vuefire.
vi.mock("../../app/composables/qa", () => ({
  useQaChecks: () => ({
    load: vi.fn(),
    loaded: ref(true),
    counts: ref({ unchecked: 2, ok: 0, issue: 1 }),
  }),
}));

vi.mock("vuetify", async () => {
  const actual = await vi.importActual("vuetify");
  return {
    ...actual,
    useDisplay: () => ({ mdAndUp: { value: true } }),
  };
});
const vuetify = createVuetify();

describe("DefaultLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mounts successfully", async () => {
    vi.mocked(useAuthState).mockReturnValue({
      user: ref({ uid: "test-admin" }),
      userConfig: { data: ref({}) },
      logout: vi.fn(),
    } as MockAuthState);

    const wrapper = mount(DefaultLayout, {
      global: {
        plugins: [vuetify],
        stubs: {
          NuxtPage: true,
          DialogMulti: true,
          OmniSearch: true,
          "v-app-bar": {
            template: "<div><slot /><slot name='append' /></div>",
          },
          "v-app-bar-title": true,
          "v-spacer": true,
          "v-btn": {
            template: "<button :to='to'><slot /></button>",
            props: ["to"],
          },
          "v-icon": true,
          "v-avatar": true,
          "v-main": { template: "<div><slot /></div>" },
          "v-toolbar": { template: "<div><slot /></div>" },
          "v-container": { template: "<div><slot /></div>" },
        },
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("links to QA with what is left to check", async () => {
    vi.mocked(useAuthState).mockReturnValue({
      user: ref({ uid: "test-admin" }),
      userConfig: { data: ref({}) },
      logout: vi.fn(),
    } as MockAuthState);

    const wrapper = mount(DefaultLayout, {
      global: {
        plugins: [vuetify],
        stubs: {
          NuxtPage: true,
          DialogMulti: true,
          OmniSearch: true,
          "v-app-bar": {
            template: "<div><slot /><slot name='append' /></div>",
          },
          "v-app-bar-title": true,
          "v-spacer": true,
          "v-btn": {
            template: "<button :to='to'><slot /></button>",
            props: ["to"],
          },
          "v-icon": true,
          "v-avatar": true,
          "v-badge": {
            template: "<span>{{ content }}</span>",
            props: ["content"],
          },
          // The signed in toolbar renders inside ClientOnly, which this mount
          // has no client context for - without the stub the whole strip, QA
          // button included, is absent from the markup.
          ClientOnly: { template: "<div><slot /></div>" },
          "v-main": { template: "<div><slot /></div>" },
          "v-toolbar": { template: "<div><slot /></div>" },
          "v-container": { template: "<div><slot /></div>" },
        },
      },
    });

    const qa = wrapper.findAll("button").find((b) => b.text().includes("QA"));
    expect(qa).toBeDefined();
    expect(qa!.attributes("to")).toBe("/qa");
    // Unchecked plus reported-problem entries, both of which are still this
    // user's to look at.
    expect(qa!.text()).toContain("3");
  });
});
