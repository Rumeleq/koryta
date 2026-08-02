<template>
  <div class="pa-4">
    <div class="d-flex align-start flex-wrap ga-4 mb-6">
      <div class="flex-grow-1">
        <h1 class="text-h4 mb-1">Statystyki</h1>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Ile jest w bazie, ile z tego ktoś już sprawdził i co się w niej
          ostatnio działo.
        </p>
      </div>
      <v-btn
        to="/eksploruj/nowe"
        color="primary"
        variant="tonal"
        :prepend-icon="mdiArrowRight"
      >
        Pomóż sprawdzać
      </v-btn>
    </div>

    <v-alert
      v-if="databaseError"
      type="error"
      variant="tonal"
      class="mb-4"
      text="Nie udało się pobrać stanu bazy."
    />

    <!-- ------------------------------------------------------------------ -->
    <h2 class="text-h6 mb-3">Stan bazy</h2>

    <v-card variant="outlined" class="mb-4">
      <v-card-text>
        <v-skeleton-loader v-if="!database" type="heading, text" />
        <div v-else class="d-flex flex-wrap align-end ga-8">
          <div>
            <div class="text-caption text-medium-emphasis mb-1">
              Osoby w bazie
            </div>
            <div class="stats-hero">
              {{ formatCount(database.people.total) }}
            </div>
            <div class="text-body-2 text-medium-emphasis">
              {{ formatPercent(checkedPeople, database.people.total) }} z nich
              ktoś już sprawdził
            </div>
          </div>

          <v-divider vertical class="d-none d-sm-block" />

          <StatsStatTile
            v-for="tile in inventoryTiles"
            :key="tile.label"
            v-bind="tile"
          />
        </div>
      </v-card-text>
    </v-card>

    <v-row class="mb-2">
      <v-col cols="12" md="6">
        <v-card variant="outlined" height="100%">
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-medium">
              Postęp weryfikacji osób
            </v-card-title>
            <v-card-subtitle class="text-wrap">
              Każda osoba jest w dokładnie jednym z trzech stanów.
            </v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <v-skeleton-loader v-if="!database" type="text@2" />
            <template v-else>
              <StatsCompositionBar
                :segments="peopleSegments"
                summary="Podział osób według stanu weryfikacji"
              />
              <div class="text-caption text-medium-emphasis mt-3">
                z głosami: {{ formatCount(database.people.withVotes) }} · z
                notatkami: {{ formatCount(database.people.withNotes) }} ·
                zatrudnionych publicznie:
                {{ formatCount(database.people.withPublicEmployment) }} (w tym
                {{ formatCount(database.people.currentlyEmployed) }} obecnie)
              </div>
            </template>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card variant="outlined" height="100%">
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-medium">
              Co wiadomo o miejscach
            </v-card-title>
            <v-card-subtitle class="text-wrap">
              „Nie wiadomo” to nie to samo co „prywatne” — KRS o większości
              spółek akcyjnych milczy.
            </v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <v-skeleton-loader v-if="!database" type="text@2" />
            <StatsCompositionBar
              v-else
              :segments="placeSegments"
              summary="Podział miejsc według wiedzy o własności"
            />
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-row class="mb-2">
      <v-col cols="12" md="6">
        <v-card variant="outlined" height="100%">
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-medium">
              Zgłoszenia od czytelników
            </v-card-title>
            <v-card-subtitle class="text-wrap">
              Wpisy w notatkach, po rodzaju.
            </v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <v-skeleton-loader v-if="!database" type="text@2" />
            <template v-else>
              <StatsCompositionBar
                :segments="noteSegments"
                summary="Podział wpisów w notatkach według rodzaju"
              />
              <div class="text-caption text-medium-emphasis mt-3">
                {{ formatCount(database.notes.notes) }} notatek na
                {{ formatCount(database.notes.annotatedNodes) }} stronach ·
                nierozwiązanych: {{ formatCount(database.notes.unresolved) }} ·
                nietkniętych przez administratora:
                {{ formatCount(database.notes.untriaged) }}
              </div>
            </template>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card variant="outlined" height="100%">
          <v-card-item>
            <v-card-title class="text-subtitle-1 font-weight-medium">
              Kolejka administratora
            </v-card-title>
            <v-card-subtitle class="text-wrap">
              Co czeka na decyzję.
            </v-card-subtitle>
          </v-card-item>
          <v-card-text>
            <v-skeleton-loader v-if="!database" type="text@2" />
            <div v-else class="d-flex flex-wrap ga-8">
              <StatsStatTile
                v-for="tile in queueTiles"
                :key="tile.label"
                v-bind="tile"
              />
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-row class="mb-6">
      <v-col cols="12" md="6">
        <StatsVoteDistribution
          title="Rozkład ocen: Dobre znalezisko"
          category="interesting"
          :counts="database?.votes.distribution.interesting"
          :loading="databasePending"
        />
      </v-col>
      <v-col cols="12" md="6">
        <StatsVoteDistribution
          title="Rozkład ocen: Znaleziony problem"
          category="quality"
          :counts="database?.votes.distribution.quality"
          :loading="databasePending"
        />
      </v-col>
    </v-row>

    <!-- ------------------------------------------------------------------ -->
    <div class="d-flex align-center flex-wrap ga-3 mb-3">
      <h2 class="text-h6 mb-0">Aktywność</h2>
      <v-spacer />
      <!-- One filter row, above everything it scopes: the range below changes
           the timeline, the tiles and the ranking together. -->
      <v-btn-toggle
        v-model="days"
        density="compact"
        variant="outlined"
        divided
        mandatory
      >
        <v-btn v-for="range in RANGES" :key="range" :value="range" size="small">
          {{ range }} dni
        </v-btn>
      </v-btn-toggle>
    </div>

    <v-alert
      v-if="activityError"
      type="error"
      variant="tonal"
      class="mb-4"
      text="Nie udało się pobrać aktywności."
    />

    <v-alert
      v-if="activity?.truncated.length"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-4"
      :text="truncatedMessage"
    />

    <v-card variant="outlined" class="mb-4">
      <v-card-text>
        <v-skeleton-loader v-if="!activity" type="text@2" />
        <div v-else class="d-flex flex-wrap ga-8">
          <StatsStatTile
            v-for="tile in activityTiles"
            :key="tile.label"
            v-bind="tile"
          />
        </div>
      </v-card-text>
    </v-card>

    <StatsActivityTimeline
      class="mb-4"
      :daily="activity?.daily ?? []"
      :loading="activityPending"
    />

    <StatsContributorTable
      :contributors="activity?.contributors ?? []"
      :identified="activity?.identified ?? false"
      :contributor-count="activity?.contributorCount ?? 0"
      :window-days="days"
      :loading="activityPending"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { mdiArrowRight } from "@mdi/js";
import {
  activityKinds,
  activityKindLabels,
  activityKindDescriptions,
} from "~~/shared/activity";
import type { DatabaseStats } from "~~/server/api/stats/database.get";
import type { ActivityStats } from "~~/server/api/stats/activity.get";
import { authRequest, useAuthState } from "~/composables/auth";
import { polishCounting } from "~/composables/polish";
import {
  activityColors,
  categorical,
  formatCount,
  formatPercent,
  ink,
  status as statusColors,
} from "~/utils/chartTheme";

useHead({ title: "Statystyki - koryta.pl" });

const RANGES = [7, 30, 90] as const;

const { isAdmin } = useAuthState();

/** The state of the database does not depend on who is asking or on the
 * selected range, so it is fetched once and server-rendered. */
const {
  data: database,
  pending: databasePending,
  error: databaseError,
} = await useFetch<DatabaseStats>("/api/stats/database");

/** Activity carries identities for admins, so it has to go out with the user's
 * token — which means the browser, after auth has settled. Lazy on purpose:
 * the state of the database is already rendered and should not wait for it. */
const days = ref<number>(30);
const {
  data: activity,
  pending: activityPending,
  error: activityError,
} = useAsyncData<ActivityStats>(
  "stats-activity",
  () =>
    authRequest<ActivityStats>("/api/stats/activity", {
      method: "GET",
      query: { days: days.value },
    }),
  { server: false, lazy: true, watch: [days] },
);

const checkedPeople = computed(
  () =>
    (database.value?.people.approved ?? 0) +
    (database.value?.people.reviewed ?? 0),
);

const inventoryTiles = computed(() => {
  const db = database.value;
  if (!db) return [];
  return [
    { label: "Miejsca", value: db.nodes.places, hint: "spółki i instytucje" },
    { label: "Artykuły", value: db.nodes.articles, hint: "źródła prasowe" },
    { label: "Powiązania", value: db.edges, hint: "krawędzie w grafie" },
    { label: "Regiony", value: db.nodes.regions },
    {
      label: "Oceny",
      value: db.votes.total,
      hint: `oddane przez ${polishCounting(db.votes.voters, "osobę", "osoby", "osób")}`,
    },
    {
      label: "Fakty z ekstrakcji",
      value: db.extractions.total,
      hint: `${formatCount(db.extractions.reviewed)} już ocenionych`,
      to: "/ekstrakcje",
    },
  ];
});

const peopleSegments = computed(() => {
  const people = database.value?.people;
  if (!people) return [];
  return [
    {
      key: "approved",
      label: "Opublikowane",
      value: people.approved,
      color: statusColors.good,
      to: "/eksploruj/tabela?visibility=public",
    },
    {
      key: "reviewed",
      label: "Sprawdzone, nieopublikowane",
      value: people.reviewed,
      color: categorical[0],
      to: "/eksploruj/tabela?visibility=private&hideVoted=has_votes",
    },
    {
      key: "toCheck",
      label: "Do sprawdzenia",
      value: people.toCheck,
      color: ink.track,
      labelColor: ink.secondary,
      to: "/eksploruj/tabela?visibility=private&hideVoted=no_votes",
    },
  ];
});

const placeSegments = computed(() => {
  const places = database.value?.places;
  if (!places) return [];
  return [
    {
      key: "public",
      label: "Sektor publiczny",
      value: places.publicSector,
      color: categorical[0],
    },
    {
      key: "private",
      label: "Potwierdzone prywatne",
      value: places.confirmedPrivate,
      color: categorical[1],
    },
    {
      key: "unknown",
      label: "Nie wiadomo",
      value: places.unknown,
      color: ink.track,
      labelColor: ink.secondary,
    },
  ];
});

const noteSegments = computed(() => {
  const notes = database.value?.notes;
  if (!notes) return [];
  return [
    {
      key: "source",
      label: "Źródła",
      value: notes.byKind.source,
      color: categorical[0],
    },
    {
      key: "change_request",
      label: "Prośby o poprawkę",
      value: notes.byKind.change_request,
      color: categorical[1],
    },
    {
      key: "missing",
      label: "Brakujące dane",
      value: notes.byKind.missing,
      color: categorical[2],
    },
  ];
});

/** The counts are public; the pages that act on them are not, so only an admin
 * gets a tile that goes anywhere. */
const queueTiles = computed(() => {
  const db = database.value;
  if (!db) return [];
  return [
    {
      label: "Strony z niezaakceptowaną zmianą",
      value: db.revisions.unapprovedNodes,
      to: isAdmin.value ? "/admin/rewizje" : undefined,
    },
    {
      label: "Nierozwiązane zgłoszenia",
      value: db.notes.unresolved,
      to: isAdmin.value ? "/admin/notatki" : undefined,
    },
    {
      label: "Nieocenione fakty",
      value: db.extractions.total - db.extractions.reviewed,
      to: "/ekstrakcje",
    },
  ];
});

/** One tile per interaction kind — the direct answer to "jakie zmiany", in the
 * same colours the timeline stacks them in. */
const activityTiles = computed(() => {
  const stats = activity.value;
  if (!stats) return [];
  return activityKinds.map((kind) => ({
    label: activityKindLabels[kind],
    value: stats.totals[kind],
    hint: formatPercent(stats.totals[kind], stats.total),
    tooltip: activityKindDescriptions[kind],
    color: activityColors[kind],
  }));
});

const truncatedMessage = computed(() => {
  const kinds = activity.value?.truncated ?? [];
  const names = kinds.map((kind) => activityKindLabels[kind]).join(", ");
  return `Za dużo zdarzeń w tym okresie, żeby policzyć wszystkie: ${names}. Pokazane liczby są dolną granicą — skróć zakres, żeby zobaczyć pełne dane.`;
});
</script>

<style scoped>
.stats-hero {
  /* The one hero figure on the page. Same sans as everything else, and
     proportional figures — tabular-nums makes a big number look loose. */
  font-size: 3rem;
  line-height: 1.05;
  font-weight: 600;
}
</style>
