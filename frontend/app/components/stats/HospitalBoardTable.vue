<template>
  <v-card variant="outlined">
    <v-card-item>
      <v-card-title class="text-subtitle-1 font-weight-medium text-wrap">
        {{ title }}
      </v-card-title>
      <v-card-subtitle class="text-wrap">{{ subtitle }}</v-card-subtitle>
    </v-card-item>

    <v-card-text :class="{ 'hospital-table--stale': loading }">
      <div
        v-if="rows.length === 0"
        class="text-body-2 text-medium-emphasis py-8 text-center"
      >
        {{ emptyText }}
      </div>

      <div v-else class="hospital-table__scroll">
        <v-table density="compact">
          <thead>
            <tr>
              <th class="text-left">Szpital</th>
              <th class="text-left d-none d-md-table-cell">Organ nadzoru</th>
              <th class="text-left d-none d-lg-table-cell">Forma prawna</th>
              <th class="text-right">Miejsca</th>
              <th class="text-left">Partie</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td>
                <NuxtLink :to="row.to" class="hospital-table__link">
                  {{ row.name }}
                </NuxtLink>
                <div>
                  <NuxtLink
                    :to="row.peopleTo"
                    class="text-caption text-medium-emphasis hospital-table__link"
                  >
                    zobacz osoby
                  </NuxtLink>
                </div>
              </td>
              <td class="text-medium-emphasis d-none d-md-table-cell">
                {{ row.organ }}
              </td>
              <td class="text-medium-emphasis d-none d-lg-table-cell">
                {{ row.legalForm ?? "—" }}
              </td>
              <td class="text-right stats-numeric">
                {{ formatCount(row.seats) }}
              </td>
              <td>
                <div class="d-flex flex-wrap ga-1 align-center">
                  <template v-for="party in row.parties" :key="party.party">
                    <PartyChip v-if="party.known" :party="party.party" />
                    <span
                      v-else
                      class="text-caption text-medium-emphasis d-flex align-center ga-1"
                    >
                      <span
                        class="hospital-table__dot"
                        :style="{ backgroundColor: party.color }"
                      />
                      {{ party.label }}
                    </span>
                  </template>
                  <span
                    v-if="row.parties.length === 0"
                    class="text-caption text-medium-emphasis"
                  >
                    —
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import type { HospitalTableRow } from "~/composables/stats/useHospitalBoards";
import { formatCount } from "~/utils/chartTheme";

/** The hospitals behind the breakdown, one row each.
 *
 * Named institutions rather than a total, because the claim being made is about
 * particular boards and a reader has to be able to check it: every row links to
 * the institution's page and to the people the database has on its board.
 *
 * Only hospitals with a seat on record are listed - the card's subtitle is
 * where the ones without get counted, since an empty row says nothing about a
 * party but does bury the rows that do.
 */
defineProps<{
  title: string;
  subtitle: string;
  rows: HospitalTableRow[];
  loading?: boolean;
  emptyText: string;
}>();
</script>

<style scoped>
.hospital-table--stale {
  opacity: 0.45;
  transition: opacity 150ms ease;
}

.hospital-table__scroll {
  max-height: 560px;
  overflow-y: auto;
}

.hospital-table__link {
  color: inherit;
}

.hospital-table__dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.stats-numeric {
  font-variant-numeric: tabular-nums;
}
</style>
