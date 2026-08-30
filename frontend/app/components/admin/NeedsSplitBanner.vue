<template>
  <v-alert
    v-if="isAdmin && mark"
    type="warning"
    variant="tonal"
    class="mb-4"
    data-testid="needs-split-banner"
  >
    <p class="mb-1">
      <strong>Ta strona jest oznaczona jako dwie osoby.</strong> Póki nikt ich
      nie rozdzieli, powiązania niżej opisują obie naraz.
    </p>
    <p class="mb-1">{{ mark.reason }}</p>
    <p class="mb-0 text-caption">
      Oznaczył/a: {{ mark.user || "nieznany admin"
      }}<span v-if="markedAt"> · {{ markedAt }}</span>
    </p>
  </v-alert>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useAuthState } from "~/composables/auth";
import type { Person } from "~~/shared/model";

const props = withDefaults(
  defineProps<{
    nodeId: string;
    /** The mark as the page loaded it, where it loaded one. */
    needsSplit?: Person["needs_split"];
  }>(),
  { needsSplit: undefined },
);

const { isAdmin } = useAuthState();

/** The mark this session has just written, shared with `AdminSplitNodeDialog`
 * by this key. Without it, marking a page appears to do nothing: the node
 * endpoint is cached for six hours, `mark_only` does not clear that cache, and
 * a signed in reader is answered from the latest revision, which does not carry
 * a field only an admin can set on the document. */
const localMark = useState<NonNullable<Person["needs_split"]> | null>(
  `needs-split-${props.nodeId}`,
  () => null,
);

const mark = computed(() => localMark.value ?? props.needsSplit ?? null);

/** Admins only, so the day is enough - the point of the date is "how long has
 * this been sitting here", not the minute it was clicked. */
const markedAt = computed(() => {
  if (!mark.value?.at) return "";
  const date = new Date(mark.value.at);
  return isNaN(date.getTime()) ? "" : date.toLocaleDateString("pl-PL");
});
</script>
