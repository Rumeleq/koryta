import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import type { Query } from "~~/server/api/nodes/index.get";
import NowePage from "../../../app/pages/eksploruj/nowe.vue";

const vuetify = createVuetify({ components, directives });

// The route query is what the filters read and write, so it is a live object
// the tests rewrite between mounts rather than a fixed one.
const { routeQuery, lastQuery, items } = vi.hoisted(() => ({
  routeQuery: { value: {} as Record<string, string> },
  lastQuery: { value: null as { value: Query } | null },
  // What the list composable hands back. Empty unless a test asks for a
  // focused person, because most of them only look at the query it built.
  items: { value: [] as Record<string, unknown>[] },
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRoute: () => ({
      query: routeQuery.value,
      name: "eksploruj-nowe",
      path: "/eksploruj/nowe",
      params: {},
    }),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), afterEach: vi.fn() }),
  };
});

// Records the query the page built, and hands the page an empty result set.
// Spelled out twice because `vi.mock` is hoisted above anything this file
// defines, and Nuxt aliases the same composable under both prefixes.
vi.mock("~/composables/entity/listWithStats", () => ({
  useListWithStats: vi.fn((apiQuery: { value: Query }) => {
    lastQuery.value = apiQuery;
    return Promise.resolve({
      tableItems: ref(items.value),
      totalItems: ref(items.value.length),
      pending: ref(false),
    });
  }),
}));
vi.mock("~~/app/composables/entity/listWithStats", () => ({
  useListWithStats: vi.fn((apiQuery: { value: Query }) => {
    lastQuery.value = apiQuery;
    return Promise.resolve({
      tableItems: ref(items.value),
      totalItems: ref(items.value.length),
      pending: ref(false),
    });
  }),
}));

vi.mock("~/composables/edges", () => ({
  useEdges: vi.fn(() =>
    Promise.resolve({ sources: ref([]), targets: ref([]) }),
  ),
}));

// Auto-imported, so a `vi.stubGlobal` would not be consulted: the page reaches
// them through the module Nuxt resolved at build time.
vi.mock("~/composables/companyLocations", () => ({
  useCompanyLocations: vi.fn(() => ({
    companyRegions: ref({}),
    companyLocations: ref({}),
    regions: ref({}),
  })),
}));
vi.mock("~/composables/personPlaces", () => ({
  usePersonPlaces: vi.fn(() => ({
    workLocations: ref([]),
    mapLocations: ref([]),
  })),
}));

// `useAuthState` names the database it wants rather than taking vuefire's
// default-database handle, so the vuefire stub below is not enough on its own.
vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return { ...actual, getFirestore: vi.fn(() => ({})) };
});

vi.mock("vuefire", () => ({
  useCurrentUser: vi.fn(() => ref(null)),
  useFirestore: vi.fn(() => ({})),
  useFirebaseApp: vi.fn(() => ({ name: "[DEFAULT]" })),
  useFirebaseAuth: vi.fn(() => ({})),
  useDocument: vi.fn(() => ref(null)),
}));

async function mountPage(query: Record<string, string> = {}) {
  routeQuery.value = query;
  lastQuery.value = null;

  vi.stubGlobal("definePageMeta", vi.fn());
  vi.stubGlobal("useHead", vi.fn());
  vi.stubGlobal("useCookie", (_key: string, opts: { default: () => boolean }) =>
    ref(opts.default()),
  );

  const wrapper = mount(
    { components: { NowePage }, template: "<Suspense><NowePage/></Suspense>" },
    {
      global: {
        plugins: [vuetify],
        stubs: {
          ClientOnly: { template: "<div><slot></slot></div>" },
          ExploreProgressBar: true,
          ExploreTable: true,
          ExploreProposeChange: true,
          CardExplorePerson: true,
          CardEmploymentHistory: true,
          ChartPersonLocations: true,
          NoteEditor: true,
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

describe("/eksploruj/nowe", () => {
  beforeEach(() => {
    lastQuery.value = null;
    items.value = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("defaults to the most recently employed above the minimum score", async () => {
    const wrapper = await mountPage();

    expect(currentQuery()).toMatchObject({
      sortBy: "latestEmploymentStart",
      sortDesc: "true",
      hideVoted: "no_votes",
      minVotes: 3,
    });
    expect(wrapper.text()).toContain("Najnowsze zatrudnienia");
    expect(
      (wrapper.find('input[type="number"]').element as HTMLInputElement).value,
    ).toBe("3");
  });

  it("takes the minimum score from the url", async () => {
    await mountPage({ minVotes: "1" });

    expect(currentQuery().minVotes).toBe(1);
  });

  it("sorts by the vote total and drops the minimum in the votes mode", async () => {
    const wrapper = await mountPage({ order: "votes", minVotes: "1" });

    const query = currentQuery();
    expect(query.sortBy).toBe("stats.votes.interesting");
    expect(query.minVotes).toBeUndefined();
    // The threshold only means something for the recent queue, so its field
    // goes away with it.
    expect(wrapper.find('input[type="number"]').exists()).toBe(false);
  });

  it("advances the queue by at least one person", async () => {
    const wrapper = await mountPage();

    expect(currentQuery().page).toBe(1);
    // The step is random, so several contributors working the same queue do
    // not all land on the same person - but never zero, which used to leave
    // the reader where they were on a tenth of the clicks.
    for (let click = 0; click < 25; click++) {
      const before = currentQuery().page as number;
      await wrapper.get('[data-testid="next-person"]').trigger("click");
      expect(currentQuery().page as number).toBeGreaterThan(before);
    }
  });

  it("ticks the three steps off rather than listing five instructions", async () => {
    const wrapper = await mountPage();

    const steps = wrapper.get('[data-testid="explore-steps"]');
    expect(steps.findAll("li.step").map((s) => s.text())).toEqual([
      "1Eksploruj",
      "2Notatka",
      "3Głos",
    ]);
    expect(steps.findAll("li.step--done")).toHaveLength(0);

    // The long version is one click away rather than open on the page.
    expect(steps.text()).toContain("Jak to działa?");
  });

  it("puts the relations above the person card and the notes", async () => {
    items.value = [{ id: "person-1", name: "Testowa Osoba", type: "person" }];
    const wrapper = await mountPage();

    const html = wrapper.html();
    const relations = html.indexOf("explore-relations");
    const person = html.indexOf("card-explore-person-stub");
    const notes = html.indexOf("note-editor-stub");

    expect(relations).toBeGreaterThan(-1);
    expect(person).toBeGreaterThan(relations);
    expect(notes).toBeGreaterThan(relations);
  });
});
