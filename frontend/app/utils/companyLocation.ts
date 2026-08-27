/** The part of a region node this reads, typed to what Firestore really holds
 * rather than to `Region`: `stats` is written by the recompute job, so a region
 * it has not reached yet carries it partly or not at all.
 */
type RegionWithTargets = {
  name: string;
  teryt?: string;
  stats?: {
    edges?: {
      all?: { targetNodeIds?: string[]; seatNodeIds?: string[] };
      approved?: { targetNodeIds?: string[]; seatNodeIds?: string[] };
    };
  };
};

/** A region as the rest of the app needs it: what to call it, and the TERYT
 * code that puts it on the map. */
export type PlaceRegion = { name: string; teryt?: string };

/** The region every company the loaded regions claim sits in, keyed by place id.
 *
 * A company's seat is a `seat` edge from the region to the company, which the
 * stats job folds into the *region's* `seatNodeIds`. The lookup runs in that
 * direction because company nodes almost never carry stats of their own - 66 of
 * 3706 in production - so reading `place.stats` left the location blank for all
 * but a handful of them.
 *
 * It reads `seatNodeIds` rather than `targetNodeIds` because the latter is
 * type-blind, and since the register's shareholder lists arrived a region points
 * at two different kinds of thing: the companies seated in it and the 1,675 it
 * holds shares in. Gmina Miasta Gdańsk owns 10.7% of PKP SKM, which sits in
 * Gdynia; on `targetNodeIds` the two would tie on TERYT length and the answer
 * would depend on which region the loop reached first.
 *
 * Falls back to `targetNodeIds` while the migration runs, so a region whose
 * stats have not been recomputed yet still answers. Should two regions still
 * claim one company, the more specific one wins - a powiat over the województwo
 * around it.
 */
export function regionsByPlaceId(
  regions: Record<string, RegionWithTargets>,
  edgeScope: "all" | "approved",
): Record<string, PlaceRegion> {
  const seats: Record<string, PlaceRegion> = {};
  const specificities: Record<string, number> = {};

  for (const region of Object.values(regions)) {
    const scoped = region.stats?.edges?.[edgeScope];
    const targets = Array.isArray(scoped?.seatNodeIds)
      ? scoped.seatNodeIds
      : scoped?.targetNodeIds;
    if (!Array.isArray(targets)) continue;

    const specificity = region.teryt?.length ?? 0;
    for (const id of targets) {
      if (id in seats && specificities[id]! >= specificity) continue;
      seats[id] = { name: region.name, teryt: region.teryt };
      specificities[id] = specificity;
    }
  }

  return seats;
}

/** Region name for every company the loaded regions claim, keyed by place id.
 *
 * What `regionsByPlaceId` finds, for the callers that only ever spell the
 * region out. */
export function regionNamesByPlaceId(
  regions: Record<string, RegionWithTargets>,
  edgeScope: "all" | "approved",
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const [id, seat] of Object.entries(
    regionsByPlaceId(regions, edgeScope),
  )) {
    names[id] = seat.name;
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

/** The regions a person has worked in, from the places they were employed at.
 *
 * `seats` is what `regionsByPlaceId` returns, so a company nobody has linked to
 * a region is simply absent - dropped rather than listed blank. The same region
 * is named once however many employers a person had in it, which is common: a
 * career inside one town's spółki komunalne is half a dozen edges pointing at
 * the same region.
 */
export function workLocationRegions(
  placeIds: Iterable<string>,
  seats: Record<string, PlaceRegion>,
): PlaceRegion[] {
  const regions: PlaceRegion[] = [];
  const seen = new Set<string>();
  for (const id of placeIds) {
    const seat = seats[id];
    if (!seat?.name || seen.has(seat.name)) continue;
    seen.add(seat.name);
    regions.push(seat);
  }
  return regions;
}

/** The cities a person has worked in, for a caller that wants them spelled out
 * rather than drawn. */
export function workLocationNames(
  placeIds: Iterable<string>,
  regionNames: Record<string, string>,
): string[] {
  const seats: Record<string, PlaceRegion> = {};
  for (const [id, name] of Object.entries(regionNames)) seats[id] = { name };
  return workLocationRegions(placeIds, seats).map((region) => region.name);
}
