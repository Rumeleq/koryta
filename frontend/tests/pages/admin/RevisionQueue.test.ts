import { describe, it, expect, vi } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import KolejkaPage from "../../../app/pages/admin/rewizje/kolejka.vue";
import type { Proposal } from "~~/shared/proposals";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: { value: null }, isAdmin: { value: true } }),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const proposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  id: "rev-1",
  targetId: "node-1",
  targetCollection: "nodes",
  targetName: "Jan Testowy",
  targetType: "person",
  targetPath: "/osoba/jan-testowy-node-1",
  targetExists: true,
  published: true,
  kind: "update",
  deleteReason: null,
  changes: [],
  changeCount: 0,
  updateTime: "2026-08-20T10:00:00.000Z",
  updateUser: "user-a",
  author: { displayName: "Autor Testowy", email: null, photoURL: null },
  automatic: false,
  status: "pending",
  statusDerived: false,
  rejectReason: null,
  reviewTime: null,
  stale: false,
  ...overrides,
});

const serve = (revisions: Proposal[]) => {
  mockAuthRequest.mockImplementation(async () => ({
    revisions,
    total: revisions.length,
    flagOnly: false,
    truncated: false,
    pinned: null,
  }));
};

const mount = () =>
  mountSuspended(KolejkaPage, {
    global: { stubs: { UserChip: true, VSnackbar: true } },
  });

describe("the review queue's rows", () => {
  it("offers one button, to this revision in the comparison view", async () => {
    serve([proposal()]);
    const wrapper = await mount();

    const row = wrapper.get("tbody tr");
    // One decision per row: everything that used to crowd the last column -
    // approve, approve-and-publish, reject, compare, copy link - now lives on
    // the screen the button opens.
    expect(row.findAll(".v-btn")).toHaveLength(1);

    // The href the anchor ends up with is the test router's business; what
    // this page decides is the target it hands the button.
    const button = wrapper.findComponent('[data-testid="review-rev-1"]');
    expect(button.text()).toContain("Rozpatrz");
    expect(button.props("to")).toBe("/admin/rewizje/node-1?revisionId=rev-1");
  });

  it("sends an edge revision to the page that can review it", async () => {
    serve([
      proposal({
        id: "rev-edge",
        targetCollection: "edges",
        targetPath: null,
      }),
    ]);
    const wrapper = await mount();

    const button = wrapper.findComponent('[data-testid="review-rev-edge"]');
    expect(button.text()).toContain("Rewizje powiązań");
    expect(button.props("to")).toBe("/admin/rewizje-krawedzi");
  });

  it("names the columns a reviewer reads, author and date as one", async () => {
    serve([proposal()]);
    const wrapper = await mount();

    const headers = wrapper.findAll("thead th").map((th) => th.text());
    expect(headers).toEqual([
      "Zgłoszenie",
      "Czego dotyczy",
      "Proponowana zmiana",
      "",
    ]);
  });

  it("says what a settled revision offers instead of a decision", async () => {
    serve([proposal({ id: "rev-done", status: "approved" })]);
    const wrapper = await mount();

    expect(
      wrapper.findComponent('[data-testid="review-rev-done"]').text(),
    ).toContain("Zobacz");
  });
});
