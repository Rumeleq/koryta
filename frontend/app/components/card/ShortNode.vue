<template>
  <v-card
    :key="edge.richNode.id"
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
        <!-- On a region's page every row is a candidacy, so the result is what
             distinguishes them - and "wynik nieznany" is worth saying here,
             where it is one line rather than one per relation. -->
        <ChipElectionOutcome :elected="edge.elected" show-unknown />
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
