import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { mdiCheckCircleOutline, mdiCloseCircleOutline } from "@mdi/js";
import Table from "../../../app/components/explore/Table.vue";
import type { PersonRich } from "../../../shared/model";

/** One row, reduced to what the "Wybory" column reads. */
function person(elected?: boolean): PersonRich {
  return {
    id: "p1",
    name: "Cezary Obejmujący",
    type: "person",
    companies: [],
    experience: 0,
    elections: [
      {
        year: "2024",
        location: "Powiat Testowy",
        position: "Rada powiatu",
        elected,
      },
    ],
  } as unknown as PersonRich;
}

async function render(elected?: boolean) {
  return await mountSuspended(Table, {
    props: {
      items: [person(elected)],
      totalItems: 1,
      pending: false,
      headers: [
        { title: "Imię i nazwisko", key: "name" },
        { title: "Wybory", key: "elections" },
      ],
      hideDefaultFooter: true,
    },
  });
}

describe("ExploreTable elections column", () => {
  it("marks a candidacy whose result is known", async () => {
    // An icon rather than a colour: an outlined chip draws its label in
    // whatever colour it is given, and this theme's primary is 1.85:1 on
    // white. The wording of all three states lives in the tooltip, which
    // Vuetify only renders once it is opened - `shared/election.ts` is where
    // that wording is tested.
    const won = await render(true);
    expect(won.html()).toContain(mdiCheckCircleOutline);

    const lost = await render(false);
    expect(lost.html()).toContain(mdiCloseCircleOutline);
  });

  it("leaves an unrecorded result unmarked", async () => {
    // Which is every stored candidacy until the people are ingested again.
    const unknown = await render(undefined);
    expect(unknown.html()).not.toContain(mdiCheckCircleOutline);
    expect(unknown.html()).not.toContain(mdiCloseCircleOutline);
  });

  it("keeps the year and the place the chip already carried", async () => {
    const wrapper = await render(false);
    expect(wrapper.text()).toContain("2024");
    expect(wrapper.text()).toContain("Powiat Testowy");
  });
});
