<template>
  <v-card v-if="type == 'person'" width="100%" variant="flat">
    <v-card-title class="px-0 d-flex">
      <h2 class="text-h5 font-weight-bold mr-2">
        {{ entity?.name }}
      </h2>
      <PartyChip
        v-for="party in personEntity?.parties"
        :key="party"
        :party="party"
      />
      <v-spacer />
      <div class="d-none d-md-flex flex-column align-end ga-1">
        <div>
          <DialogProposeEditNode
            v-if="entity && type === 'person'"
            :entity="entity"
          />
          <ButtonVoteNumber
            v-if="entity"
            :id="entity.id ?? ''"
            :key="entity.id ?? ''"
            category="interesting"
            show-label
          />
        </div>
        <!-- Admins reach a person from a list - /eksploruj/tabela, a search
             result - and the revision list, which is where a page gets
             published, was reachable only by typing the node id into a url. It
             sits under the other two controls on the page rather than in a row
             of its own, because it is the same kind of thing: what this reader
             may do to the entity they are looking at. -->
        <v-btn
          v-if="isAdmin && entity?.id"
          variant="tonal"
          size="small"
          :prepend-icon="mdiHistory"
          :to="`/admin/rewizje/${entity.id}`"
          data-testid="admin-revisions-link"
        >
          Rewizje
        </v-btn>
      </div>
    </v-card-title>
    <template #append> </template>
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
  mdiHistory,
  mdiMapMarkerRadiusOutline,
  mdiOfficeBuildingOutline,
} from "@mdi/js";
import type { Person, Company, Article, Region } from "~~/shared/model";
import { companyIdentifiers } from "~~/shared/identifiers";

const props = defineProps<{
  entity: Company | Person | Article | Region;
  type: string;
}>();

const { isAdmin } = useAuthState();

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
