import { describe, it, expect } from "vitest";
import {
  aggregateActivity,
  daysBetween,
  isPipelineUid,
  utcDay,
  type ActivityEvent,
} from "../../../server/utils/activityStats";

const WINDOW = { since: "2026-07-30", until: "2026-08-01" };

function event(
  uid: string,
  kind: ActivityEvent["kind"],
  at: string,
  count?: number,
): ActivityEvent {
  return { uid, kind, at, count };
}

describe("utcDay", () => {
  it("cuts the day off an ISO instant", () => {
    expect(utcDay("2026-08-01T22:15:00.000Z")).toBe("2026-08-01");
  });

  it("rejects anything that is not a date", () => {
    expect(utcDay("wczoraj")).toBeNull();
    expect(utcDay(undefined)).toBeNull();
    expect(utcDay("")).toBeNull();
  });
});

describe("daysBetween", () => {
  it("is inclusive at both ends", () => {
    expect(daysBetween("2026-07-30", "2026-08-01")).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
    ]);
  });

  it("crosses a month and a leap day", () => {
    expect(daysBetween("2028-02-28", "2028-03-01")).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("is empty when the window runs backwards", () => {
    expect(daysBetween("2026-08-01", "2026-07-30")).toEqual([]);
  });
});

describe("isPipelineUid", () => {
  it("matches the ingest's own writes", () => {
    expect(isPipelineUid("pipeline")).toBe(true);
    expect(isPipelineUid("extraction-pipeline-v2")).toBe(true);
  });

  it("leaves people alone", () => {
    expect(isPipelineUid("aB3xYz")).toBe(false);
    expect(isPipelineUid(null)).toBe(false);
  });
});

describe("aggregateActivity", () => {
  it("fills every day of the window, quiet ones included", () => {
    const result = aggregateActivity(
      [event("u1", "nodeVote", "2026-08-01T09:00:00.000Z")],
      WINDOW,
    );

    expect(result.daily.map((d) => d.date)).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
    ]);
    expect(result.daily[0]!.total).toBe(0);
    expect(result.daily[2]!.counts.nodeVote).toBe(1);
  });

  it("keeps a vote on a person apart from a vote on an extraction", () => {
    const result = aggregateActivity(
      [
        event("u1", "nodeVote", "2026-07-31T10:00:00.000Z"),
        event("u1", "extractionVote", "2026-07-31T11:00:00.000Z"),
        event("u1", "extractionVote", "2026-07-31T12:00:00.000Z"),
      ],
      WINDOW,
    );

    expect(result.totals.nodeVote).toBe(1);
    expect(result.totals.extractionVote).toBe(2);
    expect(result.totals.revision).toBe(0);
    expect(result.total).toBe(3);
  });

  it("counts an event's weight, so a note carries one per source", () => {
    const result = aggregateActivity(
      [event("u1", "noteSource", "2026-07-31T10:00:00.000Z", 4)],
      WINDOW,
    );

    expect(result.totals.noteSource).toBe(4);
    expect(result.contributors[0]!.total).toBe(4);
  });

  it("ranks contributors by total and remembers when each was last seen", () => {
    const result = aggregateActivity(
      [
        event("quiet", "comment", "2026-08-01T08:00:00.000Z"),
        event("busy", "nodeVote", "2026-07-30T08:00:00.000Z"),
        event("busy", "nodeVote", "2026-07-31T08:00:00.000Z"),
        event("busy", "revision", "2026-07-31T20:00:00.000Z"),
      ],
      WINDOW,
    );

    expect(result.contributors.map((c) => c.uid)).toEqual(["busy", "quiet"]);
    expect(result.contributors[0]!.counts).toMatchObject({
      nodeVote: 2,
      revision: 1,
    });
    expect(result.contributors[0]!.lastActiveAt).toBe(
      "2026-07-31T20:00:00.000Z",
    );
  });

  it("orders equal totals stably rather than by insertion", () => {
    const events = [
      event("zeta", "comment", "2026-07-31T08:00:00.000Z"),
      event("alpha", "comment", "2026-07-31T08:00:00.000Z"),
    ];

    expect(
      aggregateActivity(events, WINDOW).contributors.map((c) => c.uid),
    ).toEqual(["alpha", "zeta"]);
    expect(
      aggregateActivity([...events].reverse(), WINDOW).contributors.map(
        (c) => c.uid,
      ),
    ).toEqual(["alpha", "zeta"]);
  });

  it("drops the pipeline's own writes", () => {
    const result = aggregateActivity(
      [
        event("pipeline", "revision", "2026-07-31T08:00:00.000Z"),
        event("u1", "revision", "2026-07-31T08:00:00.000Z"),
      ],
      WINDOW,
    );

    expect(result.totals.revision).toBe(1);
    expect(result.contributors).toHaveLength(1);
  });

  it("drops events outside the window instead of clamping them in", () => {
    const result = aggregateActivity(
      [
        event("u1", "nodeVote", "2026-07-29T23:59:59.000Z"),
        event("u1", "nodeVote", "2026-08-02T00:00:01.000Z"),
      ],
      WINDOW,
    );

    expect(result.total).toBe(0);
    expect(result.contributors).toHaveLength(0);
  });

  it("ignores an event with no positive weight", () => {
    const result = aggregateActivity(
      [event("u1", "noteSource", "2026-07-31T08:00:00.000Z", 0)],
      WINDOW,
    );

    expect(result.total).toBe(0);
    expect(result.contributors).toHaveLength(0);
  });
});
