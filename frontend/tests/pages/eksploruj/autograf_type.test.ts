import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import AutografPage from "../../../../app/pages/eksploruj/autograf/[type].vue";
import { ref } from "vue";
import type { Query } from "~~/server/api/nodes/index.get";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

const vuetify = createVuetify({
  components,
  directives,
});

// Live boxes, the way tests/pages/eksploruj/tabela.test.ts keeps them: `vi.mock`
// is hoisted above every declaration in this file, so a factory can only reach
// something hoisted with it.
const { routeQuery, lastQuery } = vi.hoisted(() => ({
  routeQuery: { value: {} as Record<string, string> },
  lastQuery: { value: null as { value: Query } | null },
}));

// Mock vue-router explicitly since it's imported
vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRoute: () => ({
      query: routeQuery.value,
      name: "eksploruj-autograf-type",
      path: "/eksploruj/autograf/spolki-partie",
      params: { type: "spolki-partie" },
    }),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), afterEach: vi.fn() }),
  };
});

// Mock Nuxt auto-imports
vi.stubGlobal("definePageMeta", vi.fn());
vi.stubGlobal("useHead", vi.fn());

// Mock Composables
vi.mock("~~/app/composables/entity/listWithStats", () => ({
  useListWithStats: vi.fn((apiQuery: { value: Query }) => {
    lastQuery.value = apiQuery;
    return Promise.resolve({
      tableItems: ref([]),
      totalItems: ref(0),
      pending: ref(false),
    });
  }),
}));
// Nuxt aliases it to ~ as well
vi.mock("~/composables/entity/listWithStats", () => ({
  useListWithStats: vi.fn((apiQuery: { value: Query }) => {
    lastQuery.value = apiQuery;
    return Promise.resolve({
      tableItems: ref([]),
      totalItems: ref(0),
      pending: ref(false),
    });
  }),
}));

vi.mock("vuefire", () => ({
  useCurrentUser: vi.fn(() => ref(null)),
  useFirestore: vi.fn(() => ({})),
  useFirebaseApp: vi.fn(() => ({ name: "[DEFAULT]" })),
  useFirebaseAuth: vi.fn(() => ({})),
  useDocument: vi.fn(() => ref(null)),
}));

// `useAuthState` names the database it wants (`getFirestore(app, "koryta-pl")`)
// rather than taking vuefire's default-database handle, so the stub above is no
// longer enough on its own - the real `getFirestore` would reject the fake app.
vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return { ...actual, getFirestore: vi.fn(() => ({})) };
});

vi.stubGlobal("useEntities", (type: string) => {
  if (type === "place") {
    return { entities: ref({}) };
  }
  if (type === "region") {
    return { entities: ref({}) };
  }
  return { entities: ref({}) };
});

// Mock NuxtLink component
const NuxtLinkStub = {
  template: "<a><slot /></a>",
};

async function mountPage(query: Record<string, string> = {}) {
  routeQuery.value = query;
  lastQuery.value = null;

  const wrapper = mount(
    {
      components: { AutografPage },
      template: "<Suspense><AutografPage/></Suspense>",
    },
    {
      global: {
        plugins: [vuetify],
        stubs: {
          ClientOnly: { template: "<div><slot></slot></div>" },
          FormEksplorujTabelaFilters: true,
          ExploreVisualisationCompanies: true,
          ExploreLoginBanner: true,
          NuxtLink: NuxtLinkStub,
        },
      },
    },
  );

  await flushPromises();
  return wrapper;
}

function currentQuery(): Query {
  if (!lastQuery.value) throw new Error("useListWithStats was never called");
  return lastQuery.value.value;
}

describe("AutografPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("renders correctly with empty data", async () => {
    const wrapper = await mountPage();

    expect(wrapper.html()).toContain("Wizualizacje dla");
    expect(wrapper.html()).toContain("Wybierz wizualizację");
    // Since totalItems is 0, warning about limit should not be visible
    expect(wrapper.html()).not.toContain(
      "Zbyt wiele osób pasuje do aktualnych filtrów",
    );
  });

  /** The bar draws „Typ podmiotu”, „Zatrudnieni od” and „Min. głosy łącznie”
   * whatever this page binds. Left unbound they wrote into the component's own
   * `defineModel` state, so picking „Szpitale” here made the button read
   * „Filtry (1)” while the chart under it was still drawn from an unfiltered
   * query and nothing on screen moved. */
  it("filters the chart by everything the bar offers", async () => {
    const wrapper = await mountPage({
      category: "szpitale",
      minEmploymentDate: "2020-01-01",
      minVotes: "5",
      teryt: "teryt14",
    });

    expect(currentQuery()).toMatchObject({
      category: "szpitale",
      minEmploymentDate: "2020-01-01",
      minVotes: 5,
      teryt: "teryt14",
    });
    // ...and the bar is told about them too, or its chips would describe a
    // narrower table than the one it is filtering.
    // The stub flattens every prop name to lower case.
    const bar = wrapper.find("form-eksploruj-tabela-filters-stub");
    expect(bar.attributes("category")).toBe("szpitale");
    expect(bar.attributes("minemploymentdate")).toBe("2020-01-01");
    expect(bar.attributes("minvotes")).toBe("5");
  });
});
