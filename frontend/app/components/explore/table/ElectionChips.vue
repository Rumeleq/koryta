<template>
  <div class="d-flex flex-wrap ga-1 py-1">
    <v-chip
      v-for="(election, i) in elections"
      :key="i"
      :size="size"
      variant="outlined"
    >
      <v-tooltip activator="parent" location="top" open-delay="200">
        {{
          wojewodztwoName(election.teryt)
            ? `woj. ${wojewodztwoName(election.teryt)}`
            : "Brak informacji o województwie"
        }}
      </v-tooltip>
      <span v-if="election.year" class="font-weight-bold mr-1">
        {{ election.year }}
      </span>
      <template v-if="election.location">{{ election.location }}</template>
      <span v-if="election.committee" class="text-caption ml-1">
        ({{ election.committee }})
      </span>
    </v-chip>
  </div>
</template>

<script setup lang="ts">
import { wojewodztwoName } from "~~/shared/teryt";
import type { ElectionRich } from "~~/shared/model";

withDefaults(defineProps<{ elections?: ElectionRich[]; size?: string }>(), {
  elections: () => [],
  size: "small",
});
</script>
