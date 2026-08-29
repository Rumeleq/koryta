import { describe, it, expect, vi, afterEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import { nextTick } from "vue";
import ExploreTable from "../../../app/components/explore/Table.vue";
import type { PersonRich } from "../../../shared/model";

// Vuetify's overlay machinery observes its activator, and happy-dom ships no
// ResizeObserver - without this the first v-menu open throws instead of
// rendering a list.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

/** The two columns /eksploruj/tabela and /eksploruj/nowe now declare where
 * there used to be four: Imię i nazwisko + Partie, and Firmy + Ostatnie
 * zatrudnienie + Wybory. */
const MERGED_HEADERS = [
  { title: "Osoba", key: "name", sortable: true },
  { title: "Historia", key: "latestEmploymentStart", sortable: true },
];

/** Everything the four columns used to carry, on one person, so that the
 * assertions below can say "nothing was dropped on the way" rather than
 * "the markup parses". */
const person = (): PersonRich => ({
  id: "p1",
  type: "person",
  name: "Jan Kowalski",
  parties: ["PiS", "Konfederacja"],
  companies: ["FIRMA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"],
  elections: [
    {
      year: "2018",
      location: "Gdynia",
      teryt: "2262",
      position: "Rada miasta",
      committee: "KWW Testowy Komitet",
    },
  ],
  latestEmploymentStart: "2019-03-01",
  experience: 4,
});

/** What /eksploruj/tabela declares for the two columns that now answer for
 * more than one sort key apiece. */
const SORTABLE_HEADERS = [
  { title: "Osoba", key: "name", sortable: true },
  { title: "Firmy", key: "latestEmploymentStart", sortable: true },
  { title: "Oceny", key: "stats.votes.interesting", sortable: true },
];

const mountTable = (props: Record<string, unknown> = {}) =>
  mountSuspended(ExploreTable, {
    props: {
      headers: MERGED_HEADERS,
      items: [person()],
      totalItems: 1,
      pending: false,
      hideDefaultFooter: true,
      ...props,
    },
  });

type Wrapper = Awaited<ReturnType<typeof mountTable>>;

const headerCell = (wrapper: Wrapper, title: string) => {
  const cell = wrapper
    .findAll("thead th")
    .find((th) => th.text().includes(title));
  if (!cell) throw new Error(`no header cell for ${title}`);
  return cell;
};

describe("ExploreTable's merged person and history cells", () => {
  it("puts the whole row into two cells", async () => {
    const wrapper = await mountTable();

    const cells = wrapper.findAll("tbody td");
    expect(cells).toHaveLength(2);

    const personCell = cells[0]!;
    expect(personCell.text()).toContain("Jan Kowalski");
    expect(personCell.text()).toContain("PiS");
    expect(personCell.text()).toContain("Konfederacja");

    const historyCell = cells[1]!;
    // `shortCompanyName` takes the legal form out, which is what lets a
    // company chip fit a phone at all.
    expect(historyCell.text()).toContain("FIRMA");
    expect(historyCell.text()).not.toContain("SPÓŁKA Z OGRANICZONĄ");
    expect(historyCell.text()).toContain("2018");
    expect(historyCell.text()).toContain("Gdynia");
    // The date used to be a column of its own behind `hidden-sm-and-down`, so
    // a phone never saw it. It rides with the employers now.
    expect(historyCell.text()).toContain("2019-03-01");
  });

  /** Five e2e specs treat `a.text-primary.cursor-pointer` in the first row as
   * "the table has finished loading", and the drawer opens off its click. The
   * merge moved the link inside a flex wrapper; it must not have moved it out
   * of that selector. */
  it("keeps the name a link that focuses the person", async () => {
    const wrapper = await mountTable();

    const link = wrapper.get("tbody td a.text-primary.cursor-pointer");
    expect(link.text()).toContain("Jan Kowalski");

    await link.trigger("click");
    expect(wrapper.emitted("focus")?.[0]?.[0]).toMatchObject({ id: "p1" });
  });

  /** A person with no employer and no election gets an empty cell rather than
   * a stray "Ostatnie zatrudnienie:" label over an empty chip row. */
  it("leaves the history cell empty when there is nothing to put in it", async () => {
    const wrapper = await mountSuspended(ExploreTable, {
      props: {
        headers: MERGED_HEADERS,
        items: [
          {
            ...person(),
            companies: [],
            elections: [],
            latestEmploymentStart: null,
          },
        ],
        totalItems: 1,
        pending: false,
        hideDefaultFooter: true,
      },
    });

    const cells = wrapper.findAll("tbody td");
    expect(cells[1]!.text()).toBe("");
  });
});

/** /eksploruj/tabela declares a „Wybory” column and hides it below 960px;
 * /eksploruj/nowe declares none at all. The same markup answers all three
 * cases, and it has to draw the chips exactly once in each.
 *
 * The assertions are on classes rather than on what is on screen, and that is
 * not laziness: jsdom has no viewport, so a test that asked whether the chips
 * are visible would have stayed green while a phone had neither copy. */
describe("ExploreTable's elections column", () => {
  const WITH_ELECTIONS = [
    { title: "Osoba", key: "name", sortable: true },
    { title: "Firmy", key: "latestEmploymentStart", sortable: true },
    // `sortable: false` is the point of the column, not decoration:
    // `elections` is not a key server/api/nodes/index.get.ts maps, so a click
    // would reach Firestore's `orderBy` verbatim and answer with an empty
    // table.
    { title: "Wybory", key: "elections", sortable: false },
  ];

  /** The regression this replaces: the in-cell copy was behind a `v-if` on the
   * header list, and the column is declared at every width - it hides itself
   * with `hidden-sm-and-down`. So the `v-if` was false on a phone as well, the
   * column was `display: none` there, and the elections were on no screen
   * narrower than 960px at all. */
  it("keeps the in-cell chips, hidden from md up, when the page declares a column", async () => {
    const wrapper = await mountTable({ headers: WITH_ELECTIONS });

    const cells = wrapper.findAll("tbody td");
    expect(cells).toHaveLength(3);

    // Employers and the date stay where they were...
    expect(cells[1]!.text()).toContain("FIRMA");
    expect(cells[1]!.text()).toContain("2019-03-01");

    // ...and the chips are in both places, each with the class that takes it
    // off the width the other one answers for.
    const inCell = cells[1]!.get(".elections-cell");
    expect(inCell.text()).toContain("Gdynia");
    expect(inCell.classes()).toContain("d-md-none");

    const column = cells[2]!.get(".elections-cell");
    expect(column.text()).toContain("2018");
    expect(column.text()).toContain("Gdynia");
    expect(column.classes()).not.toContain("d-md-none");
  });

  /** /eksploruj/nowe declares no „Wybory” column at any width, so the in-cell
   * copy is the only one there is and must not hide itself from anybody. */
  it("keeps them visible at every width for a page that declares none", async () => {
    const wrapper = await mountTable();

    const cells = wrapper.findAll("tbody td");
    expect(cells).toHaveLength(2);

    const inCell = cells[1]!.get(".elections-cell");
    expect(inCell.text()).toContain("Gdynia");
    expect(inCell.classes()).not.toContain("d-md-none");
  });
});

/** „Lata pracy” and „Notatki” stopped being columns and stayed sort keys in
 * the menus of the two that absorbed them. Both numbers have to be printed
 * somewhere, or the table can be ordered by a value the reader cannot see. */
describe("ExploreTable's absorbed columns", () => {
  const caption = (wrapper: Wrapper) =>
    wrapper.get("tbody td .companies-cell .text-caption");

  it("prints the years of work beside the last employment date", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      items: [{ ...person(), experience: 11 }],
    });

    expect(caption(wrapper).text()).toBe(
      "Ostatnie zatrudnienie: od 2019-03-01 · 11 lat pracy",
    );
    // The label is the desktop half of the line: below 960px the cell shares
    // 343px with the name and has no room for eleven characters of prefix, so
    // what is left down there is the bare „od <data>”.
    expect(caption(wrapper).get("span").classes()).toEqual([
      "d-none",
      "d-md-inline",
    ]);
  });

  /** `polishCounting` takes the three forms and returns the number with them;
   * a table full of „11 lata pracy” is what a wrong slot looks like. */
  it("declines the years", async () => {
    for (const [experience, expected] of [
      [1, "1 rok pracy"],
      [3, "3 lata pracy"],
      [12, "12 lat pracy"],
      [22, "22 lata pracy"],
    ] as const) {
      const wrapper = await mountTable({
        headers: SORTABLE_HEADERS,
        items: [{ ...person(), experience }],
      });

      expect(caption(wrapper).text()).toContain(`· ${expected}`);
    }
  });

  /** /eksploruj/nowe still draws a „Lata pracy” column, and the caption is
   * only there for the page that dropped one. */
  it("says nothing about the years for a page that still has the column", async () => {
    const wrapper = await mountTable({
      headers: [
        ...MERGED_HEADERS,
        { title: "Lata pracy", key: "experience", sortable: false },
      ],
      items: [{ ...person(), experience: 11 }],
    });

    expect(caption(wrapper).text()).toBe(
      "Ostatnie zatrudnienie: od 2019-03-01",
    );
    expect(wrapper.findAll("tbody td")[2]!.text()).toBe("11");
  });

  it("prints the notes count under the total", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      items: [
        { ...person(), stats: { notesCount: 2, votes: { interesting: 7 } } },
      ],
    });

    const votes = wrapper.findAll("tbody td")[2]!;
    expect(votes.text()).toContain("7");
    expect(votes.get(".text-caption").text()).toBe("2 notatki");
  });

  /** A second line on every row would make the whole table taller to print a
   * number that says what its absence already says. */
  it("stays one line for a person nobody has written a note about", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      items: [
        { ...person(), stats: { notesCount: 0, votes: { interesting: 7 } } },
      ],
    });

    const votes = wrapper.findAll("tbody td")[2]!;
    expect(votes.text()).toBe("7");
    expect(votes.find(".text-caption").exists()).toBe(false);
  });
});

describe("ExploreTable's searchWithName", () => {
  afterEach(() => vi.restoreAllMocks());

  /** /eksploruj/tabela dropped the "Eksploruj" column: its magnifier opened
   * the drawer, which is what the name link has always done. The pink button
   * beside it opens the search engines, which nothing else on the row does, so
   * that one had to land somewhere - here, on the name it searches for. */
  it("opens the searches from the name cell when the page asks for it", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const wrapper = await mountTable({ searchWithName: true });

    const button = wrapper.get("tbody td .v-btn");
    // The cell is capped at 120px on a phone and shares 343px with the history
    // one, so the button exists only from md up - and by a class rather than a
    // `useDisplay()` test, which under SSR starts from a placeholder 1280px.
    expect(button.classes()).toContain("hidden-sm-and-down");

    await button.trigger("click");

    expect(open).toHaveBeenCalled();
    expect(wrapper.emitted("action:explored")?.[0]?.[0]).toMatchObject({
      id: "p1",
    });
    // The drawer opens with the tabs, exactly as the column's button did.
    expect(wrapper.emitted("focus")?.[0]?.[0]).toMatchObject({ id: "p1" });
  });

  it("leaves the name cell alone by default", async () => {
    const wrapper = await mountTable();

    expect(wrapper.find("tbody td .v-btn").exists()).toBe(false);
  });

  /** /eksploruj/nowe still declares an "Eksploruj" column and is the page the
   * two buttons were written for; the new prop is opt-in so that page renders
   * exactly as it did. */
  it("still draws the Eksploruj column for a page that declares it", async () => {
    const wrapper = await mountTable({
      headers: [
        ...MERGED_HEADERS,
        { title: "Eksploruj", key: "explore", sortable: false },
      ],
    });

    expect(wrapper.findAll("tbody td")).toHaveLength(3);
    expect(wrapper.findAll("tbody td:last-child .v-btn")).toHaveLength(2);
  });
});

describe("ExploreTable's scoreOnPhone", () => {
  /** At 390px the merged column set measures 447px against a 358px viewport
   * and the "Oceny" header lands at x=363, off screen: the number cannot be
   * read and the sort behind it cannot be tapped. */
  it("prints the total under the name, below md only", async () => {
    const wrapper = await mountTable({
      scoreOnPhone: true,
      items: [{ ...person(), stats: { votes: { interesting: 7 } } }],
    });

    const line = wrapper.get("tbody td .d-md-none");
    expect(line.text()).toBe("Suma ocen: 7");
  });

  it("says nothing about the score by default", async () => {
    const wrapper = await mountTable();

    expect(wrapper.text()).not.toContain("Suma ocen");
  });

  /** Both at once would be two identical lines on a phone. /eksploruj/nowe
   * asks for the unconditional one; nothing asks for both, and the cell must
   * not fall apart if something does. */
  it("does not double up with scoreWithName", async () => {
    const wrapper = await mountTable({
      scoreWithName: true,
      scoreOnPhone: true,
    });

    expect(
      wrapper
        .get("tbody td")
        .text()
        .match(/Suma ocen/g),
    ).toHaveLength(1);
  });
});

describe("ExploreTable's per-column sort menus", () => {
  /** The regression the menus would otherwise introduce. The arrow used to
   * paint only where `sortBy[0].key === column.key`, so ordering by a key the
   * column covers but is not named after left the table reordered and every
   * header unmarked. */
  it("marks Firmy as sorted when the order came from its own menu", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      sortBy: [{ key: "experience", order: "desc" }],
    });

    const firmy = headerCell(wrapper, "Firmy");
    expect(firmy.text()).toContain("lata pracy");
    expect(firmy.find(".opacity-0").exists()).toBe(false);

    // ...and no other column claims it.
    expect(headerCell(wrapper, "Oceny").find(".opacity-0").exists()).toBe(true);
  });

  it("marks Oceny as sorted by the notes count", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      sortBy: [{ key: "notesCount", order: "desc" }],
    });

    const oceny = headerCell(wrapper, "Oceny");
    expect(oceny.text()).toContain("liczba notatek");
    expect(oceny.find(".opacity-0").exists()).toBe(false);
  });

  /** The column's own key needs no qualifier - the title is already the name
   * of that sort - and printing one would widen every header for nothing. */
  it("adds no qualifier when the sort is the column's own key", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS,
      sortBy: [{ key: "latestEmploymentStart", order: "asc" }],
    });

    const firmy = headerCell(wrapper, "Firmy");
    expect(firmy.text().trim()).toBe("Firmy");
    expect(firmy.find(".opacity-0").exists()).toBe(false);
  });

  /** The <th> sorts on Enter as well as on a click, and only the click is
   * stopped for us. A keyboard reader opening this menu was reordering the
   * table on the column's own key on the way in. */
  it("does not sort when the menu is opened from the keyboard", async () => {
    const wrapper = await mountTable({ headers: SORTABLE_HEADERS, sortBy: [] });

    await headerCell(wrapper, "Firmy")
      .get("button")
      .trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("update:sortBy")).toBeUndefined();
  });

  /** /eksploruj/nowe declares every column `sortable: false` and orders its
   * queue from its own two buttons. A menu there would emit an `update:sortBy`
   * that page does not listen for: a control that visibly does nothing. */
  it("offers no menu on a column the page does not let you sort", async () => {
    const wrapper = await mountTable({
      headers: SORTABLE_HEADERS.map((header) => ({
        ...header,
        sortable: false,
      })),
    });

    expect(headerCell(wrapper, "Firmy").find("button").exists()).toBe(false);
  });

  it("sorts on the key the menu entry names, not on the column key", async () => {
    const wrapper = await mountTable({ headers: SORTABLE_HEADERS, sortBy: [] });

    await headerCell(wrapper, "Firmy").get("button").trigger("click");
    await nextTick();

    // Vuetify hangs its own sort toggle off the <th>, so opening the menu must
    // not also reorder the table on `latestEmploymentStart`.
    expect(wrapper.emitted("update:sortBy")).toBeUndefined();

    const entry = [...document.querySelectorAll(".v-list-item")].find((el) =>
      el.textContent.includes("lat pracy"),
    );
    (entry as HTMLElement).click();
    await nextTick();

    // `experience` verbatim: server/api/nodes/index.get.ts has no allow-list
    // and hands anything else to a Firestore orderBy, which answers with an
    // empty table rather than an error.
    expect(wrapper.emitted("update:sortBy")?.[0]?.[0]).toEqual([
      { key: "experience", order: "desc" },
    ]);
  });
});
