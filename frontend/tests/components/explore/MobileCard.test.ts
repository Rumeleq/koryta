import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import MobileCard from "../../../app/components/explore/table/MobileCard.vue";
import type { PersonRich } from "../../../shared/model";

/** A person as the explore table hands one over: rich enough that every branch
 * of the card has something to draw. The fixtures the screenshot tests run
 * against are much barer than this, which is why the numbers and the elections
 * are asserted here rather than there. */
function person(fields: Partial<PersonRich> = {}): PersonRich {
  return {
    id: "p1",
    type: "person",
    name: "Jan Kowalski",
    parties: ["PO"],
    companies: ["ORLEN SPÓŁKA AKCYJNA"],
    elections: [],
    experience: 0,
    ...fields,
  } as PersonRich;
}

async function render(item: PersonRich, props = {}) {
  return await mountSuspended(MobileCard, { props: { item, ...props } });
}

describe("ExploreTableMobileCard", () => {
  it("shows who this is and where they worked", async () => {
    const wrapper = await render(person());
    expect(wrapper.text()).toContain("Jan Kowalski");
    expect(wrapper.text()).toContain("PO");
    expect(wrapper.text()).toContain("ORLEN SPÓŁKA AKCYJNA");
  });

  it("counts the way Polish does", async () => {
    const wrapper = await render(
      person({
        experience: 1,
        stats: { isApproved: true, notesCount: 3, votes: { interesting: 5 } },
      }),
    );
    const text = wrapper.text();
    expect(text).toContain("1 rok pracy");
    expect(text).toContain("3 notatki");
    expect(text).toContain("5 głosów");
  });

  it("survives a node whose stats predate the vote counters", async () => {
    // Most documents carry only what has been computed for them - a person
    // nobody has voted on has no `stats.votes` at all, whatever the interface
    // says. Reading through it threw, and a row whose render throws comes out
    // as an empty cell rather than as an error anybody would notice.
    const wrapper = await render(
      person({ stats: { nodeGroupSize: 1 } as never }),
    );
    expect(wrapper.text()).toContain("Jan Kowalski");
  });

  it("leaves out the numbers nobody has recorded", async () => {
    // The desktop table prints a zero in each of these columns. Down a phone
    // that is four zeroes per person and nothing learned, so the line is
    // dropped instead.
    const wrapper = await render(person());
    expect(wrapper.text()).not.toContain("0 lat pracy");
    expect(wrapper.text()).not.toContain("ostatnie zatrudnienie");
  });

  it("draws a candidacy with its year and committee", async () => {
    const wrapper = await render(
      person({
        elections: [
          {
            year: "2018",
            location: "Kraków",
            teryt: "1261",
            position: "radny",
            committee: "KWW Wspólny Kraków",
          },
        ],
      }),
    );
    const text = wrapper.text();
    expect(text).toContain("2018");
    expect(text).toContain("Kraków");
    expect(text).toContain("KWW Wspólny Kraków");
  });

  it("says whether a page is a draft only where drafts are visible", async () => {
    const draft = person({ visibility: false });
    expect((await render(draft)).text()).not.toContain("Szkic");
    expect((await render(draft, { showVisibility: true })).text()).toContain(
      "Szkic",
    );
  });

  it("offers the drawer as a link unless the caller drives focus itself", async () => {
    const withFocus = await render(person());
    expect(withFocus.find("a").exists()).toBe(true);

    const withoutFocus = await render(person(), { disableFocus: true });
    expect(withoutFocus.find("a").exists()).toBe(false);
  });
});
