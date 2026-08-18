import { changeArticleEdges } from "~~/server/utils/articleEdges";

/** Puts an article into a story, or takes it out.
 *
 * Both directions are `tagged` edges, written and removed by the shared helper
 * - `mentions` is the same operation on a different kind of far end.
 */
export default defineEventHandler(async (event) => {
  const topics = await changeArticleEdges(event, {
    type: "tagged",
    targetTypes: ["topic"],
    nothingNamed: "Nie podano tematów do dodania ani usunięcia.",
    wrongTarget: (id) => `${id} nie jest tematem w bazie.`,
  });
  return { topics };
});
