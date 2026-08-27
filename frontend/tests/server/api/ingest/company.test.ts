import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRevisionTransaction } from "../../../../server/utils/revisions";
import handler from "../../../../server/api/ingest/company.post";

// Mock dependencies
const mockGet = vi.fn();
const mockLimit = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockReturnThis();
const mockDoc = vi.fn();
const mockCollection = vi.fn();
const mockBatch = vi.fn();
const mockCommit = vi.fn();
const mockRef = { id: "doc-ref-id" };

const mockDb = {
  collection: mockCollection,
  batch: mockBatch,
};

mockCollection.mockReturnValue({
  where: mockWhere,
  doc: mockDoc,
});
// Need to handle chaining: .where().where().limit().get()
const queryMock = {
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  get: mockGet,
};
mockWhere.mockImplementation(() => queryMock);
mockLimit.mockImplementation(() => queryMock);

mockDoc.mockReturnValue({
  id: "new-doc-id",
  ref: mockRef,
});
mockBatch.mockReturnValue({
  commit: mockCommit,
  set: vi.fn(),
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => mockDb),
}));

vi.mock("firebase-admin/app", () => ({
  getApp: vi.fn(),
}));

vi.mock("../../../../server/utils/auth", () => ({
  getUser: vi.fn().mockResolvedValue({ uid: "test-user-id" }),
}));

// `withoutInternalFields` is pure and is what decides which of the stored
// company's fields the revision carries, so the test wants the real one.
vi.mock("../../../../server/utils/revisions", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../server/utils/revisions")
  >()),
  createRevisionTransaction: vi.fn(),
}));

const { mockReadBody } = vi.hoisted(() => {
  const mockReadBody = vi.fn();
  globalThis.readBody = mockReadBody;
  globalThis.createError = (err: any) => err;
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.readValidatedBody = async (event: any, parse: any) => {
    const body = await mockReadBody();
    try {
      return parse(body);
    } catch {
      throw { statusCode: 400, message: "Missing required fields (krs, name)" };
    }
  };
  return { mockReadBody };
});

describe("api/ingest/company", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset query chain mocks
    mockWhere.mockReturnValue(queryMock);
    queryMock.where.mockReturnValue(queryMock);
    queryMock.limit.mockReturnValue(queryMock);
  });

  it("should throw 400 if krs is missing", async () => {
    mockReadBody.mockResolvedValue({ name: "Test Company" });

    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 400,
      message: "Missing required fields (krs, name)",
    });
  });

  it("should create a new company if it doesn't exist", async () => {
    mockReadBody.mockResolvedValue({ krs: "12345", name: "New Company" });
    mockGet.mockResolvedValue({ empty: true, docs: [] });
    // doc() returns a reference, not an object containing ref
    mockDoc.mockReturnValue(mockRef);

    const result = await handler({} as any);

    expect(mockCollection).toHaveBeenCalledWith("nodes");
    expect(mockDoc).toHaveBeenCalled(); // Should call doc() for new ID
    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      mockRef,
      {
        name: "New Company",
        type: "place",
        krsNumber: "12345",
      },
      { automatic: true, approve: true, published: true },
    );
    // ref.id is accessed in handler return statement
    expect(result).toEqual({ id: "doc-ref-id", code: 200 });
  });

  it("should re-approve an already-public existing company", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Updated Company",
    });

    const existingRef = { id: "existing-id" };
    const existingDoc = {
      ref: existingRef,
      // published => the company is currently live, and a re-ingest keeps it so
      data: () => ({
        content: "Old Content",
        revision_id: "rev-1",
        published: true,
      }),
    };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [existingDoc],
    });

    const result = await handler({} as any);

    expect(mockDoc).not.toHaveBeenCalled(); // Should use existing doc ref
    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      existingRef, // Expect the ref from the doc
      {
        // Layered over what is stored, so a field the payload says nothing
        // about is not deleted by the write.
        content: "Old Content",
        name: "Updated Company",
        type: "place",
        krsNumber: "12345",
      },
      {
        automatic: true,
        approve: true, // already public => stays public
        published: true,
        stored: expect.objectContaining({ published: true }),
      },
    );
    expect(result).toEqual({ id: "existing-id", code: 200 });
  });

  it("should keep a pending existing company pending", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Updated Company",
    });

    const existingRef = { id: "existing-id" };
    const existingDoc = {
      ref: existingRef,
      // no revision_id => the company is still pending / unapproved
      data: () => ({ content: "Old Content" }),
    };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [existingDoc],
    });

    const result = await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      existingRef,
      {
        content: "Old Content",
        name: "Updated Company",
        type: "place",
        krsNumber: "12345",
      },
      {
        automatic: true,
        approve: false, // pending => not force-published
        published: false,
        stored: expect.objectContaining({ content: "Old Content" }),
      },
    );
    expect(result).toEqual({ id: "existing-id", code: 200 });
  });

  it("should keep an approved-but-unpublished company hidden", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Updated Company",
    });

    const existingRef = { id: "existing-id" };
    const existingDoc = {
      ref: existingRef,
      // approved revision exists, but the node was explicitly unpublished
      data: () => ({ revision_id: "rev-1", published: false }),
    };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [existingDoc],
    });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      existingRef,
      {
        name: "Updated Company",
        type: "place",
        krsNumber: "12345",
      },
      {
        automatic: true,
        approve: false, // hidden => not force-published
        published: false,
        stored: expect.objectContaining({ published: false }),
      },
    );
  });

  it("should store isPublic when is_public is provided", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Public Company",
      is_public: true,
    });
    mockGet.mockResolvedValue({ empty: true, docs: [] });
    mockDoc.mockReturnValue(mockRef);

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      mockRef,
      {
        name: "Public Company",
        type: "place",
        krsNumber: "12345",
        isPublic: true,
      },
      { automatic: true, approve: true, published: true },
    );
  });

  it("should leave a manually set isPublic alone", async () => {
    // KRS cannot see who owns a spółka akcyjna, so a re-ingest that found no
    // public owner must not overturn somebody who knew there was one. The
    // answer is read off the stored document the KRS lookup already returned.
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Public Company",
      is_public: false,
    });
    const existingRef = { id: "existing-id" };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          ref: existingRef,
          data: () => ({
            isPublic: true,
            isPublicSource: "manual",
            published: true,
          }),
        },
      ],
    });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      existingRef,
      {
        name: "Public Company",
        type: "place",
        krsNumber: "12345",
        isPublic: true,
        isPublicSource: "manual",
      },
      expect.objectContaining({ automatic: true }),
    );
  });

  it("stores the categories the pipelines worked out", async () => {
    // The site used to derive these from the PKD codes below. It does not any
    // more - a register code says what a company does rather than what sector
    // it is in - so the answer arrives already decided, from
    // `data/pipelines/src/entities/company_categories.py`.
    mockReadBody.mockResolvedValue({
      krs: "0000076705",
      name: "PKP Szybka Kolej Miejska w Trójmieście",
      activity: ["49.12.Z", "49.31.Z"],
      categories: ["koleje"],
    });
    mockGet.mockResolvedValue({ empty: true, docs: [] });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      expect.anything(),
      {
        name: "PKP Szybka Kolej Miejska w Trójmieście",
        type: "place",
        krsNumber: "0000076705",
        activity: ["49.12.Z", "49.31.Z"],
        categories: ["koleje"],
      },
      expect.objectContaining({ automatic: true }),
    );
  });

  it("stores an empty category set, which is an answer and not a gap", async () => {
    // Instytut Badawczy Dróg i Mostów carries 42.12 among ten construction
    // codes. The pipelines decided it is in no sector, and that has to reach
    // the node - otherwise a company can never lose a category it was given.
    mockReadBody.mockResolvedValue({
      krs: "0000158240",
      name: "Instytut Badawczy Dróg i Mostów",
      activity: ["72.19.Z", "42.12.Z"],
      categories: [],
    });
    const existingRef = { id: "existing-id" };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          ref: existingRef,
          data: () => ({ categories: ["koleje"], published: true }),
        },
      ],
    });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      existingRef,
      expect.objectContaining({ categories: [] }),
      expect.objectContaining({ automatic: true }),
    );
  });

  it("leaves the stored categories alone when the payload states none", async () => {
    // A payload from a pipeline that does not compute categories at all - the
    // person uploader creating a missing employer, say - must not be read as
    // "this company belongs to nothing".
    mockReadBody.mockResolvedValue({
      krs: "0000076705",
      name: "PKP Szybka Kolej Miejska w Trójmieście",
      activity: ["49.12.Z"],
    });
    const existingRef = { id: "existing-id" };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          ref: existingRef,
          data: () => ({ categories: ["koleje"], published: true }),
        },
      ],
    });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      existingRef,
      expect.objectContaining({ categories: ["koleje"] }),
      expect.objectContaining({ automatic: true }),
    );
  });

  it("should leave manually set categories alone", async () => {
    // The same contract `isPublic` has: the pipelines see PKD codes, a reader
    // can see the company. Whoever answered on the page outranks them, and an
    // empty answer is as binding as a full one.
    mockReadBody.mockResolvedValue({
      krs: "0000073875",
      name: "Kopalnia Wapienia Czatkowice",
      activity: ["08.11.Z", "49.20.Z"],
      categories: ["koleje"],
    });
    const existingRef = { id: "existing-id" };
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          ref: existingRef,
          data: () => ({
            categories: [],
            categoriesSource: "manual",
            published: true,
          }),
        },
      ],
    });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      1,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      existingRef,
      {
        name: "Kopalnia Wapienia Czatkowice",
        type: "place",
        krsNumber: "0000073875",
        activity: ["08.11.Z", "49.20.Z"],
        categories: [],
        categoriesSource: "manual",
      },
      expect.objectContaining({ automatic: true }),
    );
  });

  it("should create edges for owned companies", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Parent Company",
      owners: ["67890"],
    });

    // Parent query: Empty (creating new parent)
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const parentRef = { id: "parent-id" };
    mockDoc.mockReturnValueOnce(parentRef);

    // Child query: Found
    const childRef = { id: "child-id" };
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ ref: childRef, data: () => ({}) }],
    });

    // createEdge first checks whether the link already exists.
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const edgeRef = { id: "edge-id" };
    mockDoc.mockReturnValueOnce(edgeRef);

    await handler({} as any);

    // Verify Edge Creation
    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      2,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      edgeRef,
      {
        source: "child-id",
        target: "parent-id",
        type: "owns",
      },
      { automatic: true, approve: true, published: true },
    );
  });

  it("should create edge to region if teryt is provided", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Regional Company",
      teryt: "1061",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const companyRef = { id: "company-id" };
    mockDoc.mockReturnValueOnce(companyRef);

    const regionSnapshot = { exists: true, ref: { id: "teryt1061" } };
    const regionRefMock = {
      id: "teryt1061",
      get: vi.fn().mockResolvedValue(regionSnapshot),
    };

    mockDoc.mockReturnValueOnce(regionRefMock);

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const edgeRef = { id: "edge-region-id" };
    mockDoc.mockReturnValueOnce(edgeRef);
    await handler({} as any);
    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      2,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      edgeRef,
      {
        source: "teryt1061",
        target: "company-id",
        type: "seat",
      },
      { automatic: true, approve: true, published: true },
    );
  });

  it("should throw 404 if owned parent company does not exist", async () => {
    mockReadBody.mockResolvedValue({
      krs: "12345",
      name: "Child Company",
      owners: ["99999"],
    });

    // Mock Child get (will create new)
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "child-id" });

    // Mock Parent get -> returns empty
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 404,
      message: "Company with KRS 99999 not found",
    });
  });

  it("falls back to the powiat when the exact teryt has no node", async () => {
    // A seat TERYT comes from geonames and is six digits, WOJ+POW+GMI with no
    // RODZ, so it matches no node - `Regions` mints gminy with the RODZ on the
    // end. The powiat above it is where the site records a seat anyway.
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Regional Company",
      teryt: "1061999", // > 4 chars
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const companyRef = { id: "company-id" };
    mockDoc.mockReturnValueOnce(companyRef);

    // The exact code first, and nothing has it.
    mockDoc.mockReturnValueOnce({
      id: "teryt1061999",
      get: vi.fn().mockResolvedValue({ exists: false }),
    });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    // Then the powiat, which does.
    const regionSnapshot = { exists: true, ref: { id: "teryt1061" } };
    const regionRefMock = {
      id: "teryt1061",
      get: vi.fn().mockResolvedValue(regionSnapshot),
    };
    mockDoc.mockReturnValueOnce(regionRefMock);

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    const edgeRef = { id: "edge-region-id" };
    mockDoc.mockReturnValueOnce(edgeRef);

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenNthCalledWith(
      2,
      mockDb,
      expect.anything(),
      { uid: "test-user-id" },
      edgeRef,
      {
        source: "teryt1061", // Must have correctly sliced
        target: "company-id",
        type: "seat",
      },
      { automatic: true, approve: true, published: true },
    );
  });

  it("reports an unmappable region instead of failing the whole ingest", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Unknown Region Company",
      teryt: "9999",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });

    // Mock region missing
    const missingRegionSnapshot = { exists: false };
    const regionRefMock = {
      get: vi.fn().mockResolvedValue(missingRegionSnapshot),
    };
    mockDoc.mockReturnValueOnce(regionRefMock);

    // Mock the fallback query missing
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    // The company's other fields are still worth storing, so the ingest
    // succeeds and only the location is reported as unresolved.
    const result = await handler({} as any);
    expect(result).toMatchObject({ code: 200, region: "unknown" });
    // Only the node revision was written - no edge.
    expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
  });
  it("derives the edge id from the link, so a re-run cannot duplicate it", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Regional Company",
      teryt: "1061",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });
    mockDoc.mockReturnValueOnce({
      id: "teryt1061",
      get: vi.fn().mockResolvedValue({ exists: true }),
    });
    // Two lookups: no `seat` edge, and no pre-split `owns` one either.
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "edge-region-id" });

    await handler({} as any);

    expect(mockDoc).toHaveBeenCalledWith("edge_teryt1061_company-id_seat");
  });

  it("links a government shareholder by its own TERYT, not the company's", async () => {
    // The register names the owner and gives no code, so the pipelines resolve
    // the name. Gmina Miasta Gdansk holds 10.7% of PKP SKM, which is seated in
    // Gdynia: the owner edge and the seat edge run from different regions, and
    // before the split there was one type for both.
    mockReadBody.mockResolvedValue({
      krs: "0000076705",
      name: "PKP SKM w Trojmiescie",
      owner_teryts: ["2261011"],
      teryt: "2262",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });
    // the owner region
    mockDoc.mockReturnValueOnce({
      id: "teryt2261011",
      get: vi.fn().mockResolvedValue({ exists: true }),
    });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "edge-owner-id" });
    // the seat region
    mockDoc.mockReturnValueOnce({
      id: "teryt2262",
      get: vi.fn().mockResolvedValue({ exists: true }),
    });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "edge-seat-id" });

    await handler({} as any);

    expect(createRevisionTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { uid: "test-user-id" },
      { id: "edge-owner-id" },
      { source: "teryt2261011", target: "company-id", type: "owns" },
      { automatic: true, approve: true, published: true },
    );
    expect(createRevisionTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { uid: "test-user-id" },
      { id: "edge-seat-id" },
      { source: "teryt2262", target: "company-id", type: "seat" },
      { automatic: true, approve: true, published: true },
    );
  });

  it("reports an owner TERYT with no region node instead of failing", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Gmina-owned Company",
      owner_teryts: ["9999999"],
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });
    mockDoc.mockReturnValueOnce({
      id: "teryt9999999",
      get: vi.fn().mockResolvedValue({ exists: false }),
    });

    const result = await handler({} as any);

    expect(result).toMatchObject({ code: 200 });
    // Node revision only; no edge to a region that does not exist.
    expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
  });

  it("skips a seat already stored as a pre-split owns edge", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Regional Company",
      teryt: "1061",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });
    mockDoc.mockReturnValueOnce({
      id: "teryt1061",
      get: vi.fn().mockResolvedValue({ exists: true }),
    });
    // No `seat` edge yet, but the pair already carries a pre-split `owns` one -
    // which is how all 3,939 seats are stored until
    // `scripts/migrate/split-seat-edges.ts` has run. Writing a `seat` edge
    // beside it would give the company two seats, and the ingest runs nightly,
    // so it would win the race against the migration.
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: "legacy",
          data: () => ({
            source: "teryt1061",
            target: "company-id",
            type: "owns",
          }),
        },
      ],
    });

    const result = await handler({} as any);

    expect(result).toMatchObject({ region: "existing" });
    // Node revision only; no second edge.
    expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
  });

  it("skips the edge even when the stored one carries stray fields", async () => {
    mockReadBody.mockResolvedValue({
      krs: "123456",
      name: "Regional Company",
      teryt: "1061",
    });

    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockDoc.mockReturnValueOnce({ id: "company-id" });
    mockDoc.mockReturnValueOnce({
      id: "teryt1061",
      get: vi.fn().mockResolvedValue({ exists: true }),
    });
    // A seat is a state edge: the region either seats the company or it does
    // not, so a date somebody once put on the link does not make a second one.
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: "dated",
          data: () => ({
            source: "teryt1061",
            target: "company-id",
            type: "owns",
            start_date: "2020-01-01",
          }),
        },
      ],
    });

    const result = await handler({} as any);

    expect(result).toMatchObject({ region: "existing" });
    // Node revision only; no second link.
    expect(createRevisionTransaction).toHaveBeenCalledTimes(1);
  });
});
