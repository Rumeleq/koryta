import { z } from "zod";
import { parseNodeDoc } from "~~/server/utils/fetch";
import { getFirestore } from "firebase-admin/firestore";
import { editorFreshCachedEventHandler } from "~~/server/utils/handlers";
import { getValidatedQuery } from "h3";

const queryValidator = z.object({
  q: z.string().optional().default(""),
  limit: z.coerce.number().optional().default(20),
});

type node = {
  id: string;
  name: string;
  type: string;
  teryt?: string;
  visibility: boolean;
};

// Whoever is signed in is the one who may have just created the person they
// are searching for, and the picker searches before it offers to create - so
// the miss is already in the cache by the time they look again.
export default editorFreshCachedEventHandler(async (event) => {
  const query = await getValidatedQuery(event, (q) => queryValidator.parse(q));
  const db = getFirestore("koryta-pl");

  const firebaseQuery: FirebaseFirestore.Query = db
    .collection("nodes")
    .where("type", "in", ["person", "place", "region"])
    // It's set by the function / computeNodes
    .where("nameChunksLower", "array-contains", query.q.toLowerCase())
    .orderBy("stats.nodeGroupSize", "desc")
    .limit(query.limit);

  const nodes = await firebaseQuery.get();
  const results = nodes.docs.map(parseNodeDoc<node>);

  return results.map((node) => {
    // The query that opens the table on this hit. A place is named by its node
    // id rather than by its KRS number, so that a ministry or an urząd - which
    // has none - opens filtered rather than on the whole table.
    const query: Record<string, string> = {};
    if (node.type === "place") query.place = node.id;
    if (node.teryt) query.teryt = node.teryt;

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      ...(Object.keys(query).length > 0 ? { query } : {}),
    };
  });
});
