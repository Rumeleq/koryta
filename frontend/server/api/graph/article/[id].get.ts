import { getFirestore } from "firebase-admin/firestore";
import { getApp } from "firebase-admin/app";
import type { GraphLayout } from "~~/shared/graph/util";
import {
  editorFreshCachedEventHandler,
  wantsLatest,
} from "~~/server/utils/handlers";
import { graphForArticles } from "~~/server/utils/articleGraph";
import type { H3Event } from "h3";

/** The people one article puts on the record.
 *
 * A topic graph with a single article in it. The page used to draw the local
 * neighbourhood of whichever person happened to come first instead, which
 * answered a different question - it showed that person's employers rather than
 * the article's people, and everybody else the article named was drawn only if
 * they happened to fall within a hop of them. Somebody recorded as mentioned
 * had no reliable way of appearing at all.
 */
async function articleGraph(event: H3Event): Promise<GraphLayout> {
  const articleId = getRouterParam(event, "id");
  if (!articleId) {
    throw createError({ statusCode: 400, message: "Brak identyfikatora." });
  }
  const includeDrafts = wantsLatest(event);

  const db = getFirestore(getApp(), "koryta-pl");
  return graphForArticles(db, [articleId], includeDrafts);
}

// Whoever is signed in is the one who may have just recorded the mention they
// are looking for, so they read through the six hour cache. See the helper.
export default editorFreshCachedEventHandler(articleGraph);
