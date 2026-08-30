<template>
  <StatsChartCard :title="title" :subtitle="subtitle" :loading="loading">
    <template #chart>
      <ClientOnly>
        <apexchart
          v-if="rows.length > 0"
          type="bar"
          :height="height"
          :options="options"
          :series="series"
        />
        <div v-else class="text-body-2 text-medium-emphasis py-8 text-center">
          {{ emptyText }}
        </div>
        <template #fallback>
          <v-skeleton-loader type="image" :height="height" />
        </template>
      </ClientOnly>
    </template>

    <template #table>
      <v-table density="compact">
        <thead>
          <tr>
            <th class="text-left">Partia</th>
            <th class="text-right">Miejsca</th>
            <th class="text-right">Osoby</th>
            <th class="text-right">Szpitale</th>
            <th class="text-right">Udział</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.party">
            <td>
              <!-- PartyChip draws no fill at all for a party outside
                   `partyColors`, so anything outside it - including the bucket
                   for people with no party - gets a plain label and the dot
                   beside it instead, in the colour this table's own legend and
                   its bars already use. Without that, those rows would be bare
                   text in a column of painted chips. -->
              <PartyChip v-if="row.known" :party="row.party" />
              <span v-else class="d-flex align-center ga-2">
                <span
                  class="hospital-seats__dot"
                  :style="{ backgroundColor: row.color }"
                />
                {{ row.label }}
              </span>
            </td>
            <td class="text-right stats-numeric">
              {{ formatCount(row.seats) }}
            </td>
            <td class="text-right stats-numeric">
              {{ formatCount(row.people) }}
            </td>
            <td class="text-right stats-numeric">
              {{ formatCount(row.hospitals) }}
            </td>
            <td class="text-right stats-numeric">
              {{ row.share === null ? "—" : formatShare(row.share) }}
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="5" class="text-medium-emphasis text-center py-4">
              {{ emptyText }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </StatsChartCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PartyRow } from "~/composables/stats/useHospitalBoards";
import {
  barPlotOptions,
  baseChartOptions,
  formatCount,
  ink,
} from "~/utils/chartTheme";

/** Seats on one kind of supervisory board, by party.
 *
 * A horizontal bar because the labels are party names and there are a dozen of
 * them at most: sorted descending, the ranking is the message. Colour is
 * identity here - it is the party's own - which is the documented exception to
 * the palette, and the table view carries the numbers anyway, because PiS and
 * Konfederacja are two near-identical dark navies.
 */
const props = defineProps<{
  title: string;
  subtitle?: string;
  rows: PartyRow[];
  loading?: boolean;
  /** What to say instead of a chart when there is nothing to draw. */
  emptyText: string;
}>();

/** One row per party, so the bars keep their thickness whether there are three
 * of them or twelve. */
const height = computed(() => Math.max(220, props.rows.length * 44 + 72));

const series = computed(() => [
  { name: "Miejsca w radzie", data: props.rows.map((row) => row.seats) },
]);

const options = computed(() => {
  const base = baseChartOptions();
  const bar = barPlotOptions({ horizontal: true });
  return {
    ...base,
    ...bar,
    plotOptions: {
      bar: { ...bar.plotOptions.bar, distributed: true, barHeight: "70%" },
    },
    colors: props.rows.map((row) => row.color),
    // `distributed` gives every bar its own legend entry, which would just
    // repeat the axis labels.
    legend: { show: false },
    xaxis: {
      ...base.xaxis,
      categories: props.rows.map((row) => row.label),
      title: { text: "Miejsca w radzie", style: { color: ink.muted } },
    },
    tooltip: {
      ...base.tooltip,
      y: { title: { formatter: () => "Miejsca:" } },
    },
  };
});

/** One decimal below ten percent: the tail of this ranking is a party with two
 * seats out of five hundred, and "0%" reads as none. */
function formatShare(share: number): string {
  return new Intl.NumberFormat("pl-PL", {
    style: "percent",
    maximumFractionDigits: share < 0.1 ? 1 : 0,
  }).format(share);
}
</script>

<style scoped>
.stats-numeric {
  font-variant-numeric: tabular-nums;
}

.hospital-seats__dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: 0 0 auto;
}
</style>
