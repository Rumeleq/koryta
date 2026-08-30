import { describe, it, expect } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import HospitalBoardTable from "../../../app/components/stats/HospitalBoardTable.vue";
import type { HospitalTableRow } from "../../../app/composables/stats/useHospitalBoards";
import { partyDisplay } from "../../../app/composables/stats/useHospitalBoards";

const row = (overrides: Partial<HospitalTableRow> = {}): HospitalTableRow => ({
  id: "abc",
  name: "Szpital Miejski",
  to: "/instytucja/szpital-miejski-abc",
  peopleTo: "/eksploruj/tabela?place=abc",
  organ: "Rada nadzorcza",
  legalForm: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
  seats: 3,
  parties: [partyDisplay("PiS"), partyDisplay("__NONE__")],
  ...overrides,
});

const mountTable = (rows: HospitalTableRow[]) =>
  mountSuspended(HospitalBoardTable, {
    props: {
      title: "Szpitale z radą nadzorczą",
      subtitle: "Wypisujemy 1 szpital z obsadzonym organem.",
      rows,
      emptyText: "Nie mamy jeszcze w bazie żadnego miejsca.",
    },
  });

describe("StatsHospitalBoardTable", () => {
  it("names the hospital, its organ and the seats behind the number", async () => {
    const wrapper = await mountTable([row()]);
    const text = wrapper.text();
    expect(text).toContain("Szpital Miejski");
    expect(text).toContain("Rada nadzorcza");
    expect(text).toContain("3");
    expect(
      wrapper.find('a[href="/instytucja/szpital-miejski-abc"]').exists(),
    ).toBe(true);
    expect(wrapper.find('a[href="/eksploruj/tabela?place=abc"]').exists()).toBe(
      true,
    );
  });

  it("labels a party the site has no chip for instead of drawing an empty one", async () => {
    // PartyChip paints no fill for a key `partyColors` does not know, so the
    // sentinel has to be caught before it reaches one and reads as a party.
    const wrapper = await mountTable([row()]);
    expect(wrapper.text()).toContain("Bez partii w bazie");
    expect(wrapper.text()).not.toContain("__NONE__");
  });

  it("says so rather than drawing an empty table", async () => {
    const wrapper = await mountTable([]);
    expect(wrapper.text()).toContain(
      "Nie mamy jeszcze w bazie żadnego miejsca",
    );
    expect(wrapper.find("tbody").exists()).toBe(false);
  });
});
