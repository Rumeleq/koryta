import type { EdgeNode } from "~/composables/edges";
import { edgeSentence } from "~/utils/edgeSentence";
import { useAuthState } from "@/composables/auth";

/** The admin-only "take this relation off the graph" flow, for whichever
 * surface is listing the relations.
 *
 * There are five of them and they look nothing alike - a person's page, a
 * company's page, the region cards, the queue at /eksploruj/nowe and the drawer
 * that /eksploruj/tabela and /admin/notatki open - but the flow is the same
 * every time: admins only, one dialog for the whole page rather than one per
 * row, and a refetch afterwards rather than splicing the row out in the
 * browser, because the same relation is usually drawn in more than one place
 * from a single response.
 *
 * Written as a composable rather than copied because it had already been copied
 * twice, and `npm run check:duplication` counts .vue clones at 0.00%.
 *
 * @param subjectName the page the relations are being read from, for the
 *   caption - see `edgeSentence`.
 * @param refresh how this surface re-reads its relations. The dialog does not
 *   know what the caller fetched, so it says the relation is gone and the
 *   caller decides what to ask for again.
 */
export function useEdgeRemoval(options: {
  subjectName: () => string | undefined;
  refresh: () => unknown;
}) {
  const { isAdmin } = useAuthState();

  /** Removing takes effect at once rather than joining a review queue, which is
   * the point of it: the relations that come off a wrongly merged person are
   * nobody's claim, so there is no second opinion to wait for. That is also why
   * it is an administrator's decision and nobody else's. */
  const canRemove = computed(() => isAdmin.value === true);

  const removeOpen = ref(false);
  const removeEdge = ref<EdgeNode | undefined>(undefined);
  const removedShown = ref(false);

  const removeLabel = computed(() =>
    edgeSentence(options.subjectName(), removeEdge.value),
  );

  function openRemove(edge: EdgeNode) {
    removeEdge.value = edge;
    removeOpen.value = true;
  }

  async function onEdgeRemoved() {
    removedShown.value = true;
    await options.refresh();
  }

  return {
    canRemove,
    removeOpen,
    removeEdge,
    removedShown,
    removeLabel,
    openRemove,
    onEdgeRemoved,
  };
}
