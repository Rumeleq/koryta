import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import { requireAdmin } from "~~/server/utils/auth";
import { recordAudit } from "~~/server/utils/audit";
import { cascadeUnpublishEdges } from "~~/server/utils/edgePublication";
import { z } from "zod";

const bodyValidator = z.object({
  node_id: z.string(),
  published: z.boolean(),
});

/** Toggles the public visibility of a node. Publication is independent of
 * revision approval: a node needs an approved revision (`revision_id`) before
 * it can go live, but approving a newer revision never publishes a hidden
 * node on its own. */
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, (body) =>
    bodyValidator.parse(body),
  );

  const user = await requireAdmin(event);

  const db = getFirestore(getApp(), "koryta-pl");
  const nodeRef = db.collection("nodes").doc(body.node_id);
  const nodeDoc = await nodeRef.get();
  if (!nodeDoc.exists) {
    throw createError({
      statusCode: 404,
      message: `Node not found for id=${body.node_id}`,
    });
  }

  if (body.published && !nodeDoc.data()?.revision_id) {
    throw createError({
      statusCode: 400,
      message:
        "Nie można opublikować strony bez zatwierdzonej rewizji (revision_id).",
    });
  }

  // Hiding the page hides the relations that lean on it, and in that order: no
  // edge may be published unless both its ends are, so taking the edges down
  // first means the invariant holds at every point in between. Nothing a
  // reader sees changes either way - the graph already drops an edge whose
  // node was filtered out - but the flag would otherwise outlive the page, and
  // republishing it later would bring back relations nobody looked at again.
  const hiddenEdges = body.published
    ? []
    : await cascadeUnpublishEdges(db, body.node_id, user);

  // The node keeps only the answer, so without this nothing said who gave it
  // or when - the one decision that settles what the public sees was the one
  // decision leaving no trace.
  const batch = db.batch();
  batch.update(nodeRef, { published: body.published });
  recordAudit(
    db,
    {
      action: body.published ? "publish" : "unpublish",
      collection: "nodes",
      target_id: body.node_id,
      user: user.uid,
    },
    batch,
  );
  await batch.commit();

  // Every cached page that counts this node - the explore endpoints, the stats
  // ones - answers from before it was visible until its own maxAge runs out.
  // /api/edges/publish and /api/revisions/approve have always done this; this
  // endpoint never did, so publishing a page with no relations ticked left the
  // whole site six hours behind with nothing to nudge it. Only reaches this
  // container's copy: anything Cloud CDN is holding is governed by the
  // `s-maxage` the cached handler sent, which is why the endpoints a reviewer
  // needs fresh are `editorFresh` as well.
  await useStorage("cache").clear("nitro:handlers");

  return {
    id: body.node_id,
    published: body.published,
    /** The relations hidden along with it, so the admin page can say so. */
    hiddenEdges,
  };
});
