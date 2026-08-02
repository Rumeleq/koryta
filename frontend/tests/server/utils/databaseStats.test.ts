import { describe, it, expect } from "vitest";
import {
  bucketNotes,
  bucketPeople,
  bucketPlaces,
  bucketVotes,
} from "../../../server/utils/databaseStats";

const notPipeline = () => false;

describe("bucketPeople", () => {
  it("puts every person in exactly one of the three states", () => {
    const result = bucketPeople([
      { isApproved: true, humanVoted: true },
      { isApproved: false, humanVoted: true },
      { isApproved: false, notesCount: 2 },
      { isApproved: false },
      {},
    ]);

    expect(result.total).toBe(5);
    expect(result.approved).toBe(1);
    expect(result.reviewed).toBe(2);
    expect(result.toCheck).toBe(2);
    expect(result.approved + result.reviewed + result.toCheck).toBe(
      result.total,
    );
  });

  it("counts an approved person's votes and notes too", () => {
    const result = bucketPeople([
      { isApproved: true, humanVoted: true, notesCount: 1 },
    ]);

    expect(result.withVotes).toBe(1);
    expect(result.withNotes).toBe(1);
  });

  it("reads public employment off the edge stats", () => {
    const result = bucketPeople([
      { experienceMonths: 30, currentlyEmployed: true },
      { experienceMonths: 12, currentlyEmployed: false },
      { experienceMonths: 0 },
      {},
    ]);

    expect(result.withPublicEmployment).toBe(2);
    expect(result.currentlyEmployed).toBe(1);
  });
});

describe("bucketPlaces", () => {
  it("only calls a place private once a human said so", () => {
    const result = bucketPlaces([
      { isPublic: true },
      { isPublic: true, isPublicSource: "manual" },
      { isPublic: false, isPublicSource: "manual" },
      // The scrapers' silence about a spółka akcyjna, not a verdict.
      { isPublic: false },
      {},
    ]);

    expect(result.publicSector).toBe(2);
    expect(result.confirmedPrivate).toBe(1);
    expect(result.unknown).toBe(2);
    expect(result.total).toBe(5);
  });
});

describe("bucketNotes", () => {
  it("counts entries rather than documents, and triage state per entry", () => {
    const result = bucketNotes([
      {
        nodeId: "n1",
        sources: [
          { note: "a", kind: "source", adminStatus: "resolved" },
          { note: "b", kind: "change_request", adminStatus: "unresolved" },
          { note: "c", kind: "missing" },
        ],
      },
      { nodeId: "n1", sources: [{ note: "d", kind: "source" }] },
      { nodeId: "n2", sources: [] },
    ]);

    expect(result.notes).toBe(3);
    expect(result.sources).toBe(4);
    expect(result.byKind).toEqual({ source: 2, change_request: 1, missing: 1 });
    expect(result.resolved).toBe(1);
    expect(result.unresolved).toBe(1);
    expect(result.untriaged).toBe(2);
    expect(result.annotatedNodes).toBe(2);
  });

  it("treats an entry written before kinds existed as a source", () => {
    const result = bucketNotes([{ nodeId: "n1", sources: [{ note: "a" }] }]);
    expect(result.byKind.source).toBe(1);
  });
});

describe("bucketVotes", () => {
  it("tells a vote on a person apart from one on an extraction", () => {
    const result = bucketVotes(
      [
        { userUid: "u1", nodeId: "n1", categoryVotes: { interesting: 3 } },
        {
          userUid: "u1",
          extractionId: "e1",
          categoryVotes: { correct: 1 },
        },
        { userUid: "u2", nodeId: "n2", categoryVotes: {}, comment: "hm" },
      ],
      notPipeline,
    );

    expect(result.total).toBe(3);
    expect(result.onNodes).toBe(2);
    expect(result.onExtractions).toBe(1);
    expect(result.voters).toBe(2);
    expect(result.withComment).toBe(1);
  });

  it("bins the -5..5 scale and leaves zero out of it", () => {
    const result = bucketVotes(
      [
        { userUid: "u1", nodeId: "a", categoryVotes: { interesting: 5 } },
        { userUid: "u2", nodeId: "b", categoryVotes: { interesting: 5 } },
        { userUid: "u3", nodeId: "c", categoryVotes: { interesting: -2 } },
        { userUid: "u4", nodeId: "d", categoryVotes: { interesting: 0 } },
        { userUid: "u5", nodeId: "e", categoryVotes: { quality: -1 } },
      ],
      notPipeline,
    );

    expect(result.distribution.interesting!["5"]).toBe(2);
    expect(result.distribution.interesting!["-2"]).toBe(1);
    expect(result.distribution.interesting!["1"]).toBe(0);
    expect(result.distribution.quality!["-1"]).toBe(1);
    expect(Object.keys(result.distribution.interesting!)).not.toContain("0");
  });

  it("pulls an out-of-range verdict to the nearest end of the scale", () => {
    const result = bucketVotes(
      [
        { userUid: "u1", nodeId: "a", categoryVotes: { interesting: 42 } },
        { userUid: "u2", nodeId: "b", categoryVotes: { interesting: -42 } },
      ],
      notPipeline,
    );

    expect(result.distribution.interesting!["5"]).toBe(1);
    expect(result.distribution.interesting!["-5"]).toBe(1);
  });

  it("leaves the pipeline out of the counts entirely", () => {
    const result = bucketVotes(
      [
        { userUid: "pipeline", nodeId: "a", categoryVotes: { interesting: 4 } },
        { userUid: "u1", nodeId: "b", categoryVotes: { interesting: 4 } },
      ],
      (uid) => uid === "pipeline",
    );

    expect(result.total).toBe(1);
    expect(result.voters).toBe(1);
    expect(result.distribution.interesting!["4"]).toBe(1);
  });
});
