<template>
  <EntityDetailView :key="id" :node="id" :type="destination" />
</template>

<script setup lang="ts">
import type { NodeType } from "~~/shared/model";
import EntityDetailView from "~/components/EntityDetailView.vue";

definePageMeta({
  // Redirects to the readable url; see app/middleware/entity-slug.ts.
  middleware: "entity-slug",
});

const route = useRoute<"/entity/[destination]/[id]">();
const destination = route.params.destination as NodeType;
const id = route.params.id as string;
</script>
