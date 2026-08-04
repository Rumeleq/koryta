<template>
  <v-card v-if="type == 'person'" width="100%" variant="flat">
    <!-- Name, affiliation and the two things a reader can do about them. The
         actions used to be `d-none d-md-inline`, which left a phone with no way
         to vote on a person or propose a correction - the two contributions
         this page exists to collect. They wrap under the name instead. -->
    <div class="d-flex flex-wrap align-center gc-4 gr-2 mb-1">
      <div class="d-flex flex-wrap align-center ga-2 flex-grow-1">
        <h2 class="text-h5 font-weight-bold">
          {{ entity?.name }}
        </h2>
        <PartyChip
          v-for="party in personEntity?.parties"
          :key="party"
          :party="party"
        />
      </div>

      <div class="d-flex align-center ga-2 flex-shrink-0">
        <DialogProposeEditNode v-if="entity" :entity="entity" />
        <ButtonVoteNumber
          v-if="entity"
          :id="entity.id ?? ''"
          :key="entity.id ?? ''"
          category="interesting"
          show-label
        />
      </div>
    </div>

    <v-card-text class="px-0 pt-2">
      <CardPersonInfo :person="personEntity" class="mb-2" />
      {{ entity?.content }}
    </v-card-text>
  </v-card>

  <v-card v-if="type == 'place'" width="100%" variant="flat">
    <v-card-title class="headline px-0">
      <v-icon start :icon="mdiOfficeBuildingOutline" />
      <h2 class="text-h5 font-weight-bold d-inline">
        {{ entity?.name }}
      </h2>
    </v-card-title>
    <v-card-text class="px-0">
      <div v-if="identifiers.length > 0" class="text-caption mb-2">
        {{ identifiers.join(" · ") }}
      </div>
      {{ entity?.content }}
    </v-card-text>
  </v-card>

  <v-card v-if="type == 'article'" width="100%" variant="flat">
    <v-card-title class="headline px-0">
      <v-icon start :icon="mdiFileDocumentOutline" />
      <h2 class="text-h5 font-weight-bold d-inline">
        {{ entity?.name }}
      </h2>
    </v-card-title>
    <v-card-text class="px-0">
      <div v-if="article?.sourceURL" class="text-caption mb-2">
        URL:
        <a :href="article?.sourceURL" target="_blank">{{
          article?.sourceURL
        }}</a>
      </div>
      {{ entity?.content }}
    </v-card-text>
  </v-card>

  <v-card v-if="type == 'region'" width="100%" variant="flat">
    <v-card-title class="headline px-0">
      <v-icon start :icon="mdiMapMarkerRadiusOutline" />
      <h2 class="text-h5 font-weight-bold d-inline">
        {{ region?.name }}
      </h2>
    </v-card-title>
    <v-card-text class="px-0">
      {{ region?.content }}
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import {
  mdiFileDocumentOutline,
  mdiMapMarkerRadiusOutline,
  mdiOfficeBuildingOutline,
} from "@mdi/js";
import type { Person, Company, Article, Region } from "~~/shared/model";
import { companyIdentifiers } from "~~/shared/identifiers";

const props = defineProps<{
  entity: Company | Person | Article | Region;
  type: string;
}>();

const company = computed(() =>
  props.type === "place" ? (props.entity as Company) : undefined,
);

const identifiers = computed(() =>
  companyIdentifiers(company.value ?? {}).map(
    ({ register, value }) => `${register}: ${value}`,
  ),
);
const article = computed(() =>
  props.type === "article" ? (props.entity as Article) : undefined,
);
const region = computed(() =>
  props.type === "region" ? (props.entity as Region) : undefined,
);

const personEntity = computed(() =>
  props.type === "person" ? (props.entity as Person) : undefined,
);
</script>
