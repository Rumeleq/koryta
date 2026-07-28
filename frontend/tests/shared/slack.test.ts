import { describe, it, expect } from "vitest";
import {
  buildFeedbackBlocks,
  buildFeedbackFallback,
  escapeMrkdwn,
} from "../../shared/slack";
import type { Feedback } from "../../shared/model";

const base: Feedback = {
  id: "fb-1",
  kind: "bug",
  message: "Wykres się nie ładuje",
  context: { route: "/osoba/jan-kowalski-1", pageTitle: "Jan Kowalski" },
  createdAt: "2026-07-28T10:00:00.000Z",
  adminStatus: "new",
};

const opts = { baseUrl: "https://koryta.pl" };

const blockOfType = (blocks: Record<string, unknown>[], type: string) =>
  blocks.find((b) => b.type === type);

const asText = (value: unknown) =>
  (value as { text?: { text?: string } }).text?.text ?? "";

describe("escapeMrkdwn", () => {
  it("escapes the three characters Slack treats as markup", () => {
    expect(escapeMrkdwn("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  it("does not double-escape the entities it just wrote", () => {
    expect(escapeMrkdwn("<a>")).toBe("&lt;a&gt;");
  });

  it("defuses an injected Slack link", () => {
    const injected = escapeMrkdwn("<https://evil.example|kliknij tutaj>");
    expect(injected).not.toContain("<https");
    expect(injected).toContain("&lt;https://evil.example|kliknij tutaj&gt;");
  });
});

describe("buildFeedbackBlocks", () => {
  it("puts the kind in the header and the message in a section", () => {
    const blocks = buildFeedbackBlocks(base, opts);

    expect(asText(blockOfType(blocks, "header"))).toContain("Coś nie działa");
    expect(asText(blockOfType(blocks, "section"))).toBe(
      "Wykres się nie ładuje",
    );
  });

  it("links the page the reporter was on, titled where a title was captured", () => {
    const fields = (
      buildFeedbackBlocks(base, opts).filter(
        (b) => b.type === "section",
      )[1] as {
        fields: { text: string }[];
      }
    ).fields;

    expect(fields[0]?.text).toContain(
      "<https://koryta.pl/osoba/jan-kowalski-1|Jan Kowalski>",
    );
  });

  it("credits an anonymous reporter as such", () => {
    const anonFields = (
      buildFeedbackBlocks(base, opts).filter(
        (b) => b.type === "section",
      )[1] as { fields: { text: string }[] }
    ).fields;

    expect(anonFields.some((f) => f.text.includes("_anonimowo_"))).toBe(true);
  });

  it("keeps a volunteered e-mail out of the channel", () => {
    const fields = (
      buildFeedbackBlocks({ ...base, contact: "kto@example.com" }, opts).filter(
        (b) => b.type === "section",
      )[1] as {
        fields: { text: string }[];
      }
    ).fields;

    // Slack history outlives our retention, so the address stays in the panel.
    expect(JSON.stringify(fields)).not.toContain("kto@example.com");
    expect(fields.some((f) => f.text.includes("kontakt podany"))).toBe(true);
  });

  it("reads a signed-in report as signed-in even when it carries an address", () => {
    const fields = (
      buildFeedbackBlocks(
        { ...base, userUid: "abcdef123456", contact: "kto@example.com" },
        opts,
      ).filter((b) => b.type === "section")[1] as {
        fields: { text: string }[];
      }
    ).fields;

    expect(fields.some((f) => f.text.includes("abcdef12"))).toBe(true);
    expect(JSON.stringify(fields)).not.toContain("kto@example.com");
  });

  it("never emits a field array with holes in it", () => {
    for (const feedback of [base, { ...base, contact: "a@b.pl" }]) {
      const fields = (
        buildFeedbackBlocks(feedback, opts).filter(
          (b) => b.type === "section",
        )[1] as { fields: unknown[] }
      ).fields;
      expect(fields.every((f) => f !== undefined && f !== null)).toBe(true);
    }
  });

  it("truncates a message that would blow Slack's section limit", () => {
    const long = { ...base, message: "x".repeat(5000) };
    const text = asText(
      blockOfType(buildFeedbackBlocks(long, opts), "section"),
    );

    expect(text.length).toBeLessThanOrEqual(3000);
    expect(text.endsWith("…")).toBe(true);
  });

  it("escapes the reporter's text so it cannot forge markup", () => {
    const nasty = { ...base, message: "<https://evil.example|klik> & <b>" };
    const text = asText(
      blockOfType(buildFeedbackBlocks(nasty, opts), "section"),
    );

    expect(text).not.toContain("<https");
    expect(text).toContain("&amp;");
  });

  it("keeps the header inside Slack's plain_text limit", () => {
    const blocks = buildFeedbackBlocks(base, opts);
    expect(asText(blockOfType(blocks, "header")).length).toBeLessThanOrEqual(
      150,
    );
  });

  it("links back to the admin panel, and omits the button without an id", () => {
    const withId = buildFeedbackBlocks(base, opts);
    const actions = blockOfType(withId, "actions") as {
      elements: { url: string }[];
    };
    expect(actions.elements[0]?.url).toBe(
      "https://koryta.pl/admin/opinie#fb-fb-1",
    );

    const noId = buildFeedbackBlocks({ ...base, id: undefined }, opts);
    expect(blockOfType(noId, "actions")).toBeUndefined();
  });

  it("escapes the page link so a route cannot break out of it", () => {
    const fields = (
      buildFeedbackBlocks(base, opts).filter(
        (b) => b.type === "section",
      )[1] as {
        fields: { text: string }[];
      }
    ).fields;

    // One link, so exactly one closing bracket: nothing has escaped the syntax.
    expect(fields[0]?.text.match(/>/g)?.length).toBe(1);
  });

  it("reports the viewport in the context line when it was captured", () => {
    const sized = {
      ...base,
      context: { ...base.context, viewport: { width: 1440, height: 900 } },
    };
    const blocks = buildFeedbackBlocks(sized, opts);
    const context = blockOfType(blocks, "context") as {
      elements: { text: string }[];
    };
    expect(context.elements[0]?.text).toContain("1440×900");

    expect(blockOfType(buildFeedbackBlocks(base, opts), "context")).toBe(
      undefined,
    );
  });
});

describe("buildFeedbackFallback", () => {
  it("names the kind and quotes the message", () => {
    expect(buildFeedbackFallback(base)).toBe(
      "Nowe zgłoszenie (Coś nie działa): Wykres się nie ładuje",
    );
  });

  it("stays short enough for a notification", () => {
    const long = { ...base, message: "x".repeat(5000) };
    expect(buildFeedbackFallback(long).length).toBeLessThanOrEqual(200);
  });
});
