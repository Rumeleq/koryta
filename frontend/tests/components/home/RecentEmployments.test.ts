import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountSuspended, registerEndpoint } from "@nuxt/test-utils/runtime";
import { clearNuxtData } from "#app";
import RecentEmployments from "../../../app/components/home/RecentEmployments.vue";
import type {
  RecentEmployment,
  RecentEmployments as Response,
} from "../../../server/api/edges/recentEmployments.get";

/** The pages the endpoint will hand out, keyed by the cursor that asks for
 * them. `null` is the first page, which carries no cursor. */
let pages: Record<string, Response> = {};

/** Every cursor the component asked for, in order, so a test can say it never
 * asked twice for the same page. */
const asked: (string | null)[] = [];

/** The cursor the endpoint answers with a 500 rather than a page, so a test
 * can drive the failure branch through the real `$fetch`. Nuxt auto-imports
 * `$fetch`, so stubbing the global one would not reach the component. */
const FAILING_CURSOR = "boom";

registerEndpoint("/api/edges/recentEmployments", (event) => {
  const cursor =
    new URL(event.node.req.url ?? "/", "http://test").searchParams.get(
      "cursor",
    ) ?? null;
  asked.push(cursor);
  if (cursor === FAILING_CURSOR) throw new Error("nope");
  return pages[cursor ?? "first"] ?? { employments: [], nextCursor: null };
});

function employment(id: string, start = "2024-01-01"): RecentEmployment {
  return {
    id,
    personId: `p-${id}`,
    personName: `Osoba ${id}`,
    parties: [],
    companyId: "orlen",
    companyName: "Orlen",
    role: "Prezes zarządu",
    start_date: start,
    end_date: null,
  };
}

/** Mounts and waits for the first page.
 *
 * The component does not await its own fetch - Nuxt settles `useAsyncData`
 * before it serialises a server rendered page, and awaiting would hold the
 * whole route on this one section during a client side navigation. That is
 * exactly the state `mountSuspended` returns in, so the spinner is what is on
 * screen until the request lands.
 */
async function mountFeed() {
  const wrapper = await mountSuspended(RecentEmployments);
  await vi.waitUntil(
    () =>
      wrapper.find('[data-testid="recent-employments"]').exists() ||
      wrapper.find('[data-testid="recent-employments-empty"]').exists(),
    { timeout: 2000 },
  );
  return wrapper;
}

const moreButton = (wrapper: Awaited<ReturnType<typeof mountFeed>>) =>
  wrapper.find('[data-testid="recent-employments-more"]');

/** Presses "Pokaż więcej" and waits for the page it asked for to land. */
async function pressMore(wrapper: Awaited<ReturnType<typeof mountFeed>>) {
  const asksBefore = asked.length;
  await moreButton(wrapper).trigger("click");
  await vi.waitUntil(() => asked.length > asksBefore, { timeout: 2000 });
  await vi.waitUntil(() => !wrapper.find(".v-btn--loading").exists(), {
    timeout: 2000,
  });
  await wrapper.vm.$nextTick();
}

describe("HomeRecentEmployments", () => {
  beforeEach(() => {
    asked.length = 0;
    pages = {};
    // One Nuxt app serves the whole file, so the first page the previous test
    // fetched is still in the payload and the next mount would re-serve it
    // without asking for anything.
    clearNuxtData();
  });

  it("draws a card for every employment on the first page", async () => {
    pages.first = {
      employments: [employment("a"), employment("b")],
      nextCursor: null,
    };

    const wrapper = await mountFeed();

    expect(wrapper.text()).toContain("Osoba a");
    expect(wrapper.text()).toContain("Osoba b");
    expect(wrapper.find('[data-testid="recent-employments"]').exists()).toBe(
      true,
    );
  });

  /** The whole point of the button. This section is the last thing on the home
   * page and the footer is directly below it - on a phone, the only navigation
   * there is. A feed that fetched another page whenever its end came into view
   * pushed the footer one screen further away every time somebody scrolled to
   * it, so it was never reachable. */
  it("fetches nothing more until the reader asks for it", async () => {
    pages.first = { employments: [employment("a")], nextCursor: "c1" };
    pages.c1 = { employments: [employment("b")], nextCursor: null };

    const wrapper = await mountFeed();

    expect(asked).toEqual([null]);
    expect(wrapper.text()).not.toContain("Osoba b");
    expect(moreButton(wrapper).exists()).toBe(true);
  });

  it("appends the next page rather than replacing what is on screen", async () => {
    pages.first = { employments: [employment("a")], nextCursor: "c1" };
    pages.c1 = { employments: [employment("b")], nextCursor: null };

    const wrapper = await mountFeed();
    await pressMore(wrapper);

    expect(wrapper.text()).toContain("Osoba a");
    expect(wrapper.text()).toContain("Osoba b");
    expect(asked).toEqual([null, "c1"]);
  });

  it("offers nothing to press once the feed says there is nothing behind it", async () => {
    pages.first = { employments: [employment("a")], nextCursor: null };

    const wrapper = await mountFeed();

    expect(moreButton(wrapper).exists()).toBe(false);
    expect(wrapper.text()).toContain("To już wszystkie zatrudnienia");
    expect(asked).toEqual([null]);
  });

  it("keeps going when a page comes back empty but still carries a cursor", async () => {
    // The endpoint stops scanning before it has filled a page, so an empty
    // page is not the end of the feed - the cursor says whether it is. One
    // press has to get past it, or the button reads as broken.
    pages.first = { employments: [employment("a")], nextCursor: "c1" };
    pages.c1 = { employments: [], nextCursor: "c2" };
    pages.c2 = { employments: [employment("b")], nextCursor: null };

    const wrapper = await mountFeed();
    await pressMore(wrapper);

    expect(wrapper.text()).toContain("Osoba b");
    expect(asked).toEqual([null, "c1", "c2"]);
  });

  it("says so when a page fails, and lets the reader try again", async () => {
    pages.first = {
      employments: [employment("a")],
      nextCursor: FAILING_CURSOR,
    };

    const wrapper = await mountFeed();
    await moreButton(wrapper).trigger("click");
    await vi.waitUntil(
      () => wrapper.find('[data-testid="recent-employments-error"]').exists(),
      { timeout: 2000 },
    );

    // The cursor survives the failure, so the button is still there to press.
    expect(moreButton(wrapper).exists()).toBe(true);
  });

  it("says so when there is nothing to show at all", async () => {
    pages.first = { employments: [], nextCursor: null };

    const wrapper = await mountFeed();

    expect(
      wrapper.find('[data-testid="recent-employments-empty"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-testid="recent-employments"]').exists()).toBe(
      false,
    );
  });
});
