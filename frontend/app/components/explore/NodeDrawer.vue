<template>
  <v-navigation-drawer
    v-model="open"
    location="end"
    temporary
    :width="$vuetify.display.mdAndUp ? 600 : 280"
  >
    <v-card-item>
      <template #append>
        <v-btn
          density="compact"
          icon="$close"
          variant="text"
          @click="open = false"
        />
      </template>
    </v-card-item>

    <CardExplorePerson
      v-if="!node || person"
      :key="node?.id"
      :person="person"
      :region="region"
      :company="company"
      :work-locations="workLocations"
    />
    <v-card v-else class="ma-2" flat>
      <v-card-title class="text-wrap text-h5">
        <NuxtLink
          :to="generateEntityUrl(node.type, node.id, node.name)"
          class="text-decoration-none text-primary"
          target="_blank"
        >
          {{ node.name }}
        </NuxtLink>
      </v-card-title>
    </v-card>

    <ChartPersonLocations
      v-if="person && mapLocations.length"
      :key="`map-${person.id}`"
      :locations="mapLocations"
    />

    <div v-if="node" class="pa-4 pt-0">
      <ExploreProposeChange v-if="person" :key="person.id" :person="person">
        <ButtonVoteNumber
          :id="person.id"
          :key="person.id"
          category="interesting"
          show-label
        />
      </ExploreProposeChange>

      <NoteEditor
        :key="node.id"
        :node-id="node.id"
        :node-type="node.type"
        single-column
      />
      <v-divider class="my-4" />
      <CardEmploymentHistory :edges="edges" />
    </div>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { generateEntityUrl } from "~/composables/slugs";
import type { EdgeNode } from "~/composables/edges";
import type { NodeMaybeRich, PersonRich } from "~~/shared/model";
import type { PlaceRegion } from "~/utils/companyLocation";
import { usePersonPlaces } from "~/composables/personPlaces";

const props = withDefaults(
  defineProps<{
    /** Any node. The person-specific cards only appear for a person; every
     * other kind gets the plain header. */
    node?: NodeMaybeRich;
    /** Edges around `node`, which the caller fetches - `useEdges` suspends,
     * and doing that in here would suspend the page that hosts the drawer. */
    edges?: EdgeNode[];
    /** Context for the search suggestions, where the caller has any. */
    region?: [string, string];
    company?: [string, string];
    /** The region each company node id sits in, from `useCompanyLocations`.
     * Turns the employers in `edges` into the cities to search the person in
     * and the shapes to colour on the map - the drawer works them out here
     * rather than reading `person.workLocations`, so that a node opened
     * straight from an id, as the note queues do, is covered too. */
    companyRegions?: Record<string, PlaceRegion>;
  }>(),
  {
    node: undefined,
    edges: () => [],
    region: undefined,
    company: undefined,
    companyRegions: undefined,
  },
);

const open = defineModel<boolean>({ required: true });

const person = computed(() =>
  props.node?.type === "person" ? (props.node as PersonRich) : undefined,
);

const { workLocations, mapLocations } = usePersonPlaces(
  person,
  () => props.edges,
  () => props.companyRegions,
);
</script>
