<template>
  <DialogRemoveEdge
    v-if="edge?.id"
    v-model="open"
    :edge-id="edge.id"
    :edge-label="label"
    @removed="emit('removed')"
  />

  <v-snackbar v-model="shown" color="info" :timeout="5000">
    Powiązanie zostało usunięte.
  </v-snackbar>
</template>

<script setup lang="ts">
/** The dialog and the "it is gone" notice, as one tag.
 *
 * Five surfaces list a node's relations, and pasting the same nine lines into
 * each is how they drift - one ends up with a different timeout, or loses the
 * notice, and nobody spots it because no test looks at all five. Pair it with
 * `useEdgeRemoval`, which owns the state this binds to.
 */
import type { EdgeNode } from "~/composables/edges";

const open = defineModel<boolean>({ required: true });
/** Whether the "powiązanie usunięte" notice is up. Its own model, because the
 * dialog closes before the notice appears - they are never one flag. */
const shown = defineModel<boolean>("shown", { required: true });

defineProps<{
  /** The relation on screen. Undefined until somebody clicks a bin, which is
   * what keeps a page from mounting a dialog for nothing. */
  edge: EdgeNode | undefined;
  /** The relation read as a sentence - see `edgeSentence`. */
  label: string;
}>();

const emit = defineEmits<{ removed: [] }>();
</script>
