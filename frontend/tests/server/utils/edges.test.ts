import { describe, it, expect } from "vitest";
import {
  edgeDocumentId,
  edgeIdentity,
  edgeSemantics,
  findEdges,
  findEdge,
  type EdgeLike,
} from "../../../server/utils/edges";

const owns: EdgeLike = { source: "a", target: "b", type: "owns" };
const spell: EdgeLike = {
  source: "p",
  target: "c",
  type: "employed",
  name: "prezes",
  start_date: "2010-03-01",
};
const candidacy: EdgeLike = {
  source: "p",
  target: "teryt1465",
  type: "election",
  name: "kandydatura",
  position: "Samorząd",
  start_date: "2024-01-01",
};

describe("edgeIdentity", () => {
  it("ignores everything but the pair for a state edge", () => {
    // An `owns` tie holds or it does not; a stray date does not make a second
    // fact of it.
    expect(edgeIdentity({ ...owns, start_date: "2020-01-01" })).toBe(
      edgeIdentity(owns),
    );
  });

  it("separates two spells of employment by when they began", () => {
    // What "employed there again after a break" means.
    expect(edgeIdentity({ ...spell, start_date: "2015-06-01" })).not.toBe(
      edgeIdentity(spell),
    );
  });

  it("does not separate one spell by an end date learned later", () => {
    // end_date is a property of the spell, not part of which spell it is.
    expect(edgeIdentity({ ...spell, end_date: "2012-05-01" })).toBe(
      edgeIdentity(spell),
    );
  });

  it("treats a blank written by the edit form as an absent field", () => {
    // /api/edges/create writes "" and false where the ingest omits the field;
    // without this a hand-made edge could never match an ingested one.
    expect(
      edgeIdentity({ ...spell, party: "", committee: "", elected: false }),
    ).toBe(edgeIdentity(spell));
  });

  it("ignores fields that say nothing about what the edge asserts", () => {
    expect(edgeIdentity({ ...spell, revision_id: "rev-1" })).toBe(
      edgeIdentity(spell),
    );
  });
});

describe("edgeSemantics", () => {
  it("reads an unknown edge type as authored, so nothing merges it", () => {
    const unknown = edgeSemantics("mentioned_person");
    expect(unknown.kind).toBe("authored");
    expect(unknown.identicalMeansSame).toBe(false);
  });

  it("refuses to call two identical elections one fact", () => {
    // The office, the committee and the run-off round are stripped upstream, so
    // two different candidacies can be byte-identical.
    expect(edgeSemantics("election").identicalMeansSame).toBe(false);
  });
});

describe("edgeDocumentId", () => {
  it("keeps the plain form for a state edge, whatever else it carries", () => {
    // The scheme the region pipeline and the company ingest already use.
    expect(
      edgeDocumentId({ source: "teryt1061", target: "c1", type: "owns" }),
    ).toBe("edge_teryt1061_c1_owns");
    expect(edgeDocumentId({ ...owns, start_date: "2020-01-01" })).toBe(
      "edge_a_b_owns",
    );
  });

  it("gives two spells between the same pair different ids", () => {
    expect(edgeDocumentId(spell)).not.toBe(
      edgeDocumentId({ ...spell, start_date: "2015-06-01" }),
    );
  });

  it("gives a second indistinguishable candidacy an id of its own", () => {
    // Standing for burmistrz and for the rada in one town in 2024 stores two
    // identical rows; both are real, so both need a document.
    expect(edgeDocumentId(candidacy, 1)).not.toBe(edgeDocumentId(candidacy, 0));
  });

  it("leaves the first copy's id unchanged", () => {
    expect(edgeDocumentId(candidacy, 0)).toBe(edgeDocumentId(candidacy));
  });

  it("produces an id Firestore will accept", () => {
    const id = edgeDocumentId(candidacy, 2);
    expect(id).not.toContain("/");
    expect(id.length).toBeLessThan(100);
  });
});

function dbWith(stored: EdgeLike[]) {
  return {
    collection: () => ({
      where: function () {
        return this;
      },
      get: async () => ({
        docs: stored.map((edge, index) => ({
          id: `stored-${index}`,
          data: () => edge,
        })),
      }),
    }),
  } as unknown as FirebaseFirestore.Firestore;
}

describe("findEdges", () => {
  it("finds an edge asserting the same thing", async () => {
    await expect(findEdge(dbWith([spell]), spell)).resolves.toBe("stored-0");
  });

  it("does not match a different spell", async () => {
    const other = { ...spell, start_date: "2015-06-01" };
    await expect(findEdge(dbWith([other]), spell)).resolves.toBeUndefined();
  });

  it("matches a state edge on the pair alone", async () => {
    const stored = { ...owns, start_date: "2020-01-01", name: "whatever" };
    await expect(findEdge(dbWith([stored]), owns)).resolves.toBe("stored-0");
  });

  it("returns every copy, so the n-th payload row can take the n-th", async () => {
    // Two indistinguishable candidacies already stored: re-sending the payload
    // has to map its two rows onto these two rather than create more.
    const found = await findEdges(dbWith([candidacy, candidacy]), candidacy);
    expect(found).toEqual(["stored-0", "stored-1"]);
  });
});
