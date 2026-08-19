import { describe, it, expect, vi, afterEach } from "vitest";
import { ref } from "vue";
import { usePersonSearch } from "../../app/composables/usePersonSearch";
import type { PersonRich } from "../../shared/model";

function person(overrides: Partial<PersonRich> = {}): PersonRich {
  return {
    id: "jan",
    type: "person",
    name: "Jan Kowalski",
    companies: [],
    elections: [],
    experience: 0,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePersonSearch", () => {
  it("searches the bare name and the PKW register", () => {
    const { queries } = usePersonSearch(person());
    expect(queries.value).toEqual(["Jan Kowalski", "Jan Kowalski PKW"]);
  });

  it("searches the cities the person has worked in", () => {
    const { queries } = usePersonSearch(
      person({ workLocations: ["Płock", "Warszawa"] }),
    );
    expect(queries.value).toContain("Jan Kowalski Płock");
    expect(queries.value).toContain("Jan Kowalski Warszawa");
  });

  it("puts where they stood for election before where they worked", () => {
    const { queries } = usePersonSearch(
      person({
        elections: [{ location: "Kraków", position: "Rada miasta" }],
        workLocations: ["Płock"],
      }),
    );
    expect(queries.value).toEqual([
      "Jan Kowalski",
      "Jan Kowalski PKW",
      "Jan Kowalski Kraków",
      "Jan Kowalski Płock",
    ]);
  });

  it("does not search a city twice when it is both", () => {
    // A councillor employed by their own gmina, which is common.
    const { queries } = usePersonSearch(
      person({
        elections: [{ location: "Kraków", position: "Rada miasta" }],
        workLocations: ["Kraków"],
      }),
    );
    expect(
      queries.value.filter((q) => q === "Jan Kowalski Kraków"),
    ).toHaveLength(1);
  });

  it("drops the middle name from a location query", () => {
    const { queries } = usePersonSearch(
      person({ name: "Jan Maria Kowalski", workLocations: ["Płock"] }),
    );
    expect(queries.value).toContain("Jan Kowalski Płock");
  });

  it("takes cities the caller worked out itself", () => {
    const extra = ref<string[] | undefined>(["Gdańsk"]);
    const { queries } = usePersonSearch(person(), undefined, undefined, extra);
    expect(queries.value).toContain("Jan Kowalski Gdańsk");
  });

  it("caps how many tabs searchAll can open", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    const cities = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const { queries, searchAll } = usePersonSearch(
      person({ workLocations: cities }),
    );

    // Name, PKW, and six of the eight cities.
    expect(queries.value).toHaveLength(8);

    searchAll();
    // Two more for rejestr.io and the two wikipedia spellings.
    expect(open).toHaveBeenCalledTimes(11);
  });
});
