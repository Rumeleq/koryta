import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import ErrorPage from "../../app/error.vue";

const vuetify = createVuetify({ components, directives });

// mockNuxtImport is hoisted above the module body, so the spy has to be too.
const { clearError } = vi.hoisted(() => ({ clearError: vi.fn() }));
mockNuxtImport("clearError", () => clearError);
mockNuxtImport("useSeoMeta", () => vi.fn());

const mountError = (statusCode: number, message = "boom") =>
  mount(ErrorPage, {
    props: { error: { statusCode, message } },
    global: {
      plugins: [vuetify],
      stubs: {
        // The error page is rendered outside app.vue, so it brings its own
        // <v-app> and layout; neither is what these assertions are about.
        NuxtLayout: { template: "<div><slot /></div>" },
        "v-app": { template: "<div><slot /></div>" },
        "v-btn": {
          template: "<button :to='to'><slot /></button>",
          props: ["to"],
        },
        "v-icon": true,
      },
    },
  });

describe("ErrorPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows a not-found message for 404", () => {
    const wrapper = mountError(404);

    expect(wrapper.text()).toContain("404");
    expect(wrapper.text()).toContain("Nie ma takiej strony");
    expect(wrapper.html()).toContain('to="/eksploruj/tabela"');
  });

  it("shows a generic message for server errors", () => {
    const wrapper = mountError(500);

    expect(wrapper.text()).toContain("500");
    expect(wrapper.text()).toContain("Coś poszło nie tak");
    expect(wrapper.html()).toContain('to="/pomoc"');
  });

  it("clears the error state when going home", async () => {
    const wrapper = mountError(404);

    await wrapper.findAll("button")[0]!.trigger("click");

    expect(clearError).toHaveBeenCalledWith({ redirect: "/" });
  });
});
