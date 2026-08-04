import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import PublishNodeDialog from "../../../app/components/admin/PublishNodeDialog.vue";
import type { NodeRelation } from "~~/server/api/edges/byNode.get";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: { value: null } }),
}));

const vuetify = createVuetify({ components, directives });

// Vuetify's overlay measures the viewport as it opens, and jsdom has neither of
// these. Without them the dialog throws before it ever renders a row.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
global.visualViewport = {
  width: 1024,
  height: 768,
  offsetLeft: 0,
  offsetTop: 0,
  pageLeft: 0,
  pageTop: 0,
  scale: 1,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
} as unknown as VisualViewport;

const relation = (overrides: Partial<NodeRelation> = {}): NodeRelation => ({
  id: "edge-1",
  type: "employed",
  name: null,
  direction: "outgoing",
  otherId: "firma",
  otherName: "Firma sp. z o.o.",
  otherPublished: true,
  published: false,
  hasPendingRevision: false,
  publishable: true,
  ...overrides,
});

/** The GET the dialog makes on open answers with this list; every POST it makes
 * afterwards succeeds. */
function serveRelations(relations: NodeRelation[]) {
  mockAuthRequest.mockImplementation(
    async (url: string, opts: { method?: string } = {}) =>
      opts.method === "GET"
        ? { relations, nodePublished: false }
        : { ok: true, url },
  );
}

function mountDialog() {
  return mount(PublishNodeDialog, {
    // The dialog content is teleported out of the component's own subtree, so
    // it only lands somewhere queryable if the component itself is in the
    // document.
    attachTo: document.body,
    props: {
      modelValue: false,
      nodeId: "jan-kowalski",
      nodeName: "Jan Kowalski",
    },
    global: { plugins: [vuetify] },
  });
}

/** The dialog loads on the false -> true transition, which is how the page
 * drives it, so every test opens it the same way rather than mounting it open. */
async function open(wrapper: ReturnType<typeof mountDialog>) {
  await wrapper.setProps({ modelValue: true });
  await flushPromises();
}

const el = (testid: string) =>
  document.body.querySelector(`[data-testid="${testid}"]`);

const checkbox = (id: string) =>
  document.body.querySelector<HTMLInputElement>(
    `[data-testid="publish-relation-check-${id}"] input`,
  );

/** A native click is what Vuetify's own handlers listen for, and it works on
 * teleported nodes that `wrapper.find` cannot reach. */
async function click(target: Element | null) {
  expect(target).not.toBeNull();
  (target as HTMLElement).click();
  await flushPromises();
}

const confirmButton = () => el("publish-confirm") as HTMLElement;

const requestedUrls = () =>
  mockAuthRequest.mock.calls.map(([url]) => url as string);

let wrapper: ReturnType<typeof mountDialog> | undefined;

describe("PublishNodeDialog.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serveRelations([]);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = "";
  });

  it("asks for the node's relations when it opens and offers only the unpublished ones", async () => {
    serveRelations([
      relation({ id: "waiting", otherName: "Firma sp. z o.o." }),
      relation({ id: "live", published: true, otherName: "Druga Firma" }),
    ]);
    wrapper = mountDialog();

    // Nothing is fetched while the dialog is closed - the page keeps it mounted
    // the whole time it is on screen.
    expect(mockAuthRequest).not.toHaveBeenCalled();

    await open(wrapper);

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/edges/byNode", {
      method: "GET",
      query: { nodeId: "jan-kowalski" },
    });
    expect(el("publish-relation-waiting")).not.toBeNull();
    // An already public relation has nothing left to decide, so listing it
    // would only bury the row that does.
    expect(el("publish-relation-live")).toBeNull();
  });

  it("names the other end of each relation and marks the ones with a proposal waiting", async () => {
    serveRelations([
      relation({
        id: "praca",
        otherName: "Firma sp. z o.o.",
        hasPendingRevision: true,
      }),
    ]);
    wrapper = mountDialog();
    await open(wrapper);

    const row = el("publish-relation-praca") as HTMLElement;
    expect(row.textContent).toContain("Zatrudniony/a w");
    expect(row.textContent).toContain("Firma sp. z o.o.");
    expect(row.textContent).toContain("propozycja czeka na zatwierdzenie");
  });

  it("disables the checkbox of a relation whose other end is still a draft", async () => {
    serveRelations([
      relation({ id: "ready" }),
      relation({
        id: "blocked",
        otherId: "szkic",
        otherName: "Szkic Nieopublikowany",
        otherPublished: false,
        publishable: false,
      }),
    ]);
    wrapper = mountDialog();
    await open(wrapper);

    expect(checkbox("ready")?.disabled).toBe(false);
    // Publishing this edge would be refused by the API, so the row is shown -
    // greyed - rather than hidden, and cannot be ticked.
    expect(checkbox("blocked")?.disabled).toBe(true);
    expect((el("publish-relation-blocked") as HTMLElement).className).toContain(
      "text-disabled",
    );
  });

  it("ticks every publishable relation on 'Zaznacz wszystkie' and none of the blocked ones", async () => {
    serveRelations([
      relation({ id: "ready-a" }),
      relation({ id: "ready-b", otherId: "druga", otherName: "Druga Firma" }),
      relation({ id: "blocked", otherPublished: false, publishable: false }),
    ]);
    wrapper = mountDialog();
    await open(wrapper);

    await click(el("publish-select-all"));

    expect(checkbox("ready-a")?.checked).toBe(true);
    expect(checkbox("ready-b")?.checked).toBe(true);
    expect(checkbox("blocked")?.checked).toBe(false);
    expect(confirmButton().textContent).toContain(
      "Opublikuj stronę i 2 powiązania",
    );
  });

  it("clears the selection when 'Zaznacz wszystkie' is pressed a second time", async () => {
    serveRelations([relation({ id: "ready-a" }), relation({ id: "ready-b" })]);
    wrapper = mountDialog();
    await open(wrapper);

    await click(el("publish-select-all"));
    expect(el("publish-select-all")?.textContent).toContain(
      "Odznacz wszystkie",
    );

    await click(el("publish-select-all"));

    expect(checkbox("ready-a")?.checked).toBe(false);
    expect(checkbox("ready-b")?.checked).toBe(false);
    expect(el("publish-select-all")?.textContent).toContain(
      "Zaznacz wszystkie",
    );
  });

  it("offers only the page itself while nothing is ticked", async () => {
    serveRelations([relation({ id: "ready" })]);
    wrapper = mountDialog();
    await open(wrapper);

    expect(confirmButton().textContent).toContain("Opublikuj tylko stronę");
  });

  it("counts the ticked relations in Polish", async () => {
    serveRelations(
      ["a", "b", "c", "d", "e"].map((id) => relation({ id: `ready-${id}` })),
    );
    wrapper = mountDialog();
    await open(wrapper);

    await click(checkbox("ready-a"));
    expect(confirmButton().textContent).toContain(
      "Opublikuj stronę i 1 powiązanie",
    );

    await click(checkbox("ready-b"));
    expect(confirmButton().textContent).toContain(
      "Opublikuj stronę i 2 powiązania",
    );

    await click(checkbox("ready-c"));
    await click(checkbox("ready-d"));
    await click(checkbox("ready-e"));
    expect(confirmButton().textContent).toContain(
      "Opublikuj stronę i 5 powiązań",
    );
  });

  it("publishes the page on its own when no relation was ticked", async () => {
    serveRelations([relation({ id: "ready" })]);
    wrapper = mountDialog();
    await open(wrapper);

    await click(confirmButton());

    expect(mockAuthRequest).toHaveBeenCalledWith("/api/nodes/publish", {
      body: { node_id: "jan-kowalski", published: true },
    });
    expect(requestedUrls()).not.toContain("/api/edges/publish");
  });

  it("publishes the page before its relations", async () => {
    serveRelations([relation({ id: "ready-a" }), relation({ id: "ready-b" })]);
    wrapper = mountDialog();
    await open(wrapper);
    await click(checkbox("ready-a"));

    await click(confirmButton());

    // Order is load bearing: an edge may not be published while either of its
    // pages is a draft, and this node is one of them until the first call
    // lands.
    expect(requestedUrls()).toEqual([
      "/api/edges/byNode",
      "/api/nodes/publish",
      "/api/edges/publish",
    ]);
    expect(mockAuthRequest).toHaveBeenLastCalledWith("/api/edges/publish", {
      body: { edge_ids: ["ready-a"], published: true },
    });
  });

  it("reports how many relations went live and closes", async () => {
    serveRelations([relation({ id: "ready-a" }), relation({ id: "ready-b" })]);
    wrapper = mountDialog();
    await open(wrapper);
    await click(el("publish-select-all"));

    await click(confirmButton());

    expect(wrapper.emitted("published")).toEqual([[{ relations: 2 }]]);
    expect(wrapper.emitted("failed")).toBeUndefined();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([false]);
  });

  it("stays open and reports the error when publishing fails", async () => {
    serveRelations([relation({ id: "ready" })]);
    wrapper = mountDialog();
    await open(wrapper);
    const failure = new Error("Firestore niedostępny");
    mockAuthRequest.mockRejectedValueOnce(failure);

    await click(confirmButton());

    expect(wrapper.emitted("failed")).toEqual([[failure]]);
    expect(wrapper.emitted("published")).toBeUndefined();
    // The admin has to be able to read the message and retry, so the dialog
    // must not ask its parent to close.
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(confirmButton()).not.toBeNull();
  });

  it("still publishes the page when the relations could not be loaded", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockAuthRequest.mockImplementation(
      async (_url: string, opts: { method?: string } = {}) => {
        if (opts.method === "GET") throw new Error("500");
        return { ok: true };
      },
    );
    wrapper = mountDialog();
    await open(wrapper);

    expect(el("publish-relations-error")).not.toBeNull();
    expect(confirmButton().textContent).toContain("Opublikuj tylko stronę");

    await click(confirmButton());

    expect(mockAuthRequest).toHaveBeenLastCalledWith("/api/nodes/publish", {
      body: { node_id: "jan-kowalski", published: true },
    });
    expect(wrapper.emitted("published")).toEqual([[{ relations: 0 }]]);
    consoleError.mockRestore();
  });

  it("says so when the node has no relations waiting for publication", async () => {
    serveRelations([relation({ id: "live", published: true })]);
    wrapper = mountDialog();
    await open(wrapper);

    expect((el("publish-no-relations") as HTMLElement).textContent).toContain(
      "Ta strona nie ma powiązań czekających na publikację",
    );
    expect(el("publish-select-all")).toBeNull();
  });

  it("refetches and forgets the previous ticks each time it is reopened", async () => {
    serveRelations([relation({ id: "ready-a" }), relation({ id: "ready-b" })]);
    wrapper = mountDialog();
    await open(wrapper);
    await click(el("publish-select-all"));
    await wrapper.setProps({ modelValue: false });

    await open(wrapper);

    // A second look at the same node can meet a different answer - a relation
    // may have been published elsewhere in the meantime - so the list and the
    // selection both start over.
    expect(requestedUrls()).toEqual(["/api/edges/byNode", "/api/edges/byNode"]);
    expect(confirmButton().textContent).toContain("Opublikuj tylko stronę");
  });
});
