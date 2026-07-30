import type { NodeTypeMap, NodeType } from "~~/shared/model";
import { computed, type Ref, type ComputedRef } from "vue";
import { authFetch, useAuthState } from "@/composables/auth";

export type Filters = {
  party?: string;
  place?: string;
  source?: string;
  // TODO unify with the limit class used in other places
  limit?: number;
  page?: number;
  sortBy?: string;
  sortDesc?: string | boolean;
};

export type UseEntitiesOptions = {
  /** Set false where the result is only ever read behind a `<ClientOnly>`.
   *
   * `/api/nodes?type=` is unpaginated, so a collection fetched during SSR is
   * serialised into __NUXT_DATA__ in full - and on a page that renders no
   * markup on the server, every one of those bytes is shipped for nothing.
   */
  server?: boolean;
};

export function useEntities<N extends NodeType>(
  nodeType: N,
  filters: Filters | Ref<Filters> = {},
  options: UseEntitiesOptions = {},
) {
  const { data: response, refresh } = authFetch<{
    nodes: Record<string, NodeTypeMap[N]>;
  }>(`/api/nodes?type=${nodeType}`, {
    query: filters,
    ...options,
  });

  const entitiesRaw = computed(() => response?.value?.nodes ?? {});

  const entities = useEntitiesFiltering(entitiesRaw);

  return { entities, refresh };
}

export interface EntityWithVisibility {
  visibility?: boolean;
}

export function useEntitiesFiltering<
  T extends EntityWithVisibility,
  C extends T[] | Record<string, T>,
>(entities: Ref<C | undefined> | ComputedRef<C | undefined>) {
  const { user } = useAuthState();

  const filtered = computed(() => {
    const raw = entities.value;
    if (!raw) return raw as C | undefined;

    if (Array.isArray(raw)) {
      return (raw as T[]).filter((entity) => {
        if (user.value) return true;
        return entity.visibility !== false;
      }) as C;
    } else {
      return Object.fromEntries(
        Object.entries(raw as Record<string, T | undefined>).filter(
          ([_, entity]) => {
            if (!entity) return false;
            if (user.value) return true;
            return entity.visibility !== false;
          },
        ),
      ) as C;
    }
  });

  return filtered;
}
