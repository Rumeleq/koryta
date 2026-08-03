<template>
  <div class="pa-4">
    <div class="d-flex align-center justify-space-between flex-wrap ga-3 mb-2">
      <h1 class="text-h5 text-sm-h4">Administracja - Rewizje krawędzi</h1>
      <v-btn
        :icon="mdiRefresh"
        variant="text"
        size="small"
        :loading="pending"
        @click="fetchData"
      />
    </div>

    <p class="text-body-2 text-medium-emphasis mb-4">
      Zmiany krawędzi zaproponowane przez pipeline, których nikt jeszcze nie
      rozpatrzył. Pipeline zapisuje zmianę od razu tylko wtedy, gdy potrafi za
      nią ręczyć - komitet wyborczy z listy przypisanej do partii. Reszta czeka
      tutaj, a sama krawędź pozostaje nietknięta.
    </p>

    <v-card class="mb-4 pa-3">
      <v-select
        v-model="filterType"
        :items="typeOptions"
        label="Typ krawędzi"
        density="compact"
        variant="outlined"
        hide-details
        clearable
        style="max-width: 20rem"
      />
    </v-card>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      :text="error"
    />

    <v-card>
      <v-data-table-server
        v-model:items-per-page="itemsPerPage"
        v-model:page="page"
        :headers="headers"
        :items="items"
        :items-length="totalItems"
        :loading="pending"
        :items-per-page-options="[10, 25, 50, 100]"
        no-data-text="Nic nie czeka na rozpatrzenie."
        @update:options="fetchData"
      >
        <template #[`item.edge`]="{ item }">
          <div class="d-flex align-center flex-wrap ga-1 py-1">
            <NuxtLink v-if="item.source.type" :to="entityPath(item.source)">
              {{ item.source.name || item.source.id }}
            </NuxtLink>
            <span v-else class="text-medium-emphasis">{{
              item.source.id
            }}</span>
            <v-icon :icon="mdiArrowRight" size="x-small" class="mx-1" />
            <NuxtLink v-if="item.target.type" :to="entityPath(item.target)">
              {{ item.target.name || item.target.id }}
            </NuxtLink>
            <span v-else class="text-medium-emphasis">{{
              item.target.id
            }}</span>
          </div>
          <div class="text-caption text-medium-emphasis">
            {{ item.edgeType }}
            <span v-if="!item.published"> · niezatwierdzona</span>
          </div>
        </template>

        <template #[`item.changes`]="{ item }">
          <div class="py-2 d-flex flex-column ga-1">
            <div
              v-for="change in item.changes"
              :key="change.field"
              class="text-caption"
            >
              <span class="font-weight-bold">{{ change.field }}</span>
              <span v-if="change.from !== null" class="text-medium-emphasis">
                {{ " " }}{{ display(change.from) }} →
              </span>
              <span v-else class="text-medium-emphasis">{{ " " }}+</span>
              {{ " " }}{{ display(change.to) }}
            </div>
            <span v-if="!item.changes.length" class="text-medium-emphasis">
              Krawędź już to zawiera.
            </span>
          </div>
        </template>

        <template #[`item.updateTime`]="{ item }">
          <div>{{ formatDate(item.updateTime) }}</div>
          <div class="text-caption text-medium-emphasis">
            {{ item.automatic ? "pipeline" : item.updateUser }}
          </div>
        </template>
      </v-data-table-server>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { mdiArrowRight, mdiRefresh } from "@mdi/js";
import { useCurrentUser, useIsCurrentUserLoaded } from "vuefire";
import { useRoute } from "vue-router";
import { useQueryFilters } from "~/composables/queryFilters";
import type {
  PendingEdgeEndpoint,
  PendingEdgeRevision,
} from "~~/server/api/revisions/pendingEdges.get";

definePageMeta({
  middleware: "admin",
  fullWidth: true,
});

useHead({ title: "Rewizje krawędzi (Admin) - koryta.pl" });

const user = useCurrentUser();
const isAuthReady = useIsCurrentUserLoaded();
const route = useRoute();
const { setQuery } = useQueryFilters();

const DEFAULT_ITEMS_PER_PAGE = 25;

const itemsPerPage = ref(
  parseInt(
    (route.query.itemsPerPage as string) || String(DEFAULT_ITEMS_PER_PAGE),
  ),
);
const page = ref(parseInt((route.query.page as string) || "1"));
const filterType = ref<string | null>((route.query.type as string) || null);

// Every edge type the ingest can propose a change to. Only `election` produces
// any today; the rest are here so a later one does not need a code change to
// become filterable.
const typeOptions = [
  { title: "Kandydatura", value: "election" },
  { title: "Zatrudnienie", value: "employed" },
  { title: "Własność", value: "owns" },
  { title: "Powiązanie", value: "connection" },
];

const headers = [
  { title: "Krawędź", key: "edge", sortable: false },
  { title: "Proponowana zmiana", key: "changes", sortable: false },
  { title: "Zgłoszono", key: "updateTime", sortable: false },
];

const items = ref<PendingEdgeRevision[]>([]);
const totalItems = ref(0);
const pending = ref(false);
const error = ref<string | null>(null);

function entityPath(endpoint: PendingEdgeEndpoint) {
  return `/entity/${endpoint.type}/${endpoint.id}`;
}

/** A field value as one short line. The values are the scalars an edge carries
 * - a committee, a party, a date - so this is mostly about not printing
 * `[object Object]` if one ever is not. */
function display(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pl-PL");
}

const authHeaders = computed(() => user.value);

async function fetchData() {
  pending.value = true;
  error.value = null;
  try {
    if (!isAuthReady.value) {
      await new Promise<void>((resolve) => {
        const unwatch = watch(
          isAuthReady,
          (ready) => {
            if (ready) {
              unwatch();
              resolve();
            }
          },
          { immediate: true },
        );
      });
    }

    // authFetch only attaches a token to writes, and this is a GET behind an
    // admin claim, so the header goes on by hand - the same way /admin/rewizje
    // does it.
    const headersInit: HeadersInit = {};
    if (authHeaders.value) {
      headersInit["Authorization"] =
        `Bearer ${await authHeaders.value.getIdToken()}`;
    }

    const res = await $fetch<{
      revisions: PendingEdgeRevision[];
      total: number;
    }>("/api/revisions/pendingEdges", {
      params: {
        page: page.value,
        limit: itemsPerPage.value,
        type: filterType.value || undefined,
      },
      headers: headersInit,
    });

    items.value = res.revisions;
    totalItems.value = res.total;

    setQuery({
      page: page.value > 1 ? String(page.value) : undefined,
      itemsPerPage:
        itemsPerPage.value === DEFAULT_ITEMS_PER_PAGE
          ? undefined
          : String(itemsPerPage.value),
      type: filterType.value || undefined,
    });
  } catch (err) {
    console.error(err);
    error.value = "Nie udało się wczytać rewizji krawędzi.";
  } finally {
    pending.value = false;
  }
}

watch(filterType, () => {
  page.value = 1;
  fetchData();
});
</script>
