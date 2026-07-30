<template>
  <GraphContainer v-if="focusNodeId" :focus-node-id="focusNodeId" />
  <v-alert v-else type="info" variant="tonal" class="ma-4">
    Wybierz miejsce, by zobaczyć jego graf powiązań.
  </v-alert>
</template>

<script setup lang="ts">
// Everything that links here - the "Graf połączeń" button on a place entity,
// the omni search - names the node in `?miejsce=`. The page used to ignore the
// query and hardcode focus-node-id="0", an id nothing in the data carries, so
// it asked /api/graph/local/0 and drew an empty canvas whatever you clicked.
// `filtered` went the same way: neither GraphContainer nor useGraph ever
// declared the prop it was passed as.
const route = useRoute();
const focusNodeId = computed(() =>
  typeof route.query.miejsce === "string" ? route.query.miejsce : "",
);

definePageMeta({
  title: "Graf",
  isGraph: true,
  fullWidth: true,
  robots: false,
});
</script>
