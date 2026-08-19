/** The part of a region node this reads, typed to what Firestore really holds
 * rather than to `Region`: `stats` is written by the recompute job, so a region
 * it has not reached yet carries it partly or not at all.
 */
type RegionWithTargets = {
  name: string;
  teryt?: string;
  stats?: {
    edges?: {
      all?: { targetNodeIds?: string[] };
      approved?: { targetNodeIds?: string[] };
    };
  };
};

/** Region name for every company the loaded regions claim, keyed by place id.
 *
 * A company's seat is an `owns` edge from the region to the company, which the
 * stats job folds into the *region's* target node ids. The lookup runs in that
 * direction because company nodes almost never carry stats of their own - 66 of
 * 3706 in production - so reading `place.stats` left the location blank for all
 * but a handful of them.
 *
 * The region hierarchy uses the same edge type, so a region's targets also list
 * its child regions; those keys are simply never looked up. Should two regions
 * ever claim one company, the more specific one wins - a powiat over the
 * województwo around it.
 */
export function regionNamesByPlaceId(
  regions: Record<string, RegionWithTargets>,
  edgeScope: "all" | "approved",
): Record<string, string> {
  const names: Record<string, string> = {};
  const specificities: Record<string, number> = {};

  for (const region of Object.values(regions)) {
    const targets = region.stats?.edges?.[edgeScope]?.targetNodeIds;
    if (!Array.isArray(targets)) continue;

    const specificity = region.teryt?.length ?? 0;
    for (const id of targets) {
      if (id in names && specificities[id]! >= specificity) continue;
      names[id] = region.name;
      specificities[id] = specificity;
    }
  }

  return names;
}

/** Node ids of the places a person holds or held a post at.
 *
 * Only `employed` edges count: an `owns` edge to a company says the person is
 * behind it, not that they ever sat there, and a `connection` says nothing
 * about a workplace at all.
 */
export function employmentPlaceIds(
  edges: {
    type?: string;
    richNode?: { id?: string; type?: string } | null;
  }[],
): string[] {
  const ids: string[] = [];
  for (const edge of edges) {
    if (edge.type !== "employed") continue;
    const node = edge.richNode;
    if (node?.type === "place" && node.id) ids.push(node.id);
  }
  return ids;
}

/** The cities a person has worked in, from the places they were employed at.
 *
 * `regionNames` is what `regionNamesByPlaceId` returns, so a company nobody has
 * linked to a region is simply absent - dropped rather than listed blank. The
 * same city is named once however many employers a person had in it, which is
 * common: a career inside one town's spółki komunalne is half a dozen edges
 * pointing at the same region.
 */
export function workLocationNames(
  placeIds: Iterable<string>,
  regionNames: Record<string, string>,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const id of placeIds) {
    const name = regionNames[id];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}
