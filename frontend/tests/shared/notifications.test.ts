import { describe, it, expect } from "vitest";
import {
  notificationDefaults,
  notificationEnabled,
  notificationKinds,
  notificationLabels,
  renderNotification,
} from "../../shared/notifications";

const SITE = "https://koryta.pl";

describe("notificationEnabled", () => {
  it("falls back to the default when the user never chose", () => {
    expect(notificationEnabled("revisionApproved", undefined)).toBe(true);
    expect(notificationEnabled("revisionApproved", {})).toBe(true);
  });

  it("honours an explicit no", () => {
    expect(
      notificationEnabled("revisionApproved", { revisionApproved: false }),
    ).toBe(false);
    // Opting out of one kind says nothing about the other.
    expect(
      notificationEnabled("revisionRejected", { revisionApproved: false }),
    ).toBe(true);
  });

  it("has a default and a label for every kind", () => {
    // The profile page renders one switch per kind off these two maps; a kind
    // missing from either renders as undefined rather than failing to build.
    for (const kind of notificationKinds) {
      expect(notificationDefaults[kind]).toBeTypeOf("boolean");
      expect(notificationLabels[kind].title).toBeTruthy();
    }
  });
});

describe("renderNotification", () => {
  it("names the page in the subject and links to it", () => {
    const mail = renderNotification(
      {
        kind: "revisionApproved",
        target: { name: "Jan Kowalski", path: "/osoba/jan-kowalski-abc" },
        published: true,
      },
      SITE,
    );

    expect(mail.subject).toContain("Jan Kowalski");
    expect(mail.text).toContain("https://koryta.pl/osoba/jan-kowalski-abc");
    expect(mail.html).toContain(
      'href="https://koryta.pl/osoba/jan-kowalski-abc"',
    );
  });

  it("warns that an approved change is not live yet", () => {
    // Approving and publishing are separate decisions, so the link can lead
    // somewhere the reader cannot open. Saying so beats them reporting a bug.
    const live = renderNotification(
      { kind: "revisionApproved", target: { name: "X" }, published: true },
      SITE,
    );
    const notLive = renderNotification(
      { kind: "revisionApproved", target: { name: "X" }, published: false },
      SITE,
    );

    expect(live.text).not.toContain("widoczna publicznie");
    expect(notLive.text).toContain("widoczna publicznie");
  });

  it("carries the reason a change was turned down", () => {
    const mail = renderNotification(
      {
        kind: "revisionRejected",
        target: { name: "Jan Kowalski" },
        reason: "brak źródła",
      },
      SITE,
    );

    expect(mail.subject).toContain("Nie przyjęto");
    expect(mail.text).toContain("brak źródła");
    expect(mail.html).toContain("brak źródła");
  });

  it("leaves out the link when there is no page to send anyone to", () => {
    const mail = renderNotification(
      {
        kind: "revisionApproved",
        target: { name: "powiązanie" },
        published: true,
      },
      SITE,
    );

    expect(mail.text).not.toContain("Zobacz stronę");
    expect(mail.html).not.toContain('<a href="https://koryta.pl/osoba');
  });

  it("escapes what a contributor typed", () => {
    // The rejection reason and the page name are both free text an admin or a
    // reader wrote, and they land in an html document.
    const mail = renderNotification(
      {
        kind: "revisionRejected",
        target: { name: "<script>alert(1)</script>" },
        reason: 'nie & "nie"',
      },
      SITE,
    );

    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("&amp;");
    expect(mail.html).toContain("&quot;");
    // The plain text part is not markup and must stay readable.
    expect(mail.text).toContain('nie & "nie"');
  });

  it("always offers a way out", () => {
    for (const mail of [
      renderNotification(
        { kind: "revisionApproved", target: { name: "X" }, published: true },
        SITE,
      ),
      renderNotification(
        { kind: "revisionRejected", target: { name: "X" }, reason: "r" },
        SITE,
      ),
    ]) {
      expect(mail.text).toContain("https://koryta.pl/profil");
      expect(mail.html).toContain("https://koryta.pl/profil");
    }
  });

  it("links to the deployment it was rendered against", () => {
    // Otherwise an emulator run mails a real contributor a production link.
    const mail = renderNotification(
      {
        kind: "revisionApproved",
        target: { name: "X", path: "/osoba/x-1" },
        published: true,
      },
      "http://localhost:3000/",
    );

    expect(mail.text).toContain("http://localhost:3000/osoba/x-1");
    expect(mail.text).not.toContain("koryta.pl");
  });
});
