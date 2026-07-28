import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../server/api/feedback/create.post";

const { mockAdd, mockVerifyIdToken, dailyCount } = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.createError = (opts: { statusCode: number; message?: string }) =>
    Object.assign(new Error(opts.message), opts);
  g.getRequestHeader = (
    event: { headers?: Record<string, string> },
    name: string,
  ) => event.headers?.[name.toLowerCase()];

  return {
    mockAdd: vi.fn(),
    mockVerifyIdToken: vi.fn(),
    // How many reports today's counter already holds, for the daily-cap tests.
    dailyCount: { value: 0 },
  };
});

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (fn: unknown) => fn,
    readValidatedBody: async (
      event: { body: unknown },
      parser: (b: unknown) => unknown,
    ) => parser(event.body),
  };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => ({ add: mockAdd, doc: () => ({}) }),
    runTransaction: (
      fn: (tx: {
        get: () => Promise<{ get: () => number }>;
        set: () => void;
      }) => Promise<boolean>,
    ) =>
      fn({
        get: async () => ({ get: () => dailyCount.value }),
        set: () => {},
      }),
  }),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

type Event = { body: unknown; headers?: Record<string, string> };

const callHandler = (event: Event) =>
  (handler as unknown as (e: Event) => Promise<{ id: string | null }>)(event);

const validBody = {
  kind: "bug",
  message: "  Coś tu nie gra  ",
  context: { route: "/osoba/jan-testowy", nodeId: "node-1" },
};

const written = () => mockAdd.mock.calls[0]?.[0];

describe("/api/feedback/create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dailyCount.value = 0;
    mockAdd.mockResolvedValue({ id: "fb-1" });
  });

  it("accepts a report from a signed-out visitor", async () => {
    const result = await callHandler({ body: validBody });

    expect(result).toEqual({ id: "fb-1" });
    expect(written()).toMatchObject({
      kind: "bug",
      message: "Coś tu nie gra",
      adminStatus: "new",
    });
    // Anonymous reports carry no uid at all rather than a placeholder.
    expect(written()).not.toHaveProperty("userUid");
  });

  it("attributes the report when a valid token is sent", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: "user-a" });

    await callHandler({
      body: validBody,
      headers: { authorization: "Bearer good-token" },
    });

    expect(written()).toMatchObject({ userUid: "user-a" });
  });

  it("falls back to anonymous rather than failing on a bad token", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("expired"));

    await callHandler({
      body: validBody,
      headers: { authorization: "Bearer stale-token" },
    });

    expect(written()).not.toHaveProperty("userUid");
  });

  it("records the user agent from the request, not the body", async () => {
    await callHandler({
      body: validBody,
      headers: { "user-agent": "Mozilla/5.0 (test)" },
    });

    expect(written().context).toMatchObject({
      route: "/osoba/jan-testowy",
      userAgent: "Mozilla/5.0 (test)",
    });
  });

  it("rejects an empty message and an unknown kind", async () => {
    await expect(
      callHandler({ body: { ...validBody, message: "   " } }),
    ).rejects.toThrow();

    await expect(
      callHandler({ body: { ...validBody, kind: "spam" } }),
    ).rejects.toThrow();

    expect(mockAdd).not.toHaveBeenCalled();
  });

  // The admin panel renders the route as a link, so anything that is not a
  // site-relative path is a way to hand an admin a hostile URL.
  it.each([
    "javascript:alert(1)",
    "https://evil.example/login",
    "//evil.example",
    "osoba/bez-ukosnika",
  ])("refuses a route that is not site-relative: %s", async (route) => {
    await expect(
      callHandler({ body: { ...validBody, context: { route } } }),
    ).rejects.toThrow();

    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("drops a submission that filled the honeypot, without saying so", async () => {
    const result = await callHandler({
      body: { ...validBody, website: "http://spam.example" },
    });

    expect(result).toEqual({ id: null });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("still saves past the daily cap, but marks it not to reach Slack", async () => {
    dailyCount.value = 500;

    await callHandler({ body: validBody });

    // The report is kept - /admin/opinie stays authoritative - and only the
    // forward is suppressed, so one abuser cannot silence real reporters.
    expect(mockAdd).toHaveBeenCalled();
    expect(written().slack).toEqual({ state: "failed", error: "daily_cap" });
  });

  it("leaves the Slack state alone under the cap", async () => {
    dailyCount.value = 3;

    await callHandler({ body: validBody });

    expect(written()).not.toHaveProperty("slack");
  });
});
