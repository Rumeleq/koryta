import { describe, it, expect, vi } from "vitest";
import { mountSuspended } from "@nuxt/test-utils/runtime";
import OpiniePage from "../../../app/pages/admin/opinie.vue";
import type { Feedback, FeedbackStatus } from "~~/shared/model";

const { mockAuthRequest } = vi.hoisted(() => ({ mockAuthRequest: vi.fn() }));

vi.mock("~/composables/auth", () => ({
  authRequest: mockAuthRequest,
  useAuthState: () => ({ user: { value: null } }),
}));

vi.mock("@plausible-analytics/tracker", () => ({
  init: vi.fn(),
  track: vi.fn(),
}));

const feedback = (id: string, adminStatus: FeedbackStatus): Feedback => ({
  id,
  kind: "bug",
  message: `zgłoszenie ${id}`,
  createdAt: "2026-08-24T10:00:00.000Z",
  adminStatus,
  context: { route: "/", pageTitle: "Koryta.pl" },
});

const serve = (items: Feedback[]) => {
  mockAuthRequest.mockImplementation(
    async (_url: string, opts: { method: string }) =>
      opts.method === "GET" ? { feedback: items } : { ok: true },
  );
};

const mount = () =>
  mountSuspended(OpiniePage, { global: { stubs: { UserChip: true } } });

/** The card for one report, found by the id the Slack link also uses. */
const card = (wrapper: Awaited<ReturnType<typeof mount>>, id: string) =>
  wrapper.get(`#fb-${id}`);

describe("admin feedback queue", () => {
  it("dims what is settled and leaves open work alone", async () => {
    serve([
      feedback("new-one", "new"),
      feedback("doing", "in_progress"),
      feedback("done", "resolved"),
      feedback("wont", "wont_fix"),
    ]);
    const wrapper = await mount();

    // "W trakcie" is still somebody's job, so it reads like a new report.
    expect(card(wrapper, "new-one").classes()).not.toContain(
      "feedback-settled",
    );
    expect(card(wrapper, "doing").classes()).not.toContain("feedback-settled");

    expect(card(wrapper, "done").classes()).toContain("feedback-settled");
    expect(card(wrapper, "wont").classes()).toContain("feedback-settled");
  });
});
