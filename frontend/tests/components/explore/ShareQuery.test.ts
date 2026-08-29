import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import ShareQuery from "../../../app/components/explore/ShareQuery.vue";
import type { TableQuery } from "../../../shared/queryUrl";

// Vuetify's overlay measures the viewport and observes resizes; neither exists
// in the test DOM, and the dialog is where everything this file asserts on
// lives.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

global.visualViewport = {
  width: 1000,
  height: 1000,
  offsetLeft: 0,
  offsetTop: 0,
  pageLeft: 0,
  pageTop: 0,
  scale: 1,
  onresize: null,
  onscroll: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
} as never;

/** The state that produced the complaint in `design/tabela-redesign/
 * UDOSTEPNIANIE.md`: one filter worth sharing, one neutral value that has to
 * be dropped, and a reader parked on page 3 of a hundred-row page. */
const QUERY: TableQuery = {
  category: "szpitale",
  visibility: "private",
  hideVoted: "all",
  sortBy: "stats.votes.interesting",
  sortDesc: "true",
  limit: 100,
  page: 3,
};

const SENTENCE = "Szpitale · tylko szkice · wg sumy ocen";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const overlayText = () =>
  document.querySelector(".v-overlay-container")?.textContent ?? "";

const urlInput = () =>
  document.querySelector<HTMLInputElement>(
    '.v-overlay-container input[type="text"]',
  );

const clickButton = async (label: string) => {
  const button = [
    ...document.querySelectorAll<HTMLElement>(".v-overlay-container button"),
  ].find((candidate) => candidate.textContent.includes(label));
  expect(button, `brak przycisku „${label}”`).toBeTruthy();
  button!.click();
  await settle();
};

const writeText = vi.fn(() => Promise.resolve());

const openCard = async (query: TableQuery = QUERY) => {
  const wrapper = await mountSuspended(ShareQuery, { props: { query } });
  // The dialog's contents do not exist until it is opened: Vuetify's overlay
  // is lazy, so every query below has to run after this click.
  await wrapper.find("button").trigger("click");
  await settle();
  return wrapper;
};

describe("ExploreShareQuery", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  });

  it("says in Polish what the link opens", async () => {
    await openCard();

    expect(overlayText()).toContain(SENTENCE);
  });

  it("shares the filters and the sort, not the reader's page", async () => {
    await openCard();

    // `hideVoted=all` narrows nothing and page 3 of a search the recipient has
    // never run means nothing to them.
    expect(urlInput()?.value).toBe(
      `${window.location.origin}/eksploruj/tabela` +
        "?category=szpitale&visibility=private" +
        "&sortBy=stats.votes.interesting&sortDesc=true",
    );
  });

  it("adds the page only when asked to", async () => {
    await openCard();

    const checkbox = document.querySelector<HTMLInputElement>(
      '.v-overlay-container input[type="checkbox"]',
    );
    checkbox!.click();
    await settle();

    expect(urlInput()?.value).toContain("itemsPerPage=100&page=3");
  });

  it("copies the sentence together with the address", async () => {
    await openCard();

    await clickButton("Kopiuj link z opisem");

    expect(writeText).toHaveBeenCalledTimes(1);
    const [payload] = writeText.mock.calls[0]! as unknown as [string];
    expect(payload.split("\n")[0]).toBe(SENTENCE);
    expect(payload.split("\n")[1]).toBe(urlInput()?.value);
  });

  it("confirms a copy that actually happened", async () => {
    await openCard();

    await clickButton("Kopiuj link");

    expect(overlayText()).toContain("Skopiowano link.");
  });

  /** The whole reason the failure path exists: a browser on an insecure origin
   * has no `navigator.clipboard` at all, and one that has it can still refuse.
   * A snackbar reading „Skopiowano” over an empty clipboard sends the reader to
   * paste whatever was there before. */
  it("owns up when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    const select = vi.spyOn(HTMLInputElement.prototype, "select");
    await openCard();

    await clickButton("Kopiuj link");

    expect(overlayText()).toContain("Skopiuj ręcznie: Ctrl+C");
    expect(overlayText()).not.toContain("Skopiowano");
    // The address stays on screen and selected; closing the dialog here would
    // take away the only thing left to copy from.
    expect(urlInput()).toBeTruthy();
    expect(select).toHaveBeenCalled();
    select.mockRestore();
  });

  it("survives a browser with no clipboard api at all", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    await openCard();

    await clickButton("Kopiuj link");

    expect(overlayText()).toContain("Skopiuj ręcznie: Ctrl+C");
  });

  /** The component has three roots (button, dialog, snackbar), so Vue has no
   * single element to fall attributes through to and would drop the class the
   * query bar uses to stop the button being squeezed by a wrapping chip
   * rail. */
  it("lets the query bar put a class on the button", async () => {
    const wrapper = await mountSuspended(ShareQuery, {
      props: { query: QUERY },
      attrs: { class: "flex-shrink-0" },
    });

    expect(wrapper.find("button").classes()).toContain("flex-shrink-0");
  });

  it("describes an unfiltered table rather than leaving the card blank", async () => {
    await openCard({});

    expect(overlayText()).toContain("wszystkie osoby w bazie");
    expect(urlInput()?.value).toBe(
      `${window.location.origin}/eksploruj/tabela`,
    );
    // Nothing to add, so the checkbox that would add it is not offered.
    expect(overlayText()).not.toContain("Dołącz stronę");
  });
});
