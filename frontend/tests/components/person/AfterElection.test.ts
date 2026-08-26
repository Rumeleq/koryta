import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import AfterElection from "../../../app/components/person/AfterElection.vue";
import type { EdgeNode } from "../../../app/composables/edges";

/** A candidacy, as the local graph hands one to a person's page. */
function candidacy(fields: Partial<EdgeNode> = {}): EdgeNode {
  return {
    id: "e-election",
    type: "election",
    label: "kandydatura",
    source: "person",
    target: "powiat",
    start_date: "2024-01-01",
    position: "Rada powiatu",
    richNode: { id: "powiat", type: "region", name: "Powiat Testowy" },
    ...fields,
  } as EdgeNode;
}

/** A post, likewise. */
function post(fields: Partial<EdgeNode> = {}): EdgeNode {
  return {
    id: "e-post",
    type: "employed",
    label: "Rada Nadzorcza",
    source: "person",
    target: "zaklad",
    start_date: "2024-04-12",
    richNode: { id: "zaklad", type: "place", name: "Zakład Testowy" },
    ...fields,
  } as EdgeNode;
}

async function render(edges: EdgeNode[]) {
  return await mountSuspended(AfterElection, { props: { edges } });
}

describe("PersonAfterElection", () => {
  it("pairs a lost candidacy with the post that followed it", async () => {
    const wrapper = await render([candidacy({ elected: false }), post()]);

    expect(wrapper.find('[data-testid="after-election"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Powiat Testowy");
    expect(wrapper.text()).toContain("Zakład Testowy");
    expect(wrapper.text()).toContain("Bez mandatu");
    expect(wrapper.text()).toContain("w tym samym roku");
  });

  it("says so when the post came the year after", async () => {
    const wrapper = await render([
      candidacy({ start_date: "2023-01-01", elected: true }),
      post({ start_date: "2024-01-15" }),
    ]);

    expect(wrapper.text()).toContain("w następnym roku");
    expect(wrapper.text()).toContain("Mandat zdobyty");
  });

  it("names the result as unknown rather than as a loss", async () => {
    // Every candidacy in production is in this state until the people are
    // ingested again. The section still runs - the timing is a fact on its
    // own - but it does not turn a missing column into a lost election.
    const wrapper = await render([
      candidacy({ start_date: "2017-01-01", elected: undefined }),
      post({ start_date: "2018-01-01" }),
    ]);

    expect(wrapper.text()).toContain("Wynik nieznany");
    expect(wrapper.text()).not.toContain("Bez mandatu");
  });

  it("renders nothing at all when nothing lines up", async () => {
    // A heading over empty space reads as a page that failed to load, and on
    // most people the register supports nothing here.
    const wrapper = await render([
      candidacy({ start_date: "2014-01-01" }),
      post({ start_date: "2024-04-12" }),
    ]);

    expect(wrapper.find('[data-testid="after-election"]').exists()).toBe(false);
  });

  it("renders nothing when the person has no candidacies", async () => {
    const wrapper = await render([post()]);
    expect(wrapper.find('[data-testid="after-election"]').exists()).toBe(false);
  });

  it("admits when more than one candidacy fits the window", async () => {
    const wrapper = await render([
      candidacy({ id: "e-a", target: "powiat-a" }),
      candidacy({
        id: "e-b",
        target: "powiat-b",
        richNode: { id: "powiat-b", type: "region", name: "Powiat Drugi" },
      }),
      post(),
    ]);

    const note = wrapper.find('[data-testid="after-election-also-note"]');
    expect(note.exists()).toBe(true);
    expect(note.text()).toContain("1 inna kandydatura");
    // One card, not two: the person took the job once.
    expect(wrapper.findAll(".afel")).toHaveLength(1);
  });

  it("says out loud that it is pairing dates rather than causes", async () => {
    const wrapper = await render([candidacy({ elected: false }), post()]);
    expect(
      wrapper.find('[data-testid="after-election-lead"]').text(),
    ).toContain("nie twierdzenie o przyczynie");
  });
});
