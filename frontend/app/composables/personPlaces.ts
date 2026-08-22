import { computed, toValue, type MaybeRefOrGetter } from "vue";
import type { EdgeNode } from "~/composables/edges";
import type { PersonRich } from "~~/shared/model";
import type { PlaceRegion } from "~/utils/companyLocation";
import {
  employmentPlaceIds,
  workLocationRegions,
} from "~/utils/companyLocation";
import { personLocations } from "~/utils/personLocations";

/** Where a person turns up, worked out from the edges a view already has.
 *
 * Derived here rather than read off `person.workLocations` so that a node
 * opened straight from an id - as the note queues do - is covered too, and in
 * one place rather than once per view: the drawer and the review queue show the
 * same person the same way.
 *
 * `companyRegions` comes from `useCompanyLocations`. Absent until a caller
 * supplies it, which is what tells "no employers we can place" apart from
 * "nobody asked".
 */
export function usePersonPlaces(
  person: MaybeRefOrGetter<PersonRich | undefined>,
  edges: MaybeRefOrGetter<EdgeNode[] | undefined>,
  companyRegions: MaybeRefOrGetter<Record<string, PlaceRegion> | undefined>,
) {
  const workRegions = computed(() => {
    const seats = toValue(companyRegions);
    if (!seats) return undefined;
    return workLocationRegions(employmentPlaceIds(toValue(edges) ?? []), seats);
  });

  /** The cities to search the person in, for the suggestions. */
  const workLocations = computed(() =>
    workRegions.value?.map((region) => region.name),
  );

  /** Everywhere the person shows up, for the map. Elections come off the node
   * the caller focused, which only a view that built it from the subgraph has -
   * a node fetched by id carries none, and the map then shows the employers
   * alone. */
  const mapLocations = computed(() =>
    personLocations(toValue(person)?.elections ?? [], workRegions.value ?? []),
  );

  return { workRegions, workLocations, mapLocations };
}
