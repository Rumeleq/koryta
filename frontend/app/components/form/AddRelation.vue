<template>
  <div class="mt-4" data-testid="add-relation">
    <h3 class="text-h6 mb-2">Dodaj powiązanie</h3>

    <v-alert
      v-if="added"
      type="success"
      variant="tonal"
      density="compact"
      class="mb-3"
      data-testid="add-relation-success"
    >
      Dodano powiązanie. Publicznie będzie widoczne po zatwierdzeniu przez
      redakcję.
    </v-alert>

    <v-btn
      v-if="!user"
      variant="tonal"
      color="primary"
      :prepend-icon="mdiAccountPlusOutline"
      data-testid="add-relation-login"
      @click="emit('login')"
    >
      Zaloguj się, aby dodać powiązanie
    </v-btn>

    <template v-else>
      <FormEditEdgePicker
        v-if="!activeEdgeTypeExt"
        :node-id="nodeId"
        :node-type="nodeType"
        :node-name="nodeName"
        :types="types"
        @pick="startNewEdge"
      />

      <FormEditEdge
        v-else
        :key="activeEdgeTypeExt + '-' + activeDirection"
        :node-id="nodeId"
        :node-type="nodeType"
        :node-name="nodeName"
        :edge-type-ext="activeEdgeTypeExt"
        :initial-direction="activeDirection"
        @update="onEdgeUpdate"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { mdiAccountPlusOutline } from "@mdi/js";
import { useCurrentUser } from "vuefire";
import type { NodeType } from "~~/shared/model";
import type { edgeTypeExt } from "~/composables/useEdgeTypes";
import FormEditEdge from "~/components/form/EditEdge.vue";
import FormEditEdgePicker from "~/components/form/EditEdgePicker.vue";

defineProps<{
  nodeId: string;
  nodeType: NodeType;
  nodeName: string;
  /** Which relations may be added here; every one this node can be an end of,
   * when left out. */
  types?: edgeTypeExt[];
}>();

/** `added` means a relation was written - the page owns the edge list, so it
 * refetches. `login` means somebody wanted to add one while logged out. */
const emit = defineEmits<{
  (e: "added" | "login"): void;
}>();

const user = useCurrentUser();

const activeEdgeTypeExt = ref<edgeTypeExt | undefined>(undefined);
const activeDirection = ref<"incoming" | "outgoing" | undefined>(undefined);
const added = ref(false);

function startNewEdge(type: string, direction: string) {
  added.value = false;
  activeEdgeTypeExt.value = type as edgeTypeExt;
  activeDirection.value = direction as "incoming" | "outgoing";
}

/** The form emits this both on a successful write and on cancel; either way it
 * closes. `added` distinguishes the two, so the notice only follows a write. */
function onEdgeUpdate(saved = true) {
  activeEdgeTypeExt.value = undefined;
  activeDirection.value = undefined;
  if (saved) {
    added.value = true;
    emit("added");
  }
}
</script>
