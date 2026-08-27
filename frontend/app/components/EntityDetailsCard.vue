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
        <div v-if="isAdmin && entity?.id" class="d-flex ga-1">
          <!-- The table's "Eksploruj" icon, in words, for the reader who
               arrived on the page directly. It opens the same tabs - rejestr.io,
               Wikipedia and a Google query per place the person is tied to -
               so that checking somebody found through search costs the same
               one click as checking somebody found through /eksploruj. -->
          <v-tooltip :text="SEARCH_ALL_TOOLTIP" open-delay="600" location="top">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                variant="tonal"
                size="small"
                :prepend-icon="mdiOpenInNew"
                data-testid="admin-explore-link"
                @click="searchAll()"
              >
                Eksploruj
              </v-btn>
            </template>
          </v-tooltip>
          <v-btn
            variant="tonal"
            size="small"
            :prepend-icon="mdiHistory"
            :to="`/admin/rewizje/${entity.id}`"
            data-testid="admin-revisions-link"
          >
            Rewizje
          </v-btn>
        </div>
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
  mdiOpenInNew,
} from "@mdi/js";
import { toRef } from "vue";
import type {
  Person,
  Company,
  Article,
  Region,
  PersonRich,
} from "~~/shared/model";
import { companyIdentifiers } from "~~/shared/identifiers";
import {
  SEARCH_ALL_TOOLTIP,
  usePersonSearch,
} from "~/composables/usePersonSearch";

const props = withDefaults(
  defineProps<{
    entity: Company | Person | Article | Region;
    type: string;
    /** Places to search the person in besides the ones the node carries.
     * A node fetched by id has no `elections` - only the table builds those,
     * from the subgraph it fetches - so the page derives them from its edges
     * and hands them down. */
    extraLocations?: string[];
  }>(),
  { extraLocations: undefined },
);

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

/** The node as the search composable wants it. A page loads a plain `Person`,
 * whose extra rich fields are simply absent - `usePersonSearch` reads them
 * optionally, and `extraLocations` covers the one that matters here. */
const richPerson = computed(() => personEntity.value as PersonRich | undefined);

const { searchAll } = usePersonSearch(
  richPerson,
  undefined,
  undefined,
  toRef(props, "extraLocations"),
);
</script>
