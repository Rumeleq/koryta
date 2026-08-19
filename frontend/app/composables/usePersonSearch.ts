import { computed, unref } from "vue";
import type { Ref } from "vue";
import type { PersonRich } from "~~/shared/model";

/** How many location-qualified queries a person is worth. See
 * `uniqueLocations`. */
const MAX_LOCATION_QUERIES = 6;

export const usePersonSearch = (
  person: Ref<PersonRich | undefined> | PersonRich | undefined,
  region?: Ref<[string, string] | undefined> | [string, string] | undefined,
  company?: Ref<[string, string] | undefined> | [string, string] | undefined,
  /** Cities to search alongside the ones the person carries, for a caller that
   * worked them out itself - the drawer derives them from the edges it already
   * fetched, which covers nodes that never went through the table. */
  extraLocations?: Ref<string[] | undefined> | string[] | undefined,
) => {
  const personRef = computed(() => unref(person));
  const regionRef = computed(() => unref(region));
  const companyRef = computed(() => unref(company));
  const extraLocationsRef = computed(() => unref(extraLocations));

  const getQueryParts = () => {
    const parts = [personRef.value?.name];
    if (regionRef.value) {
      parts.push(regionRef.value[1]);
    }
    if (companyRef.value) {
      parts.push(companyRef.value[1]);
    }
    return parts.filter(Boolean) as string[];
  };

  const nameWithoutMiddle = computed(() => {
    if (!personRef.value?.name) {
      return undefined;
    }
    const nameParts = personRef.value.name.trim().split(/\s+/);
    let nameWithoutMiddle = personRef.value.name;
    if (nameParts.length > 2) {
      nameWithoutMiddle = `${nameParts[0]} ${nameParts[nameParts.length - 1]}`;
    }
    return nameWithoutMiddle;
  });

  /** Every place a person is tied to, in the order a searcher would try them.
   *
   * Where they stood for election first - that is the town they asked to
   * represent - then where they have worked, which is what puts a local paper's
   * coverage of a spółka komunalna within reach of the same name. The two
   * overlap often enough to be worth deduplicating: a councillor employed by
   * their own gmina would otherwise get the same query twice.
   *
   * Capped, because `searchAll` opens a browser tab per query and a long career
   * across a województwo would otherwise open a dozen at once - past which the
   * browser starts blocking them anyway.
   */
  const uniqueLocations = computed(() => {
    const locations = [
      ...(personRef.value?.elections ?? []).map((e) => e.location),
      ...(personRef.value?.workLocations ?? []),
      ...(extraLocationsRef.value ?? []),
    ].filter(Boolean) as string[];
    return Array.from(new Set(locations)).slice(0, MAX_LOCATION_QUERIES);
  });

  const queries = computed(() => {
    const result = [];
    if (personRef.value?.name) {
      result.push(personRef.value.name);
      result.push(personRef.value.name + " PKW");

      if (uniqueLocations.value.length > 0) {
        for (const loc of uniqueLocations.value) {
          result.push(`${nameWithoutMiddle.value} ${loc}`);
        }
      }
    }

    return result;
  });

  const searchInGoogle = (query?: string) => {
    const searchQuery = encodeURIComponent(query || getQueryParts().join(" "));
    window.open(`https://www.google.com/search?q=${searchQuery}`, "_blank");
  };

  const searchAll = () => {
    if (!personRef.value?.name) return;

    const name = encodeURIComponent(personRef.value.name);

    const rejestrIo = personRef.value.rejestrIo;
    const wikipedia = personRef.value.wikipedia;

    if (rejestrIo) {
      window.open(rejestrIo, "_blank");
    } else {
      window.open(`https://rejestr.io/krs?q=${name}`, "_blank");
    }

    if (wikipedia) {
      window.open(wikipedia, "_blank");
    } else {
      window.open(
        `https://pl.wikipedia.org/wiki/Special:Search?search=${name}`,
        "_blank",
      );
      window.open(
        `https://pl.wikipedia.org/wiki/Special:Search?search=${nameWithoutMiddle.value}`,
        "_blank",
      );
    }

    for (const query of queries.value) {
      searchInGoogle(query);
    }
  };

  return {
    queries,
    getQueryParts,
    searchInGoogle,
    searchAll,
  };
};

export const executeSearchAll = (
  person: PersonRich,
  region?: [string, string],
  company?: [string, string],
) => {
  // The cities come off `person.workLocations`, which the table's rows carry -
  // there are no edges to derive them from at this call site.
  const { searchAll } = usePersonSearch(person, region, company);
  searchAll();
};
