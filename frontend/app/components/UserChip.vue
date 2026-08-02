<template>
  <v-chip v-if="uid" size="small" variant="tonal" class="user-chip">
    <template #prepend>
      <v-avatar v-if="info?.photoURL" start :image="info.photoURL" />
      <v-icon v-else start :icon="mdiAccountCircle" size="small" />
    </template>
    <span class="text-truncate" style="max-width: 180px">{{ name }}</span>
    <v-tooltip activator="parent" location="bottom">
      {{ uid }}<template v-if="info?.email"> · {{ info.email }}</template>
    </v-tooltip>
  </v-chip>
  <span v-else class="text-grey">Nieznany</span>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { mdiAccountCircle } from "@mdi/js";
import { useUserLookup, type LookedUpUser } from "@/composables/users";

const props = defineProps<{
  uid?: string | null;
  /** Display data the caller already has.
   *
   * An endpoint that ranks or lists people resolves their names server-side in
   * one batch; passing the result in skips the chip's own lookup, which would
   * otherwise re-ask for names the page is already holding. */
  user?: LookedUpUser | null;
}>();

const { cache, resolve, displayName } = useUserLookup();

watch(
  () => [props.uid, props.user] as const,
  ([uid, user]) => {
    if (!user) resolve([uid]);
  },
  { immediate: true },
);

const info = computed(
  () => props.user ?? (props.uid ? cache.value[props.uid] : null),
);
const name = computed(
  () => props.user?.displayName || props.user?.email || displayName(props.uid),
);
</script>
