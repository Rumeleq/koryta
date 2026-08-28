import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { flushPromises } from "@vue/test-utils";
import { clearNuxtData } from "#app";
import { getQuery } from "h3";
import PersonFacts from "../../../app/components/extraction/PersonFacts.vue";
import type { ExtractionFact } from "../../../shared/model";

const currentUser = ref<{ uid: string } | null>({ uid: "reader" });
vi.mock("~/composables/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/composables/auth")>()),
  useAuthState: () => ({ user: currentUser }),
}));

/** What the endpoint answers with, set by each test before it mounts. */
let response: { facts: ExtractionFact[]; total: number } | null = {
  facts: [],
  total: 0,
};

/** The query the component actually sent — the whole point of the section is
 * that it asks by node id and not by name, and that a logged out reader's
 * request never asks for the facts themselves. */
let lastQuery: Record<string, unknown> = {};

registerEndpoint("/api/extractions", (event) => {
  lastQuery = getQuery(event);
  if (response === null) throw new Error("index missing");
  // The real handler returns no facts for a count-only request; mirroring that
  // here is what makes the logged out assertions mean anything.
  if (lastQuery.countOnly) return { facts: [], total: response.total };
  return response;
});

function fact(fields: Partial<ExtractionFact> = {}): ExtractionFact {
  return {
    id: "fact-1",
    url: "example.com/a",
    articleUrl: "example.com/a",
    articleDomain: "example.com",
    justification: "radny PiS Piotr Gajda",
    fact_type: "party_membership",
    person: "Piotr Gajda",
    party: "Prawo i Sprawiedliwość",
    personNodeId: "abc123",
    personNodeName: "Piotr Gajda",
    tag: "v26",
    ...fields,
  } as ExtractionFact;
}

async function mount() {
  const section = await mountSuspended(PersonFacts, {
    props: { nodeId: "abc123" },
  });
  await flushPromises();
  return section;
}

describe("ExtractionPersonFacts", () => {
  beforeEach(() => {
    clearNuxtData();
    response = { facts: [], total: 0 };
    lastQuery = {};
    currentUser.value = { uid: "reader" };
  });

  it("asks for one person's facts by node id, not by name", async () => {
    response = { facts: [fact()], total: 1 };
    await mount();

    expect(lastQuery.personNodeId).toBe("abc123");
    // A name would collect the namesakes this whole feature exists to keep
    // apart, so it must not be in the query at all.
    expect(lastQuery.person).toBeUndefined();
  });

  it("renders a card per matched fact under a heading", async () => {
    response = {
      facts: [fact(), fact({ id: "fact-2" })],
      total: 2,
    };
    const section = await mount();

    expect(section.find("[data-testid='person-extractions']").exists()).toBe(
      true,
    );
    expect(section.text()).toContain("Fakty z artykułów");
    expect(section.findAll(".extraction-card")).toHaveLength(2);
  });

  it("lays the cards out two to a row from md up", async () => {
    response = { facts: [fact(), fact({ id: "fact-2" })], total: 2 };
    const section = await mount();

    // Full width on a phone, half from md — what `cols="12" md="6"` compiles to.
    const cols = section.findAll(".v-col-12");
    expect(cols).toHaveLength(2);
    expect(cols[0]!.classes()).toContain("v-col-md-6");
  });

  it("carries no vote buttons, so a long section opens no listeners", async () => {
    // Each vote widget subscribes to the fact's vote document; this section
    // mounts every card at once instead of behind an expander, so it omits
    // them. The card's own wrong-person flag is a write, not a listener.
    response = { facts: [fact()], total: 1 };
    const section = await mount();

    expect(section.find(".extraction-actions").exists()).toBe(false);
  });

  it("renders nothing at all when the person has no matched facts", async () => {
    response = { facts: [], total: 0 };
    const section = await mount();

    // Not an empty heading: a section announcing itself over empty space reads
    // as a page that failed to load, and most people have no matched facts.
    expect(section.find("[data-testid='person-extractions']").exists()).toBe(
      false,
    );
    expect(section.text()).not.toContain("Fakty z artykułów");
  });

  it("stays silent when the query fails", async () => {
    // The composite index this query needs is deployed by hand, so a failing
    // endpoint is a state a public person page can really be in. It must cost
    // the page a section, not the render.
    response = null;
    const section = await mount();

    expect(section.find("[data-testid='person-extractions']").exists()).toBe(
      false,
    );
  });

  it("says so when it is showing only part of what was found", async () => {
    response = { facts: [fact()], total: 40 };
    const section = await mount();

    expect(
      section.find("[data-testid='person-extractions-hidden']").text(),
    ).toContain("40");
  });

  describe("logged out", () => {
    beforeEach(() => {
      currentUser.value = null;
    });

    it("never asks the server for the facts themselves", async () => {
      // The lock is the request, not the blur: `filter` is a paint
      // instruction, so anything fetched would sit readable in the html of a
      // named person's canonical url.
      response = { facts: [fact()], total: 3 };
      await mount();

      expect(lastQuery.countOnly).toBe("true");
      expect(lastQuery.personNodeId).toBe("abc123");
    });

    it("says how many were found and offers a way in", async () => {
      response = { facts: [fact()], total: 3 };
      const section = await mount();

      const count = section.find("[data-testid='person-extractions-count']");
      expect(count.exists()).toBe(true);
      expect(count.text()).toContain("3 fakty");
      expect(
        section.find("[data-testid='person-extractions-locked']").exists(),
      ).toBe(true);
      expect(section.text()).toContain("Zaloguj się lub załóż konto");
    });

    it("declines the Polish plural properly", async () => {
      response = { facts: [], total: 5 };
      const section = await mount();

      expect(
        section.find("[data-testid='person-extractions-count']").text(),
      ).toContain("5 faktów");
    });

    it("shows no fact text and no cards at all", async () => {
      response = { facts: [fact()], total: 3 };
      const section = await mount();

      expect(section.findAll(".extraction-card")).toHaveLength(0);
      expect(section.text()).not.toContain("Piotr Gajda");
      expect(section.text()).not.toContain("radny PiS");
      expect(section.html()).not.toContain("Prawo i Sprawiedliwość");
    });

    it("keeps quiet about a person nobody wrote about", async () => {
      response = { facts: [], total: 0 };
      const section = await mount();

      expect(section.find("[data-testid='person-extractions']").exists()).toBe(
        false,
      );
    });

    it("sends the reader back here after logging in", async () => {
      response = { facts: [], total: 2 };
      const section = await mount();

      // The button's target rather than the rendered href: RouterLink resolves
      // to an anchor with no href under the test router, so the attribute says
      // nothing about what the app would do.
      const button = section.findComponent({ name: "VBtn" });
      expect(button.props("to")).toContain("/login?redirect=");
    });
  });
});
