import { describe, it, expect, vi } from "vitest";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { computed, ref, type Ref } from "vue";
import type {
  HospitalStats,
  SupervisoryGroup,
} from "../../../server/api/stats/hospitals.get";
import {
  NO_PARTY,
  hospitalTableRows,
  partyDisplay,
  partySeatRows,
  supervisionSegments,
  useHospitalBoards,
} from "../../../app/composables/stats/useHospitalBoards";
import { supervisoryOrganLabel } from "../../../shared/companyOrgans";
import { partyColors } from "../../../shared/misc";

function group(overrides: Partial<SupervisoryGroup> = {}): SupervisoryGroup {
  return {
    kinds: ["rada_nadzorcza"],
    hospitals: 0,
    hospitalsWithSeats: 0,
    seats: 0,
    endedSeats: 0,
    seatsWithParty: 0,
    byParty: [],
    rows: [],
    ...overrides,
  };
}

describe("partyDisplay", () => {
  it("gives a tracked party its own colour", () => {
    expect(partyDisplay("PiS")).toEqual({
      party: "PiS",
      label: "PiS",
      color: partyColors.PiS,
      known: true,
    });
  });

  it("greys a party the site has no chip for", () => {
    // PartyChip emits no background at all for an unknown key, so the caller
    // has to decide the colour before anything is drawn.
    const display = partyDisplay("Bezpartyjni Samorządowcy");
    expect(display.known).toBe(false);
    expect(display.label).toBe("Bezpartyjni Samorządowcy");
    expect(display.color).toBeTruthy();
  });

  it("labels the no-party sentinel rather than showing it", () => {
    const display = partyDisplay(NO_PARTY);
    expect(display.known).toBe(false);
    expect(display.label).toBe("Bez partii w bazie");
    expect(display.label).not.toContain("__");
  });
});

describe("partySeatRows", () => {
  const rows = partySeatRows(
    group({
      seats: 10,
      seatsWithParty: 8,
      byParty: [
        { party: "PiS", seats: 5, people: 4, hospitals: 3 },
        { party: "PO", seats: 3, people: 3, hospitals: 2 },
        { party: NO_PARTY, seats: 2, people: 2, hospitals: 2 },
      ],
    }),
  );

  it("keeps the order the endpoint sorted in", () => {
    expect(rows.map((row) => row.party)).toEqual(["PiS", "PO", NO_PARTY]);
  });

  it("takes the share against the seats that carry a party", () => {
    // 5 of the 8 attributable seats, not 5 of 10 - a person with two parties is
    // counted under both, so the group's own total cannot be the denominator.
    expect(rows[0]?.share).toBeCloseTo(5 / 8);
    expect(rows[1]?.share).toBeCloseTo(3 / 8);
  });

  it("leaves the unattributed bucket without a share", () => {
    // A percentage next to "no party" reads as a party's result.
    expect(rows[2]?.share).toBeNull();
  });

  it("links each row to the same seats in the explore table", () => {
    expect(rows[0]?.to).toBe("/eksploruj/tabela?party=PiS&category=szpitale");
    expect(rows[2]?.to).toBe(
      "/eksploruj/tabela?party=__NONE__&category=szpitale",
    );
  });

  it("does not divide by zero when nothing carries a party", () => {
    const none = partySeatRows(
      group({
        seats: 2,
        seatsWithParty: 0,
        byParty: [{ party: NO_PARTY, seats: 2, people: 2, hospitals: 1 }],
      }),
    );
    expect(none[0]?.share).toBeNull();
  });

  it("is empty before the response arrives", () => {
    expect(partySeatRows(undefined)).toEqual([]);
  });
});

describe("hospitalTableRows", () => {
  const rows = hospitalTableRows(
    group({
      hospitals: 3,
      hospitalsWithSeats: 2,
      rows: [
        {
          id: "abc",
          name: "Szpital Miejski w Łodzi",
          supervisoryOrgan: "rada_nadzorcza",
          legalForm: "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
          seats: 4,
          parties: ["PiS", NO_PARTY],
        },
        {
          id: "def",
          name: "Szpital Powiatowy",
          supervisoryOrgan: null,
          legalForm: null,
          seats: 1,
          parties: [],
        },
        {
          id: "ghi",
          name: "Szpital bez obsady",
          supervisoryOrgan: "rada_nadzorcza",
          legalForm: null,
          seats: 0,
          parties: [],
        },
      ],
    }),
  );

  it("drops the hospitals nobody is on record at", () => {
    // They are counted in the card's subtitle instead: an empty row says
    // nothing about a party and buries the rows that do.
    expect(rows.map((row) => row.id)).toEqual(["abc", "def"]);
  });

  it("links to the institution page and to its people", () => {
    expect(rows[0]?.to).toBe("/instytucja/szpital-miejski-w-lodzi-abc");
    expect(rows[0]?.peopleTo).toBe("/eksploruj/tabela?place=abc");
  });

  it("names the organ in Polish and separates 'not checked' from 'none filed'", () => {
    expect(rows[0]?.organ).toBe("Rada nadzorcza");
    expect(rows[1]?.organ).toBe("Nie sprawdzono");
    expect(supervisoryOrganLabel("brak")).toBe("Brak organu w KRS");
    expect(supervisoryOrganLabel("rada_spoleczna")).toBe("Rada społeczna");
  });

  it("resolves each party on the board to something drawable", () => {
    expect(rows[0]?.parties.map((party) => party.known)).toEqual([true, false]);
    expect(rows[0]?.parties[1]?.label).toBe("Bez partii w bazie");
    expect(rows[1]?.parties).toEqual([]);
  });
});

describe("supervisionSegments", () => {
  const stats: HospitalStats = {
    generatedAt: "2026-08-22T00:00:00.000Z",
    hospitals: 12,
    paid: group({ hospitals: 5 }),
    unpaid: group({ kinds: ["rada_spoleczna"], hospitals: 4 }),
    other: group({ kinds: ["brak"], hospitals: 3 }),
  };

  it("draws the exclusion instead of performing it silently", () => {
    const segments = supervisionSegments(stats);
    expect(segments.map((segment) => [segment.key, segment.value])).toEqual([
      ["paid", 5],
      ["unpaid", 4],
      ["other", 3],
    ]);
    expect(segments[1]?.label).toContain("nieuwzględnione");
  });

  it("accounts for every hospital the response counted", () => {
    const total = supervisionSegments(stats).reduce(
      (sum, segment) => sum + segment.value,
      0,
    );
    expect(total).toBe(stats.hospitals);
  });

  it("is empty before the response arrives", () => {
    expect(supervisionSegments(null)).toEqual([]);
  });
});

// A holder the tests drop a real `ref` into, rather than a plain object with a
// `value`: the composable builds a `computed` over the user, so the third test
// below only means anything if what it mutates is genuinely reactive. The ref
// cannot be made in the `vi.hoisted` factory, which runs before vue is
// imported.
const { userHolder, mockUseFetch } = vi.hoisted(() => ({
  userHolder: { user: null as Ref<{ uid: string } | null> | null },
  mockUseFetch: vi.fn(),
}));
vi.mock("vuefire", () => ({ useCurrentUser: () => userHolder.user }));
// `vi.stubGlobal` cannot reach this: the suite runs in the Nuxt environment,
// where `useFetch` is a real auto-import resolved from `#app` rather than a
// global the composable reads at call time.
mockNuxtImport("useFetch", () => mockUseFetch);

describe("useHospitalBoards", () => {
  async function capturedQuery(user: { uid: string } | null = null) {
    userHolder.user = ref(user);
    let options: { query?: Ref<Record<string, string>> } | undefined;
    mockUseFetch.mockImplementation((_url: string, opts: typeof options) => {
      options = opts;
      return {
        data: ref(null),
        pending: ref(false),
        error: ref(null),
        refresh: vi.fn(),
      };
    });
    await useHospitalBoards();
    return computed(() => options?.query?.value);
  }

  it("asks for the plain URL when nobody is signed in", async () => {
    // The one the six-hour cache holds, ours and Cloud CDN's, and the one that
    // gets indexed. An anonymous reader has published nothing and has no reason
    // to pay for a recount.
    expect((await capturedQuery()).value).toEqual({});
  });

  it("asks for the latest numbers once there is a signed-in reader", async () => {
    // A signed-in reader is the person who might have just published a board
    // member. `latest` is what makes the endpoint answer `no-store`, which is
    // the only instruction Cloud CDN takes - clearing the server-side cache on
    // publication never reached the copy at the edge.
    expect((await capturedQuery({ uid: "admin-uid" })).value).toEqual({
      latest: "true",
    });
  });

  it("re-asks when the user resolves after the page has rendered", async () => {
    const query = await capturedQuery(null);
    expect(query.value).toEqual({});

    // vuefire settles the user after hydration, so at server-render time there
    // is nobody to know about yet. The query is reactive precisely so `useFetch`
    // refetches at that point rather than leaving the editor on the cached copy.
    userHolder.user!.value = { uid: "admin-uid" };

    expect(query.value).toEqual({ latest: "true" });
  });
});
