import { describe, it, expect } from "vitest";
import { omniSearchTarget } from "../../app/composables/omniSearch";

describe("omniSearchTarget", () => {
  // A profile opened from the revision queue carries `?revisionId=`, and the
  // view renders that revision on top of the node. A search made from there has
  // to leave it behind, or the next profile shows the previous person's
  // proposal and the search looks like it never navigated.
  it("drops the current query when the pick leads to another page", () => {
    expect(
      omniSearchTarget(
        { path: "/osoba/jan-kowalski-1", query: { revisionId: "rev1" } },
        { path: "/osoba/anna-nowak-2" },
      ),
    ).toEqual({ path: "/osoba/anna-nowak-2", query: {} });
  });

  it("keeps the current query when the pick refines the same page", () => {
    expect(
      omniSearchTarget(
        { path: "/eksploruj/tabela", query: { miejsce: "krakow" } },
        { path: "/eksploruj/tabela", query: { party: "PiS" } },
      ),
    ).toEqual({
      path: "/eksploruj/tabela",
      query: { miejsce: "krakow", party: "PiS" },
    });
  });

  it("stays put, filters and all, for a pick with no path of its own", () => {
    expect(
      omniSearchTarget(
        { path: "/graf", query: { partia: "PiS" } },
        { query: { miejsce: "krakow" } },
      ),
    ).toEqual({ path: "/graf", query: { partia: "PiS", miejsce: "krakow" } });
  });

  it("sends a pick the site cannot show to the table", () => {
    expect(
      omniSearchTarget(
        { path: "/admin/rewizje/node1", query: { revisionId: "rev1" } },
        { path: "/admin/rewizje/node2" },
      ),
    ).toEqual({ path: "/eksploruj/tabela", query: {} });
  });
});
