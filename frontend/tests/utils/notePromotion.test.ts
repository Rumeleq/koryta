import { describe, it, expect, vi } from "vitest";
import type { NoteSource } from "~~/shared/model";
import {
  promoteNoteSources,
  sourcesToPromote,
  withArticleIds,
} from "~/utils/notePromotion";

const source = (overrides: Partial<NoteSource> = {}): NoteSource => ({
  note: "Ciekawe",
  url: "https://example.pl/a",
  kind: "source",
  ...overrides,
});

describe("sourcesToPromote", () => {
  it("takes source entries that carry a url", () => {
    expect(sourcesToPromote([source()])).toHaveLength(1);
  });

  it("takes entries written before kinds existed", () => {
    expect(sourcesToPromote([source({ kind: undefined })])).toHaveLength(1);
  });

  it("leaves corrections and gap reports alone", () => {
    expect(
      sourcesToPromote([
        source({ kind: "change_request" }),
        source({ kind: "missing" }),
      ]),
    ).toEqual([]);
  });

  it("leaves an entry with no url, or a blank one", () => {
    expect(
      sourcesToPromote([source({ url: undefined }), source({ url: "  " })]),
    ).toEqual([]);
  });

  it("leaves an entry that is already an article", () => {
    expect(sourcesToPromote([source({ articleNodeId: "a1" })])).toEqual([]);
  });
});

describe("withArticleIds", () => {
  it("attaches the node each url became", () => {
    const sources = [source(), source({ url: "https://example.pl/b" })];
    const updated = withArticleIds(
      sources,
      new Map([["https://example.pl/a", "a1"]]),
    );
    expect(updated).toEqual([
      { ...sources[0], articleNodeId: "a1" },
      sources[1],
    ]);
  });

  it("says nothing changed when nothing did", () => {
    expect(withArticleIds([source()], new Map())).toBeNull();
    expect(
      withArticleIds(
        [source({ articleNodeId: "a1" })],
        new Map([["https://example.pl/a", "a1"]]),
      ),
    ).toBeNull();
  });
});

describe("promoteNoteSources", () => {
  it("promotes each url once, however many entries cite it", async () => {
    const articleIdFor = vi.fn(async () => "a1");
    const updated = await promoteNoteSources(
      [source(), source({ note: "I jeszcze to" })],
      articleIdFor,
    );

    expect(articleIdFor).toHaveBeenCalledTimes(1);
    expect(updated?.map((s) => s.articleNodeId)).toEqual(["a1", "a1"]);
  });

  it("does not ask when there is nothing to promote", async () => {
    const articleIdFor = vi.fn(async () => "a1");
    expect(
      await promoteNoteSources([source({ kind: "missing" })], articleIdFor),
    ).toBeNull();
    expect(articleIdFor).not.toHaveBeenCalled();
  });

  it("keeps the entries that worked when one url fails", async () => {
    const articleIdFor = vi.fn(async (url: string) => {
      if (url === "https://example.pl/a") throw new Error("502");
      return "b1";
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const updated = await promoteNoteSources(
      [source(), source({ url: "https://example.pl/b" })],
      articleIdFor,
    );

    // The failed one keeps no id, so the next save tries it again.
    expect(updated?.map((s) => s.articleNodeId)).toEqual([undefined, "b1"]);
  });
});
