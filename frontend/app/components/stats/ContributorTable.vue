<template>
  <v-card variant="outlined">
    <v-card-item>
      <template #prepend>
        <v-icon :icon="mdiTrophyOutline" color="primary" />
      </template>
      <v-card-title class="text-subtitle-1 font-weight-medium">
        Najaktywniejsi
      </v-card-title>
      <v-card-subtitle class="text-wrap">{{ subtitle }}</v-card-subtitle>
    </v-card-item>

    <v-card-text :class="{ 'contributors--stale': loading }">
      <v-alert
        v-if="!identified"
        type="info"
        variant="tonal"
        density="compact"
        :text="
          `W tym okresie dane zmieniało ${polishCounting(contributorCount, 'osoba', 'osoby', 'osób')}. ` +
          'Kto konkretnie — widzą tylko administratorzy.'
        "
      />

      <v-alert
        v-else-if="contributors.length === 0"
        type="info"
        variant="tonal"
        density="compact"
        text="W tym okresie nikt nie zmieniał danych."
      />

      <div v-else class="contributors__scroll">
        <v-table density="compact">
          <thead>
            <tr>
              <th class="text-left">#</th>
              <th class="text-left">Użytkownik</th>
              <th class="text-left" style="min-width: 140px">Rozkład</th>
              <th
                v-for="kind in activityKinds"
                :key="kind"
                class="text-right d-none d-md-table-cell"
              >
                <v-tooltip :text="activityKindDescriptions[kind]">
                  <template #activator="{ props: tip }">
                    <span v-bind="tip" class="d-inline-flex align-center ga-1">
                      <span
                        class="contributors__dot"
                        :style="{ backgroundColor: activityColors[kind] }"
                      />
                      {{ activityKindLabels[kind] }}
                    </span>
                  </template>
                </v-tooltip>
              </th>
              <th class="text-right">Razem</th>
              <th class="text-right">Ostatnio</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in contributors" :key="row.key">
              <td class="text-medium-emphasis stats-numeric">
                {{ index + 1 }}
              </td>
              <td>
                <UserChip
                  :uid="row.uid"
                  :user="{
                    displayName: row.displayName,
                    email: row.email,
                    photoURL: row.photoURL,
                  }"
                />
              </td>
              <td>
                <div
                  class="contributors__mix"
                  role="img"
                  :aria-label="mixLabel(row)"
                  :style="{ width: mixWidth(row) }"
                >
                  <span
                    v-for="kind in activityKinds"
                    v-show="row.counts[kind] > 0"
                    :key="kind"
                    class="contributors__mix-part"
                    :style="{
                      width: (row.counts[kind] / row.total) * 100 + '%',
                      backgroundColor: activityColors[kind],
                    }"
                  />
                </div>
              </td>
              <td
                v-for="kind in activityKinds"
                :key="kind"
                class="text-right stats-numeric d-none d-md-table-cell"
                :class="{ 'text-disabled': row.counts[kind] === 0 }"
              >
                {{ row.counts[kind] }}
              </td>
              <td class="text-right font-weight-medium stats-numeric">
                {{ row.total }}
              </td>
              <td class="text-right text-medium-emphasis text-no-wrap">
                {{ formatDaysAgo(row.lastActiveAt) }}
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiTrophyOutline } from "@mdi/js";
import {
  activityKinds,
  activityKindLabels,
  activityKindDescriptions,
} from "~~/shared/activity";
import type { ActivityContributor } from "~~/server/api/stats/activity.get";
import { activityColors, formatDaysAgo } from "~/utils/chartTheme";
import { polishCounting } from "~/composables/polish";

/** Who moved the data in the selected window, ranked.
 *
 * Only admins get names: `/api/stats/activity` withholds identities from
 * everybody else, on the same reasoning that makes `/api/users/lookup`
 * admin-only. What a non-admin sees is the head count, which says how alive the
 * project is without naming anyone.
 *
 * The per-row bar shows the mix of what a person did, in the same colours the
 * timeline uses, and its width scales with their total — so the ranking is
 * readable at a glance while the numbers stay in the columns beside it.
 */
const props = defineProps<{
  contributors: ActivityContributor[];
  identified: boolean;
  contributorCount: number;
  windowDays: number;
  loading?: boolean;
}>();

const subtitle = computed(() =>
  props.windowDays === 1
    ? "Zmiany z dzisiaj"
    : `Zmiany z ostatnich ${props.windowDays} dni`,
);

const topTotal = computed(() =>
  Math.max(1, ...props.contributors.map((row) => row.total)),
);

const mixWidth = (row: ActivityContributor) =>
  `${Math.max(6, (row.total / topTotal.value) * 100)}%`;

const mixLabel = (row: ActivityContributor) =>
  activityKinds
    .filter((kind) => row.counts[kind] > 0)
    .map((kind) => `${activityKindLabels[kind]}: ${row.counts[kind]}`)
    .join(", ");
</script>

<style scoped>
.contributors--stale {
  opacity: 0.45;
  transition: opacity 150ms ease;
}

.contributors__scroll {
  overflow-x: auto;
}

.contributors__mix {
  display: flex;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
  min-width: 8px;
}

/* The 2px gap in the surface colour, not a border, is what separates fills. */
.contributors__mix-part:not(:last-child) {
  margin-right: 2px;
}

.contributors__dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.stats-numeric {
  font-variant-numeric: tabular-nums;
}
</style>
