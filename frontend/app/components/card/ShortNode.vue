<template>
  <v-card
    :key="edge.richNode.id"
    class="short-node"
    :prepend-icon="entityIcon(edge.richNode.type)"
    :to="`/entity/${edge.richNode.type}/${edge.richNode.id}`"
  >
    <template #title>{{ edge.richNode.name }}</template>
    <template #subtitle>
      <div v-if="edge.type === 'election'" class="d-flex flex-wrap gap-x-2">
        <v-chip v-if="edge.party" size="x-small" density="compact" class="mr-1">
          {{ edge.party }}
        </v-chip>
        <span v-if="edge.position" class="font-weight-bold mr-1">{{
          edge.position
        }}</span>
        <span v-if="edge.term" class="text-caption">({{ edge.term }})</span>
      </div>
      <div>{{ edge.label }}</div>
      <div v-if="edge.start_date || edge.end_date" class="text-caption">
        {{ edge.start_date }} - {{ edge.end_date || "obecnie" }}
      </div>
    </template>
    <v-card-text v-if="edge.richNode.content">
      {{ edge.richNode.content }}
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import type { EdgeNode } from "~/composables/edges";
import { entityIcon } from "~/utils/entityIcon";

const { edge } = defineProps<{ edge: EdgeNode }>();
</script>

<style scoped>
/* Vuetify gives `.v-card-title` and `.v-card-subtitle` `white-space: nowrap;
   overflow: hidden; text-overflow: ellipsis`. These cards carry article
   headlines, and at 390px a headline that wants 720px gets 294px - so a person
   mentioned in several pieces got a column of cards whose visible text was the
   same prefix over and over, with the relation and its dates clipped off the
   subtitle underneath. Written here rather than as `text-wrap` on the elements
   because both are drawn by `v-card` from slots. */
.short-node :deep(.v-card-title),
.short-node :deep(.v-card-subtitle) {
  white-space: normal;
}
</style>
