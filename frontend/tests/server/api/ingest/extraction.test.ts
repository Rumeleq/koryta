import { describe, it, expect, vi, beforeEach } from "vitest";
import handler from "../../../../server/api/ingest/extraction.post";

const {
  mockReadBody,
  mockBatchSet,
  mockCommit,
  mockCollection,
  mockGetAll,
  nodesQuery,
  personNodes,
} = vi.hoisted(() => {
  const mockReadBody = vi.fn();
  globalThis.createError = (err: any) => err;
  globalThis.defineEventHandler = (fn: any) => fn;
  globalThis.readValidatedBody = async (_event: any, parse: any) =>
    parse(await mockReadBody());

  const mockBatchSet = vi.fn();
  const mockCommit = vi.fn().mockResolvedValue(undefined);

  // Article-node lookup: no existing nodes match.
  const nodesQuery: any = {
    where: vi.fn(() => nodesQuery),
    select: vi.fn(() => nodesQuery),
    get: vi.fn().mockResolvedValue({ docs: [] }),
  };
  // The graph the `koryta_ids` resolve against, keyed by node id; a test adds
  // whichever people its payload claims.
  const personNodes = new Map<string, Record<string, unknown>>();
  const mockCollection = vi.fn((name: string) => ({
    where: nodesQuery.where,
    doc: vi.fn((id?: string) => ({
      id: name === "nodes" ? id : "new-extraction-id",
    })),
  }));
  // getAll takes refs then an options object, and answers from `personNodes`.
  const mockGetAll = vi.fn(async (...args: any[]) => {
    const refs = args.filter((arg) => typeof arg?.id === "string");
    return refs.map((ref: any) => ({
      id: ref.id,
      data: () => personNodes.get(ref.id),
    }));
  });

  return {
    mockReadBody,
    mockBatchSet,
    mockCommit,
    mockCollection,
    mockGetAll,
    nodesQuery,
    personNodes,
  };
});

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: mockCollection,
    getAll: mockGetAll,
    batch: () => ({ set: mockBatchSet, commit: mockCommit }),
  }),
  Timestamp: { now: () => "TS" },
}));
vi.mock("firebase-admin/app", () => ({ getApp: () => ({}) }));
// `requireDatascience` is left real; only the token lookup is faked.
vi.mock("../../../../server/utils/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/utils/auth")>()),
  getUser: vi
    .fn()
    .mockResolvedValue({ uid: "test-user-id", datascience: true }),
}));

describe("api/ingest/extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nodesQuery.get.mockResolvedValue({ docs: [] });
    personNodes.clear();
  });

  it("seeds stats.votes so unvoted facts stay queryable", async () => {
    mockReadBody.mockResolvedValue({
      articles: [
        {
          url: "https://example.com/a",
          domain: "example.com",
          title: null,
          publication_date: null,
          tag: "v1",
          extracted_facts: [
            {
              url: "https://example.com/a",
              justification: "bo tak",
              fact_type: "employment",
              person: "Jan Kowalski",
              organization: "Orlen",
            },
          ],
        },
      ],
    });

    const result = await handler({} as any);

    expect(result).toEqual({ status: "ok", count: 1 });
    // Firestore cannot query for an absent field, so an unreviewed fact has to
    // carry humanVoted: false to be findable by the review flow.
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stats: { votes: { humanVoted: false } } }),
    );
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it("links a fact to its article node across url spellings", async () => {
    // The pipeline sends no scheme; the crawler stored https and a www. Exact
    // string matching found nothing, which is why no extraction in production
    // carries an articleNodeId.
    nodesQuery.get.mockResolvedValueOnce({
      docs: [
        {
          id: "article-node",
          data: () => ({ sourceURL: "https://www.example.com/a/" }),
        },
      ],
    });
    mockReadBody.mockResolvedValue({
      articles: [
        {
          url: "example.com/a",
          domain: "example.com",
          title: null,
          publication_date: null,
          tag: "v1",
          extracted_facts: [
            {
              url: "example.com/a",
              justification: "bo tak",
              fact_type: "employment",
              person: "Jan Kowalski",
              organization: "Orlen",
            },
          ],
        },
      ],
    });

    await handler({} as any);

    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ articleNodeId: "article-node" }),
    );
  });

  it("writes the affair_involvement fields", async () => {
    mockReadBody.mockResolvedValue({
      articles: [
        {
          url: "https://example.com/a",
          domain: "example.com",
          title: null,
          publication_date: null,
          tag: "v1",
          extracted_facts: [
            {
              url: "https://example.com/a",
              justification: "kierował zorganizowaną grupą",
              fact_type: "affair_involvement",
              person: "Zbigniew Ziobro",
              role: "kierujący zorganizowaną grupą przestępczą",
              affair: "Fundusz Sprawiedliwości",
            },
          ],
        },
      ],
    });

    const result = await handler({} as any);

    expect(result).toEqual({ status: "ok", count: 1 });
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fact_type: "affair_involvement",
        person: "Zbigniew Ziobro",
        role: "kierujący zorganizowaną grupą przestępczą",
        affair: "Fundusz Sprawiedliwości",
      }),
    );
  });

  it("credits the capture's uploader rather than the calling service", async () => {
    // The capture extractor holds its own datascience account and submits on
    // behalf of whoever captured the page; without this every fact found that
    // way would be attributed to the service.
    mockReadBody.mockResolvedValue({
      uploaderUid: "reader-who-captured-it",
      articles: [
        {
          url: "https://example.com/a",
          domain: "example.com",
          title: null,
          publication_date: null,
          tag: "capture_v1",
          extracted_facts: [
            {
              url: "https://example.com/a",
              justification: "bo tak",
              fact_type: "employment",
              person: "Jan Kowalski",
              organization: "Orlen",
            },
          ],
        },
      ],
    });

    await handler({} as any);

    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ uploaderUid: "reader-who-captured-it" }),
    );
  });

  describe("koryta_ids", () => {
    // The mention matcher confirms people per article, but an article usually
    // carries facts about several of them - so which fact belongs to which
    // person is settled here, by name.
    it("links each fact to the confirmed person its subject names", async () => {
      personNodes.set("gajda-id", { name: "Piotr Gajda", type: "person" });
      personNodes.set("kozlowski-id", {
        name: "Krzysztof Kozłowski",
        type: "person",
      });
      mockReadBody.mockResolvedValue({
        articles: [
          {
            url: "sulejow.naszemiasto.pl/a",
            domain: "naszemiasto.pl",
            title: null,
            publication_date: null,
            tag: "v26",
            koryta_ids: ["gajda-id", "kozlowski-id"],
            extracted_facts: [
              {
                url: "sulejow.naszemiasto.pl/a",
                justification: "radny PiS Piotr Gajda",
                fact_type: "party_membership",
                person: "Piotr Gajda",
                party: "Prawo i Sprawiedliwość",
              },
              {
                url: "sulejow.naszemiasto.pl/a",
                justification: "Radny Krzysztof Kozlowski",
                fact_type: "employment",
                // Spelled without diacritics, as the article had it.
                person: "Krzysztof Kozlowski",
                organization: "Rada Miasta",
              },
            ],
          },
        ],
      });

      await handler({} as any);

      expect(mockBatchSet).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({
          personNodeId: "gajda-id",
          personNodeName: "Piotr Gajda",
        }),
      );
      // The node's own spelling is stored, not the article's, because it is
      // what the person's url slug is built from.
      expect(mockBatchSet).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({
          personNodeId: "kozlowski-id",
          personNodeName: "Krzysztof Kozłowski",
        }),
      );
    });

    it("leaves a fact about somebody else unmatched", async () => {
      // Seen in the sample batch: the article confirms Jerzy Barzowski, but
      // every fact extracted from it is about Leszek Szymczak. Attaching the
      // one confirmed person to it would be exactly the wrong match the flag
      // on the card exists to report.
      personNodes.set("barzowski-id", {
        name: "Jerzy Barzowski",
        type: "person",
      });
      mockReadBody.mockResolvedValue({
        articles: [
          {
            url: "miastko.naszemiasto.pl/a",
            domain: "naszemiasto.pl",
            title: null,
            publication_date: null,
            tag: "v26",
            koryta_ids: ["barzowski-id"],
            extracted_facts: [
              {
                url: "miastko.naszemiasto.pl/a",
                justification: "Leszek Szymczak z Bytowa",
                fact_type: "party_membership",
                person: "Leszek Szymczak",
                party: "Prawo i Sprawiedliwość",
              },
            ],
          },
        ],
      });

      await handler({} as any);

      const [, doc] = mockBatchSet.mock.calls[0]!;
      expect(doc).not.toHaveProperty("personNodeId");
      expect(doc).not.toHaveProperty("personNodeName");
    });

    it("matches a personal_relation on its subject", async () => {
      personNodes.set("wnukowski-id", {
        name: "Paweł Wnukowski",
        type: "person",
      });
      mockReadBody.mockResolvedValue({
        articles: [
          {
            url: "podlaskie24.pl/a",
            domain: "podlaskie24.pl",
            title: null,
            publication_date: null,
            tag: "v26",
            koryta_ids: ["wnukowski-id"],
            extracted_facts: [
              {
                url: "podlaskie24.pl/a",
                justification: "moja babcia Kazimiera Wnukowska",
                fact_type: "personal_relation",
                subject: "Paweł Wnukowski",
                object: "Kazimiera Wnukowska",
                relation: "wnuk",
              },
            ],
          },
        ],
      });

      await handler({} as any);

      expect(mockBatchSet).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ personNodeId: "wnukowski-id" }),
      );
    });

    it("asserts nothing when two confirmed people share a name", async () => {
      // A namesake is the case the match gets wrong most often, so one we
      // already know is ambiguous is left alone rather than picked between.
      personNodes.set("kowalski-a", { name: "Jan Kowalski", type: "person" });
      personNodes.set("kowalski-b", { name: "Jan Kowalski", type: "person" });
      mockReadBody.mockResolvedValue({
        articles: [
          {
            url: "example.com/a",
            domain: "example.com",
            title: null,
            publication_date: null,
            tag: "v26",
            koryta_ids: ["kowalski-a", "kowalski-b"],
            extracted_facts: [
              {
                url: "example.com/a",
                justification: "bo tak",
                fact_type: "employment",
                person: "Jan Kowalski",
                organization: "Orlen",
              },
            ],
          },
        ],
      });

      await handler({} as any);

      expect(mockBatchSet.mock.calls[0]![1]).not.toHaveProperty("personNodeId");
    });

    it("ignores an id that is not a person", async () => {
      personNodes.set("orlen-id", { name: "Jan Kowalski", type: "place" });
      mockReadBody.mockResolvedValue({
        articles: [
          {
            url: "example.com/a",
            domain: "example.com",
            title: null,
            publication_date: null,
            tag: "v26",
            koryta_ids: ["orlen-id", "missing-id"],
            extracted_facts: [
              {
                url: "example.com/a",
                justification: "bo tak",
                fact_type: "employment",
                person: "Jan Kowalski",
                organization: "Orlen",
              },
            ],
          },
        ],
      });

      await handler({} as any);

      expect(mockBatchSet.mock.calls[0]![1]).not.toHaveProperty("personNodeId");
    });

    it("reads each confirmed person once for the whole batch", async () => {
      personNodes.set("holownia-id", {
        name: "Szymon Hołownia",
        type: "person",
      });
      const article = (url: string) => ({
        url,
        domain: "wpolityce.pl",
        title: null,
        publication_date: null,
        tag: "v26",
        koryta_ids: ["holownia-id"],
        extracted_facts: [
          {
            url,
            justification: "lider Polski 2050 Szymon Hołownia",
            fact_type: "employment" as const,
            person: "Szymon Hołownia",
            organization: "Polska 2050",
          },
        ],
      });
      mockReadBody.mockResolvedValue({
        articles: [article("wpolityce.pl/a"), article("wpolityce.pl/b")],
      });

      await handler({} as any);

      // One getAll for the batch, holding the one distinct id.
      expect(mockGetAll).toHaveBeenCalledTimes(1);
      expect(mockGetAll.mock.calls[0]!.filter((a: any) => a?.id)).toHaveLength(
        1,
      );
      expect(mockBatchSet).toHaveBeenCalledTimes(2);
    });

    it("does not look anybody up when no article carries ids", async () => {
      // The one-shot capture path analyses a page before mention matching has
      // run, so its payloads have no koryta_ids at all.
      mockReadBody.mockResolvedValue({
        articles: [
          {
            url: "example.com/a",
            domain: "example.com",
            title: null,
            publication_date: null,
            tag: "capture_v1",
            extracted_facts: [
              {
                url: "example.com/a",
                justification: "bo tak",
                fact_type: "employment",
                person: "Jan Kowalski",
                organization: "Orlen",
              },
            ],
          },
        ],
      });

      await handler({} as any);

      expect(mockGetAll).not.toHaveBeenCalled();
      expect(mockBatchSet.mock.calls[0]![1]).not.toHaveProperty("personNodeId");
    });
  });
});
