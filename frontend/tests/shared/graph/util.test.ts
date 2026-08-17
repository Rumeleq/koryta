import { describe, it, expect } from "vitest";
import { getNodeGroups, getEdges, getNodesNoStats } from "~~/shared/graph/util";
import type { Person, Company, Region, Edge as DBEdge } from "~~/shared/model";

describe("graph utils", () => {
  describe("getNodeGroups", () => {
    it("should include candidate in region but not candidate's outside connections via election edge", () => {
      // Mock data
      const people: Record<string, Person> = {
        p1: {
          name: "Candidate",
          parties: [] as string[],
          type: "person",
        } as Person,
        p2: {
          name: "Candidate Friend",
          parties: [] as string[],
          type: "person",
        } as Person,
      };
      const companies: Record<string, Company> = {};
      const regions: Record<string, Region> = {
        r1: { name: "Region", type: "region" } as Region,
      };

      const partyColors = {};
      const nodesNoStats = getNodesNoStats(
        people,
        companies,
        regions,
        partyColors,
      );

      // Candidate ran in Region
      const edgeElection: DBEdge = {
        id: "e1",
        source: "p1",
        target: "r1",
        type: "election",
        content: "",
        name: "test",
        visibility: "public",
        references: [],
      };

      // Candidate knows Candidate Friend
      const edgeConnection: DBEdge = {
        id: "e2",
        source: "p1",
        target: "p2",
        type: "connection",
        content: "",
        name: "zna",
        visibility: "public",
        references: [],
      };

      const edges = getEdges([edgeElection, edgeConnection]);

      const groups = getNodeGroups(
        nodesNoStats,
        edges,
        people,
        companies,
        regions,
      );

      const regionGroup = groups.find((g) => g.id === "r1");
      expect(regionGroup).toBeDefined();

      // The region group should include the Region and Candidate
      expect(regionGroup?.connected).toContain("r1");
      expect(regionGroup?.connected).toContain("p1");

      // The region group should NOT include the Candidate's Friend!
      // This verifies that `backward: "dead_end"` correctly stopped the traversal at the Candidate
      expect(regionGroup?.connected).not.toContain("p2");
    });
  });

  describe("getNodesNoStats", () => {
    it("should preserve original DB type via entityType and overwrite Graph type for visual rendering", () => {
      const people: Record<string, Person> = {
        p1: { name: "Person A", type: "person" } as Person,
      };
      const companies: Record<string, Company> = {
        c1: { name: "Company B", type: "place" } as Company,
      };
      const regions: Record<string, Region> = {
        r1: { name: "Region C", type: "region" } as Region,
      };

      const nodesNoStats = getNodesNoStats(people, companies, regions, {});

      // Verify the person node
      expect(nodesNoStats["p1"]).toBeDefined();
      expect(nodesNoStats["p1"].type).toBe("circle");
      expect((nodesNoStats["p1"] as any).entityType).toBe("person");

      // Verify the company/place node
      expect(nodesNoStats["c1"]).toBeDefined();
      expect(nodesNoStats["c1"].type).toBe("rect");
      expect((nodesNoStats["c1"] as any).entityType).toBe("place");

      // Verify the region node
      expect(nodesNoStats["r1"]).toBeDefined();
      expect(nodesNoStats["r1"].type).toBe("document");
      expect((nodesNoStats["r1"] as any).entityType).toBe("region");
    });

    it("draws no node for a topic, so a tagged edge cannot reach the canvas", () => {
      // `getLocalGraph` keeps only the edges whose *both* ends are in here, so
      // this absence is what stops `tagged` edges - article to topic, neither
      // of them a graph node - from ever being drawn. The `dead_end` policy
      // below is the second line of defence, for whoever later decides a topic
      // should be visible.
      const nodesNoStats = getNodesNoStats(
        { p1: { name: "Person A", type: "person" } as Person },
        {},
        {},
        {},
      );

      expect(Object.keys(nodesNoStats)).toEqual(["p1"]);
    });
  });

  describe("tagged edges", () => {
    const taggedEdge: DBEdge = {
      id: "t1",
      source: "a1",
      target: "topic1",
      type: "tagged",
    } as DBEdge;

    it("is a dead end in both directions", () => {
      const [edge] = getEdges([taggedEdge]);

      // Not a stylistic choice. A topic is joined to every article in its
      // story, so a traversable `tagged` edge makes the topic a hub two hops
      // wide and every person mentioned anywhere in an affair reads as
      // connected to every other one.
      expect(edge!.traverse).toEqual({
        forward: "dead_end",
        backward: "dead_end",
      });
    });

    it("does not connect two people who share a topic", () => {
      // The arrangement the policy exists to prevent: two unrelated people,
      // each mentioned by an article, both articles under one topic.
      const people: Record<string, Person> = {
        p1: { name: "Person A", type: "person" } as Person,
        p2: { name: "Person B", type: "person" } as Person,
      };
      const nodesNoStats = {
        ...getNodesNoStats(people, {}, {}, {}),
        a1: { name: "Article 1", type: "document", color: "" } as never,
        a2: { name: "Article 2", type: "document", color: "" } as never,
        topic1: {
          name: "Powodzianie KRR",
          type: "document",
          color: "",
        } as never,
      };

      const edges = getEdges([
        { id: "m1", source: "a1", target: "p1", type: "mentions" } as DBEdge,
        { id: "m2", source: "a2", target: "p2", type: "mentions" } as DBEdge,
        { id: "t1", source: "a1", target: "topic1", type: "tagged" } as DBEdge,
        { id: "t2", source: "a2", target: "topic1", type: "tagged" } as DBEdge,
      ]);

      const groups = getNodeGroups(nodesNoStats, edges, people, {}, {});
      const forPerson1 = groups.find((group) => group.id === "p1");

      expect(forPerson1?.connected).not.toContain("p2");
    });
  });
});
