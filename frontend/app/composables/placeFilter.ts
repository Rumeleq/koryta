import { computed, type Ref, type WritableComputedRef } from "vue";
import { useRoute } from "vue-router";
import type { QueryPatch } from "~/composables/queryFilters";
import type { Company } from "~~/shared/model";

type SetQuery = (
  patch: QueryPatch,
  opts?: { replace?: boolean; reset?: boolean },
) => unknown;

/** The employer filter the explore pages share, keyed on place node ids.
 *
 * Companies used to be named by their KRS number here, which left out every
 * institution that is not in the register — a ministry, an urząd, a wojewódzki
 * fundusz — so none of them could be picked, and a link to one carried no
 * filter at all. Node ids name all of them.
 *
 * `krs` is still read, so a link minted before the switch shows its companies
 * as chosen once the place list arrives to map one identifier onto the other,
 * and is still passed to the api meanwhile (it unions the two) so the first
 * render is filtered too. Writing only ever uses node ids, dropping `krs`.
 */
export function usePlaceFilter(
  places: Ref<Record<string, Company> | undefined>,
  arrayFilter: (key: string) => WritableComputedRef<string[] | null>,
  setQuery: SetQuery,
) {
  const route = useRoute();
  const placeParam = arrayFilter("place");

  const legacyKrs = computed(() => {
    const raw = route.query.krs;
    if (!raw) return null;
    const values = (Array.isArray(raw) ? raw : [raw]).filter(
      (value): value is string => value != null,
    );
    return values.length > 0 ? values : null;
  });

  const filterPlace = computed<string[] | null>({
    get: () => {
      if (placeParam.value) return placeParam.value;
      if (!legacyKrs.value || !places.value) return null;
      const wanted = new Set(legacyKrs.value);
      const ids = Object.entries(places.value)
        .filter(([, place]) => place.krsNumber && wanted.has(place.krsNumber))
        .map(([id]) => id);
      return ids.length > 0 ? ids : null;
    },
    set: (value) =>
      void setQuery({ place: value, krs: undefined }, { reset: true }),
  });

  /** Options for the employer autocomplete: every place, named by node id. */
  const availableCompanies = computed(() =>
    Object.entries(places.value ?? {})
      .map(([id, place]) => ({ title: place.name, value: id }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  );

  return { filterPlace, legacyKrs, availableCompanies };
}
