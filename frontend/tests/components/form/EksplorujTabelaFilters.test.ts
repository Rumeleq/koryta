import { describe, it, expect, vi, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { enableAutoUnmount } from "@vue/test-utils";
import { nextTick } from "vue";
import Filters from "../../../app/components/form/EksplorujTabelaFilters.vue";

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

// Vuetify's overlay machinery observes its activator, and happy-dom ships no
// ResizeObserver - without this the first menu or dialog open throws instead of
// rendering its contents.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Menus and dialogs are teleported to <body> and outlive their component, so a
// panel left open by one test is still on screen for the next one.
enableAutoUnmount(afterEach);

const mount = (props: Record<string, unknown> = {}) =>
  mountSuspended(Filters, {
    props: {
      availableParties: [{ title: "PiS", value: "PiS" }],
      availableRegions: [{ title: "Mazowieckie", value: "teryt14" }],
      availableCompanies: [{ title: "Spółka", value: "company-1" }],
      ...props,
    },
  });

type Wrapper = Awaited<ReturnType<typeof mount>>;

/** The bar carries two of these - a menu activator for md and up, a fullscreen
 * dialog activator below it, both in the DOM at once because a display class
 * and not a `v-if` decides which is visible. They say the same thing, and this
 * asks the desktop one: `findAll` would otherwise hand back whichever sits
 * first in the DOM, so a label that drifted on the other activator would go
 * unnoticed here. */
const toggle = (wrapper: Wrapper) => {
  const button = wrapper.find(".v-btn.d-none.d-md-inline-flex");
  if (!button.exists()) throw new Error("no desktop filters button");
  return button;
};

const phoneToggle = (wrapper: Wrapper) => wrapper.find(".v-btn.d-md-none");

const railChips = (wrapper: Wrapper) =>
  wrapper.findAll(".tabela-query-bar__rail .v-chip");

const workRow = (wrapper: Wrapper) =>
  wrapper.find("[data-testid='tabela-work-row']");

/** The overlay that is open right now, wherever it was teleported to. A menu
 * that has been opened and closed stays in the document. */
const openOverlayText = () =>
  [...document.querySelectorAll(".v-overlay--active .v-overlay__content")]
    .map((el) => el.textContent)
    .join(" ");

const sortButton = (wrapper: Wrapper) => {
  const button = wrapper
    .findAll(".v-btn")
    .find((candidate) =>
      candidate.attributes("aria-label")?.startsWith("Sortowanie"),
    );
  if (!button) throw new Error("no sort button");
  return button;
};

/** Everything Vuetify teleported to <body>, dialog contents included. */
const overlayText = () =>
  document.querySelector(".v-overlay-container")?.textContent ?? "";

/** The share dialog's contents do not exist until the overlay has settled. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const buttonNamed = (wrapper: Wrapper, label: string) =>
  wrapper
    .findAll(".v-btn")
    .find((candidate) => candidate.text().trim() === label);

describe("the table's query bar", () => {
  it("counts the filters it is hiding, so none of them work in secret", async () => {
    const wrapper = await mount();
    expect(toggle(wrapper).text()).toBe("Filtry");

    // Two narrowing filters, and two that are set to the value that narrows
    // nothing - those must not be counted.
    await wrapper.setProps({
      party: ["PiS"],
      teryt: "teryt14",
      visibility: "all",
      hideVoted: "all",
    });
    expect(toggle(wrapper).text()).toBe("Filtry (2)");

    await wrapper.setProps({ visibility: "private" });
    expect(toggle(wrapper).text()).toBe("Filtry (3)");
  });

  it("does not count an empty selection as a filter", async () => {
    const wrapper = await mount();
    await wrapper.setProps({ party: [], place: [], teryt: null });
    expect(toggle(wrapper).text()).toBe("Filtry");
  });

  it("names every filter on the rail, in Polish and in full", async () => {
    const wrapper = await mount({
      teryt: "teryt14",
      category: "szpitale",
      minVotes: 5,
    });

    // The region by name rather than by teryt code: `availableRegions` is what
    // resolves one into the other, and it is a prop for exactly this.
    expect(railChips(wrapper).map((chip) => chip.text())).toEqual([
      "Region: Mazowieckie",
      "Szpitale",
      "Min. 5 głosów",
    ]);
  });

  it("says so when nothing is narrowing the table", async () => {
    const wrapper = await mount();

    expect(railChips(wrapper)).toHaveLength(0);
    expect(wrapper.text()).toContain("Wszystkie osoby w bazie");
  });

  it("clears one filter from its chip, and only that one", async () => {
    const wrapper = await mount({ teryt: "teryt14", category: "szpitale" });

    const region = railChips(wrapper).find((chip) =>
      chip.text().includes("Mazowieckie"),
    );
    // VChip's own label for the x is the English „Close”, and it is the same
    // string on all six chips - a reader arriving at it by keyboard would be
    // told nothing about which filter it drops.
    expect(region!.get(".v-chip__close").attributes("aria-label")).toBe(
      "Usuń filtr: Region: Mazowieckie",
    );
    await region!.get(".v-chip__close").trigger("click");

    expect(wrapper.emitted("update:teryt")?.[0]).toEqual([null]);
    expect(wrapper.emitted("update:category")).toBeUndefined();
  });

  /** Ten filters are ten writable computeds over `route.query`, and ten writes
   * in one tick would each start from the same url with the last one winning.
   * The page clears them in a single write; the bar only asks. */
  it("asks the page to clear everything at once", async () => {
    const wrapper = await mount({ teryt: "teryt14", category: "szpitale" });

    await buttonNamed(wrapper, "Wyczyść")!.trigger("click");

    expect(wrapper.emitted("clear")).toHaveLength(1);
  });

  /** One chip is one x away from being gone; a second button for it would be
   * a wider bar for nothing. */
  it("offers no clear-all until there are two filters to clear", async () => {
    const wrapper = await mount({ teryt: "teryt14" });
    expect(buttonNamed(wrapper, "Wyczyść")).toBeUndefined();

    await wrapper.setProps({ category: "szpitale" });
    expect(buttonNamed(wrapper, "Wyczyść")).toBeDefined();
  });

  it("counts the rows at every width", async () => {
    const wrapper = await mount({ totalItems: 1284 });
    // Grouped, and with the non-breaking space `Intl` puts there: the work
    // row a line below says „sprawdzono ... z 1 284 osób”, so the same total
    // spelled „1284” above it read as a second, different number.
    expect(wrapper.text()).toContain("1\u00a0284 osoby");
  });

  /** /eksploruj/autograf/[type] mounts this bar over a chart, with no table
   * and no total to report. A count of nothing would be a lie about an empty
   * search. */
  it("prints no count where the page gave it none", async () => {
    const wrapper = await mount();
    expect(wrapper.find(".tabela-query-bar__count").exists()).toBe(false);
  });

  it("opens the whole filter set on the button", async () => {
    const wrapper = await mount();

    await toggle(wrapper).trigger("click");
    await nextTick();

    // The three most used public filters are the top of the panel.
    expect(openOverlayText()).toContain("Region osoby");
    expect(openOverlayText()).toContain("Typ podmiotu");
    expect(openOverlayText()).toContain("Zatrudnienie");
  });

  /** The width decision is made in css, because Vuetify's `useDisplay()` under
   * SSR starts from a placeholder 1280px and corrects only when suspense
   * resolves. jsdom cannot say which of the two activators is on screen, but it
   * can say that there are exactly two and that each carries the class that
   * hides it at the other width - drop one of those classes and every reader
   * gets two „Filtry” buttons side by side. */
  it("carries one activator per width, each gated in css", async () => {
    const wrapper = await mount({ teryt: "teryt14" });

    const activators = wrapper
      .findAll(".v-btn")
      .filter((button) => button.text().startsWith("Filtry"));
    expect(activators).toHaveLength(2);
    expect(toggle(wrapper).text()).toBe("Filtry (1)");
    expect(phoneToggle(wrapper).text()).toBe("Filtry (1)");
  });

  /** A guest cannot set these from here, but the api honours them all the same:
   * `hideVoted`, `minVotes` and `minEmploymentDate` are applied to everybody,
   * and `visibility=private` answers a signed-out reader with an empty result
   * set. Hiding the chip would leave them looking at a table that had been cut
   * from under them by a link, with nothing on screen to name it or take it
   * off. */
  it("names an administrative filter to a guest, and lets them clear it", async () => {
    const wrapper = await mount({
      showVisibility: false,
      visibility: "private",
      hideVoted: "no_votes",
    });

    expect(toggle(wrapper).text()).toBe("Filtry (2)");
    expect(railChips(wrapper).map((chip) => chip.text())).toEqual([
      "Tylko szkice",
      "Bez ocenionych",
    ]);

    await railChips(wrapper)[0]!.get(".v-chip__close").trigger("click");
    expect(wrapper.emitted("update:visibility")?.[0]).toEqual(["all"]);
  });

  /** ...but its body is not a button for them: the panel gates „Weryfikacja”
   * on the same prop, so opening it would answer the click with a panel that
   * does not hold the filter that was clicked. */
  it("does not offer a guest a panel that cannot hold the filter", async () => {
    const wrapper = await mount({
      showVisibility: false,
      visibility: "private",
      category: "szpitale",
    });

    const chips = railChips(wrapper);
    const admin = chips.find((chip) => chip.text() === "Tylko szkice");
    const open = chips.find((chip) => chip.text() === "Szpitale");
    expect(admin!.classes()).not.toContain("v-chip--link");
    expect(open!.classes()).toContain("v-chip--link");
  });
});

describe("the query bar's sort control", () => {
  /** Below 960px „Oceny” and „Wybory” are `hidden-sm-and-down` and their
   * header sorts go with them, so this button is the only thing on the page
   * that can say how the table is ordered. Hidden behind `d-none d-md-inline`
   * it left a phone reader with an icon and an arrow and no name for either. */
  it("names the sort at every width", async () => {
    const wrapper = await mount({
      sortBy: [{ key: "stats.votes.interesting", order: "desc" }],
    });

    const button = sortButton(wrapper);
    expect(button.text()).toBe("Oceny");
    // Nothing inside it may be hidden at a width: the label is the whole
    // point of the button on a phone.
    expect(button.find(".d-none").exists()).toBe(false);
    expect(button.attributes("aria-label")).toBe("Sortowanie: Suma ocen");
  });

  /** A freshly loaded table is in whatever order the api returned. The arrow
   * was drawn from `order !== "asc"`, so with no sort at all it pointed down
   * and claimed an order the rows are not in. */
  it("claims no direction until something is sorted", async () => {
    const wrapper = await mount({ sortBy: [] });

    expect(sortButton(wrapper).text()).toBe("Sortowanie");
    expect(sortButton(wrapper).find(".v-btn__append").exists()).toBe(false);

    await wrapper.setProps({ sortBy: [{ key: "name", order: "asc" }] });
    expect(sortButton(wrapper).text()).toBe("Nazwisko");
    expect(sortButton(wrapper).find(".v-btn__append").exists()).toBe(true);
  });
});

describe("the query bar's share card", () => {
  /** The checkbox compared `shareUrl(query, "", { withPaging: true })` against
   * the plain one, and the bar's `query` carried no paging at all - so the two
   * strings were always equal and „Dołącz stronę i liczbę wierszy” could never
   * be reached, whatever page the reader was standing on. */
  it("offers the reader's page to the link when there is one", async () => {
    // Page 2 at the row count the table starts with: nothing but the page
    // number is worth adding, and that is enough for the offer to be real.
    const wrapper = await mount({ showShare: true, sortBy: [], page: 2 });

    await wrapper.get("[aria-label='Udostępnij ten widok']").trigger("click");
    await settle();

    expect(overlayText()).toContain("Dołącz stronę i liczbę wierszy");

    const checkbox = document.querySelector<HTMLInputElement>(
      '.v-overlay-container input[type="checkbox"]',
    );
    checkbox!.click();
    await settle();

    expect(
      document.querySelector<HTMLInputElement>(
        '.v-overlay-container input[type="text"]',
      )?.value,
    ).toContain("page=2");
  });

  /** ...and not on the first page at the row count the table starts with,
   * where ticking it would produce the address it already shows. */
  it("keeps it away from an unpaged first page", async () => {
    const wrapper = await mount({ showShare: true, sortBy: [], page: 1 });

    await wrapper.get("[aria-label='Udostępnij ten widok']").trigger("click");
    await settle();

    expect(overlayText()).not.toContain("Dołącz stronę");
  });
});

describe("the query bar's work row", () => {
  it("stays away from a page that has nothing to verify", async () => {
    const wrapper = await mount({ visibility: "private" });

    expect(workRow(wrapper).exists()).toBe(false);
    // ...and the verification filter is still named somewhere: with no work
    // row to hold it, the chip belongs on the rail.
    expect(railChips(wrapper).map((chip) => chip.text())).toContain(
      "Tylko szkice",
    );
  });

  it("stays away from a reader who cannot act on it", async () => {
    const wrapper = await mount({ showProgress: true, showVisibility: false });

    expect(workRow(wrapper).exists()).toBe(false);
  });

  it("offers the four verification filters one click from the page", async () => {
    const wrapper = await mount({ showProgress: true });

    expect(
      workRow(wrapper)
        .findAll(".v-btn")
        .map((button) => button.text()),
    ).toEqual(
      expect.arrayContaining([
        "Widoczność",
        "Bez ocenionych",
        "Od kiedy",
        "Min. głosy",
      ]),
    );
  });

  /** „+ Głosy” next to „+ Min. głosy” made the reader open one of them to find
   * out which was which - the cost the work row exists to remove. The unset
   * shortcut is named after what setting it does, exactly as its chip is. */
  it("names each shortcut after what it sets", async () => {
    const wrapper = await mount({ showProgress: true });

    const labels = workRow(wrapper)
      .findAll(".v-btn")
      .map((button) => button.text());
    expect(labels).not.toContain("Głosy");
    expect(labels.filter((label) => label.includes("głos"))).toEqual([
      "Min. głosy",
    ]);
  });

  it("turns a set filter into a chip and takes its shortcut away", async () => {
    const wrapper = await mount({ showProgress: true, hideVoted: "no_votes" });

    const row = workRow(wrapper);
    expect(row.findAll(".v-chip").map((chip) => chip.text())).toEqual([
      "bez ocenionych",
    ]);
    expect(row.findAll(".v-btn").map((button) => button.text())).not.toContain(
      "Bez ocenionych",
    );

    // The same filter must not also sit on the rail above: one filter drawn
    // twice reads as two.
    expect(railChips(wrapper)).toHaveLength(0);
  });

  it("clears a verification filter from its chip", async () => {
    const wrapper = await mount({ showProgress: true, minVotes: 5 });

    await workRow(wrapper).get(".v-chip__close").trigger("click");

    expect(wrapper.emitted("update:minVotes")?.[0]).toEqual([null]);
  });

  /** In the mock the body of a set chip did nothing, so „min. 5 głosów” could
   * only be changed by clearing it and starting over. */
  it("opens the same one-control menu from a set chip", async () => {
    const wrapper = await mount({ showProgress: true, minVotes: 5 });

    await workRow(wrapper).get(".v-chip").trigger("click");
    await nextTick();

    expect(openOverlayText()).toContain("Min. głosy łącznie");
    // Exactly that one control, not the whole panel.
    expect(openOverlayText()).not.toContain("Region osoby");
  });
});
