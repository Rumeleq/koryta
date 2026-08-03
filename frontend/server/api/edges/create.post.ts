import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { getUser } from "~~/server/utils/auth";
import { createRevisionTransaction } from "~~/server/utils/revisions";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.type || !body.source || !body.target) {
    throw createError({
      statusCode: 400,
      message: "Missing required fields",
    });
  }

  const user = await getUser(event);

  const db = getFirestore(getApp(), "koryta-pl");

  const edgeRef = db.collection("edges").doc();

  const revisionData = {
    source: body.source,
    target: body.target,
    type: body.type,
    name: body.name || "",
    content: body.content || body.text || "",
    start_date: body.start_date || null,
    end_date: body.end_date || null,
    references: body.references || [],
    party: body.party || "",
    committee: body.committee || "",
    position: body.position || "",
    elected: !!body.elected,
    term: body.term || "",
    by_election: !!body.by_election,
    update_automatic: body.update_automatic || undefined,
  };

  const batch = db.batch();
  // `published: false` said out loud rather than left off. Both readings hide
  // the relation - `pageIsPublic` wants the flag to be `true` - but Firestore
  // matches no filter against a field a document does not have, so an edge
  // written without it is invisible to `where("published", "==", false)` and
  // would never reach the queue in /admin/krawedzie that is supposed to find
  // it. Same reasoning as /api/revisions/create for a brand new node.
  createRevisionTransaction(
    db,
    batch,
    user,
    edgeRef,
    revisionData,
    false,
    false,
    false,
  );

  await batch.commit();

  return { id: edgeRef.id };
});
