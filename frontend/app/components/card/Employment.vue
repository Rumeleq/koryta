<template>
  <v-card
    :to="personUrl"
    :data-testid="`recent-employment-${employment.id}`"
    class="h-100"
    color="surface-variant"
    hover
    rounded="lg"
    variant="tonal"
  >
    <v-card-item>
      <template #prepend>
        <v-icon :icon="mdiAccountOutline" />
      </template>

      <v-card-title class="text-subtitle-1 font-weight-bold text-wrap">
        {{ employment.personName }}
      </v-card-title>

      <v-card-subtitle class="text-wrap">
        {{ employment.role ?? "Zatrudniony/a w" }}
      </v-card-subtitle>
    </v-card-item>

    <v-card-text class="pt-0">
      <div class="d-flex align-center ga-2 mb-1">
        <v-icon :icon="mdiOfficeBuildingOutline" size="small" />
        <span class="text-body-2 text-wrap">{{ employment.companyName }}</span>
      </div>

      <div class="d-flex align-center flex-wrap ga-1">
        <span class="text-caption text-medium-emphasis mr-1">{{ period }}</span>
        <ChipPublicCompany :company="company" />
        <PartyChip
          v-for="party in employment.parties"
          :key="party"
          :party
          class="text-body-2"
        />
      </div>
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
import { mdiAccountOutline, mdiOfficeBuildingOutline } from "@mdi/js";
import { generateEntityUrl } from "~/composables/slugs";
import type { Company } from "~~/shared/model";
import type { RecentEmployment } from "~~/server/api/edges/recentEmployments.get";

const props = defineProps<{ employment: RecentEmployment }>();

/** The person, not the company. The card is about a job, but the reader
 * clicking it wants to know who this is - the company is one hop further on
 * from their page, and every other route into the site already leads to a
 * person. */
const personUrl = computed(() =>
  generateEntityUrl(
    "person",
    props.employment.personId,
    props.employment.personName,
  ),
);

/** `ChipPublicCompany` reads the whole company because a caller may be holding
 * something that is not one. Here it always is, so this is only the two flags
 * it actually looks at, put back into the shape it expects. */
const company = computed<Company>(() => ({
  type: "place",
  name: props.employment.companyName,
  isPublic: props.employment.companyIsPublic,
  isPublicSource: props.employment.companyIsPublicSource,
}));

/** "2024-03-01 - obecnie", and the single date where a spell began and ended
 * on the same day. A missing end means the post is still held; a missing start
 * cannot happen here, because the feed is ordered on it. */
const period = computed(() => {
  const { start_date: start, end_date: end } = props.employment;
  if (end === start) return start;
  return `${start} - ${end ?? "obecnie"}`;
});
</script>
