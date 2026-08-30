import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { nodeTypes, pageIsPublic } from "~~/shared/model";
import { authCachedEventHandler } from "~~/server/utils/handlers";
import { resolveMergedNode } from "~~/server/utils/merge";
import { z } from "zod";
import type { Node } from "~~/shared/model";

const queryValidator = z.object({
  latest: z.string().optional(),
});

const responseValidator = z.object({
  name: z.string(),
  type: z.enum(nodeTypes),
  // TODO revision elements are either string or complex object
  revision_id: z.union([z.string(), z.object({ path: z.string() })]).optional(),
  published: z.boolean().optional(),
});

export default authCachedEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, message: "Missing type or id" });
  }
  const query = await getValidatedQuery(event, (query) =>
    queryValidator.parse(query),
  );

  const db = getFirestore(getApp(), "koryta-pl");
  const node = await (query.latest == "true"
    ? getLatestRevision(db, id)
    : getEntity(db, id));

  if (!node) {
    throw createError({
      statusCode: 404,
      message: `Node not found for id=${id} and latest=${query.latest}`,
    });
  }
  // TODO how to check the response has a correct shape
  const response: Node = responseValidator.parse(node);
  if (!pageIsPublic(response) && !query.latest) {
    throw createError({
      statusCode: 404,
      message: `Page ${id} is not approved`,
    });
  }

  return { node };
});

async function getLatestRevision(db: FirebaseFirestore.Firestore, id: string) {
  const revisionDoc = (
    await db
      .collection("revisions")
      .where("node_id", "==", id)
      .orderBy("update_time", "desc")
      .limit(1)
      .get()
  ).docs[0];
  // TODO get rid of this, each node should have a revision
  if (!revisionDoc) {
    return await getEntity(db, id);
  }
  return { id, ...revisionDoc.data().data };
}

/** The page, or the page it was merged into.
 *
 * A duplicate keeps its document so its url still resolves, but it is
 * `deleted`, so answering with it would 404 every link anybody ever made to it
 * - which is the opposite of why it was kept. Answering with the survivor
 * instead costs nothing here and does the redirect for free: `[seoType]/[slug]`
 * already compares the url it was asked for against `generateNodeUrl` of what
 * this returns, and sends the reader to the difference.
 */
async function getEntity(db: FirebaseFirestore.Firestore, id: string) {
  const { snapshot: nodeDoc } = await resolveMergedNode(db, id);
  if (!nodeDoc?.exists) {
    return undefined;
  }
  const result = {
    id: nodeDoc.id,
    ...nodeDoc.data(),
  } as Node;
  if (result.revision_id) {
    if (typeof result.revision_id === "object") {
      result.revision_id = (result.revision_id as { path: string }).path;
    }
  }
  return result;
}
