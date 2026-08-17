import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { z } from "zod";
import { getUser } from "~~/server/utils/auth";
import {
  createRevisionTransaction,
  withoutInternalFields,
} from "~~/server/utils/revisions";
import { pageIsPublic } from "~~/shared/model";

const bodyValidator = z.object({
  add: z.array(z.string().min(1)).optional(),
  remove: z.array(z.string().min(1)).optional(),
});

/** Puts an article into a story, or takes it out.
 *
 * Both directions are `tagged` edges: adding writes one as a draft, removing
 * marks the existing one `deleted`. Scoped to tagging rather than exposed as a
 * general "delete this edge", because it needs no more than a signed in reader
 * and a general one at that price would let anybody take an employment claim
 * off the site. Removing any other kind of relation stays with the admin flow.
 *
 * Additive, like `/api/edges/[id]/references`: the caller names what changed
 * rather than sending the list it rendered, so two people tagging the same
 * article do not overwrite each other.
 */
export default defineEventHandler(async (event) => {
  const articleId = getRouterParam(event, "id");
  if (!articleId) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }

  const body = bodyValidator.parse(await readBody(event));
  const add = Array.from(new Set(body.add ?? []));
  const remove = new Set(body.remove ?? []);
  if (add.length === 0 && remove.size === 0) {
    throw createError({
      statusCode: 400,
      message: "Nie podano tematów do dodania ani usunięcia.",
    });
  }

  const user = await getUser(event);
  const db = getFirestore(getApp(), "koryta-pl");

  const articleSnap = await db.collection("nodes").doc(articleId).get();
  if (!articleSnap.exists || articleSnap.data()?.type !== "article") {
    throw createError({
      statusCode: 404,
      message: "Nie ma takiego artykułu.",
    });
  }

  const topicSnaps = add.length
    ? await db.getAll(...add.map((id) => db.collection("nodes").doc(id)))
    : [];
  for (const snap of topicSnaps) {
    if (!snap.exists || snap.data()?.type !== "topic") {
      throw createError({
        statusCode: 422,
        message: `${snap.id} nie jest tematem w bazie.`,
      });
    }
  }

  // Every tag this article already carries, so that adding one twice is a no-op
  // rather than a second edge saying the same thing.
  const existingSnap = await db
    .collection("edges")
    .where("source", "==", articleId)
    .where("type", "==", "tagged")
    .get();
  const existing = new Map(
    existingSnap.docs
      .filter((doc) => doc.data().deleted !== true)
      .map((doc) => [doc.data().target as string, doc]),
  );

  const batch = db.batch();

  for (const topicId of add) {
    if (existing.has(topicId)) continue;
    const edgeRef = db.collection("edges").doc();
    createRevisionTransaction(
      db,
      batch,
      user,
      edgeRef,
      // No `references`: which story an article belongs to is an editorial
      // call, not a claim that rests on a source.
      { source: articleId, target: topicId, type: "tagged" },
      // Live for whoever is signed in, hidden from the public until a reviewer
      // approves it - the same terms as every other relation somebody proposes.
      { published: false },
    );
  }

  for (const topicId of remove) {
    const doc = existing.get(topicId);
    if (!doc) continue;
    // `deleted` is a field the document owns, so `createRevisionTransaction`
    // layers whatever `stored` says for it back over the revision. An edge
    // written by the old client helper carries `deleted: false` outright, and
    // carrying that across would undo this removal on the way out. Withholding
    // the key is what lets the revision be the one to state it.
    const { deleted: _wasDeleted, ...stored } = doc.data();
    createRevisionTransaction(
      db,
      batch,
      user,
      doc.ref,
      { ...withoutInternalFields(doc.data()), deleted: true },
      { stored, published: false },
    );
  }

  await batch.commit();

  const after = await db
    .collection("edges")
    .where("source", "==", articleId)
    .where("type", "==", "tagged")
    .get();

  return {
    topics: after.docs
      .filter((doc) => doc.data().deleted !== true)
      .map((doc) => ({
        edgeId: doc.id,
        nodeId: doc.data().target as string,
        published: pageIsPublic(doc.data()),
      })),
  };
});
