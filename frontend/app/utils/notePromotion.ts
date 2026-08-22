import type { NoteSource } from "~~/shared/model";
import { noteKindOf } from "~/composables/notes";

/** The entries of a note that should become articles.
 *
 * A source entry is somebody saying "this is worth reading", which is what an
 * article node is for - so it is promoted, and only it: a correction or a gap
 * report may cite a url, but it cites it as evidence for a change, and filing
 * those as sources would fill the article list with pages nobody called
 * sources. An entry already promoted carries the node it became and is left
 * alone, which is what keeps a note that is saved twice from asking again.
 */
export function sourcesToPromote(sources: NoteSource[]): NoteSource[] {
  return sources.filter(
    (source) =>
      noteKindOf(source) === "source" &&
      !!source.url?.trim() &&
      !source.articleNodeId,
  );
}

/** The same entries, each pointed at the article node its url became.
 *
 * Returns null where nothing changed, so a save that promoted nothing does not
 * write the note again. Entries are matched by url rather than by position: the
 * promotion runs after the note is stored, and the author may have added
 * another entry in the meantime.
 */
export function withArticleIds(
  sources: NoteSource[],
  articleIds: Map<string, string>,
): NoteSource[] | null {
  const updated = sources.map((source) => {
    const url = source.url?.trim();
    const articleNodeId = url ? articleIds.get(url) : undefined;
    if (!articleNodeId || source.articleNodeId === articleNodeId) return source;
    return { ...source, articleNodeId };
  });

  // An entry nothing was attached to is handed back as the very same object.
  const changed = updated.some((source, index) => source !== sources[index]);
  return changed ? updated : null;
}

/** Turn every source url a note carries into an article node.
 *
 * `articleIdFor` is what does the storing - injected so that the rule of which
 * entries are promoted can be tested without the network. A url that fails is
 * skipped rather than retried here: the entry keeps no node id, so the next
 * save of the note tries it again.
 *
 * Gives back the note's entries with the new ids attached, or null where there
 * was nothing to promote or nothing came back.
 */
export async function promoteNoteSources(
  sources: NoteSource[],
  articleIdFor: (url: string) => Promise<string | undefined>,
): Promise<NoteSource[] | null> {
  const pending = sourcesToPromote(sources);
  if (pending.length === 0) return null;

  const urls = Array.from(new Set(pending.map((source) => source.url!.trim())));
  const articleIds = new Map<string, string>();

  await Promise.all(
    urls.map(async (url) => {
      try {
        const nodeId = await articleIdFor(url);
        if (nodeId) articleIds.set(url, nodeId);
      } catch (error) {
        console.error(`Failed to promote ${url} to an article`, error);
      }
    }),
  );

  return withArticleIds(sources, articleIds);
}
