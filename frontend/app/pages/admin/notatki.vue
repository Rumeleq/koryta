<template>
  <div class="pa-4">
    <ExploreNodeDrawer
      v-model="openDrawer"
      :node="focusedNode"
      :edges="focusedEdges"
    />

    <h1 class="text-h4 mb-4">Wszystkie Notatki</h1>

    <v-card class="mb-4 pa-3">
      <v-row dense>
        <v-col cols="12" md="4">
          <v-text-field
            v-model="searchInput"
            label="Szukaj w treści, źródle i nazwie"
            :prepend-inner-icon="mdiMagnify"
            density="compact"
            variant="outlined"
            hide-details
            clearable
          />
        </v-col>
        <v-col cols="12" sm="6" md="2">
          <v-select
            v-model="filterNodeType"
            :items="nodeTypeFilterOptions"
            label="Typ węzła"
            density="compact"
            variant="outlined"
            hide-details
            clearable
          />
        </v-col>
        <v-col cols="12" sm="6" md="2">
          <v-select
            v-model="filterKind"
            :items="kindFilterOptions"
            label="Rodzaj"
            density="compact"
            variant="outlined"
            hide-details
            clearable
          />
        </v-col>
        <v-col cols="12" sm="6" md="2">
          <v-select
            v-model="filterAdminType"
            :items="adminTypeFilterOptions"
            label="Typ zgłoszenia"
            density="compact"
            variant="outlined"
            hide-details
            clearable
          />
        </v-col>
        <v-col cols="12" sm="6" md="2">
          <v-select
            v-model="filterStatus"
            :items="statusFilterOptions"
            label="Status"
            density="compact"
            variant="outlined"
            hide-details
            clearable
          />
        </v-col>
      </v-row>
    </v-card>

    <v-card>
      <v-data-table-server
        v-model:items-per-page="itemsPerPage"
        v-model:page="page"
        v-model:sort-by="sortBy"
        density="compact"
        :headers="headers"
        :items="items"
        :items-length="total"
        :loading="pending"
        item-value="key"
        no-data-text="Brak notatek"
        loading-text="Ładowanie..."
        items-per-page-text="Wierszy na stronę:"
      >
        <template #[`item.updatedAt`]="{ item }">
          <span class="text-no-wrap text-caption">
            {{ formatDate(item.updatedAt) }}
          </span>
        </template>

        <template #[`item.nodeName`]="{ item }">
          <div class="d-flex align-center ga-1">
            <v-icon
              :icon="item.nodeType ? nodeTypeIcons[item.nodeType] : mdiHelp"
              size="small"
              class="text-medium-emphasis"
            />
            <a class="text-primary cursor-pointer" @click="focusNode(item)">
              {{ item.nodeName ?? item.nodeId }}
            </a>
            <NuxtLink
              v-if="item.nodeName && item.nodeType"
              :to="generateEntityUrl(item.nodeType, item.nodeId, item.nodeName)"
              target="_blank"
            >
              <v-icon :icon="mdiOpenInNew" size="x-small" />
            </NuxtLink>
          </div>
        </template>

        <template #[`item.userUid`]="{ item }">
          <UserChip :uid="item.userUid" />
        </template>

        <template #[`item.kind`]="{ item }">
          <v-chip
            :color="noteKindConfig[item.kind].color"
            variant="tonal"
            size="small"
          >
            <v-icon start :icon="noteKindConfig[item.kind].icon" />
            {{ noteKindConfig[item.kind].title }}
          </v-chip>
        </template>

        <template #[`item.note`]="{ item }">
          <div class="note-cell py-1">
            <div class="note-text" :title="item.note">{{ item.note }}</div>
            <a
              v-if="item.url"
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-caption d-inline-flex align-center ga-1"
            >
              <v-icon :icon="mdiLink" size="x-small" />
              <span class="text-truncate d-inline-block note-url">{{
                item.url
              }}</span>
            </a>
          </div>
        </template>

        <template #[`item.adminStatus`]="{ item }">
          <v-menu>
            <template #activator="{ props: activator }">
              <v-chip
                v-bind="activator"
                :color="statusColors[item.adminStatus ?? 'none']"
                :disabled="saving[item.key]"
                variant="tonal"
                size="small"
              >
                {{ statusLabels[item.adminStatus ?? "none"] }}
              </v-chip>
            </template>
            <v-list density="compact">
              <v-list-item
                v-for="option in statusOptions"
                :key="option.value ?? 'none'"
                :title="option.title"
                @click="patchRow(item, { adminStatus: option.value })"
              />
            </v-list>
          </v-menu>
        </template>

        <template #[`item.adminType`]="{ item }">
          <v-menu>
            <template #activator="{ props: activator }">
              <v-chip
                v-bind="activator"
                :disabled="saving[item.key]"
                variant="outlined"
                size="small"
              >
                {{ adminTypeLabels[item.adminType ?? ""] ?? item.adminType }}
              </v-chip>
            </template>
            <v-list density="compact">
              <v-list-item
                v-for="option in adminTypeOptions"
                :key="option.value || 'none'"
                :title="option.title"
                @click="patchRow(item, { adminType: option.value })"
              />
            </v-list>
          </v-menu>
        </template>
      </v-data-table-server>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import {
  mdiAccountOutline,
  mdiFileDocumentOutline,
  mdiHelp,
  mdiLink,
  mdiMagnify,
  mdiMapMarkerRadiusOutline,
  mdiOfficeBuildingOutline,
  mdiOpenInNew,
} from "@mdi/js";
import { computed, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import { authRequest } from "~/composables/auth";
import { useEdges } from "~/composables/edges";
import { noteKindConfig } from "~/composables/notes";
import { useQueryFilters } from "~/composables/queryFilters";
import { generateEntityUrl } from "~/composables/slugs";
import type {
  NodeMaybeRich,
  NodeType,
  NoteAdminStatus,
  NoteRow,
  Node,
} from "~~/shared/model";

definePageMeta({
  middleware: "admin",
  fullWidth: true,
});

useHead({ title: "Notatki (Admin) - koryta.pl" });

const route = useRoute();
const { setQuery, stringFilter, numberFilter } = useQueryFilters({
  resetOnChange: ["page"],
});

const DEFAULT_ITEMS_PER_PAGE = 25;

const page = computed<number>({
  get: () => numberFilter("page").value ?? 1,
  set: (val) => void setQuery({ page: val > 1 ? String(val) : undefined }),
});

const itemsPerPage = computed<number>({
  get: () => numberFilter("itemsPerPage").value ?? DEFAULT_ITEMS_PER_PAGE,
  set: (val) =>
    void setQuery({
      itemsPerPage: val === DEFAULT_ITEMS_PER_PAGE ? undefined : String(val),
      page: undefined,
    }),
});

type SortEntry = { key: string; order: "asc" | "desc" };

// The queue is a queue: newest first unless the admin says otherwise, which is
// the one ordering the page could not offer before.
const sortBy = computed<SortEntry[]>({
  get: () => {
    const key = (route.query.sortBy as string | undefined) || "updatedAt";
    const order: "asc" | "desc" =
      route.query.sortBy && route.query.sortDesc !== "true" ? "asc" : "desc";
    return [{ key, order }];
  },
  set: (val) => {
    const sort = val[0];
    void setQuery({
      sortBy: sort?.key,
      sortDesc: sort ? String(sort.order === "desc") : undefined,
      page: undefined,
    });
  },
});

const filterKind = stringFilter("kind");
const filterStatus = stringFilter("status");
const filterAdminType = stringFilter("adminType");
const filterNodeType = stringFilter("nodeType");
const filterSearch = stringFilter("q");

// Typing runs ahead of the url so every keystroke does not push a history entry
// and a request.
const searchInput = ref(filterSearch.value);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchInput, (value) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filterSearch.value = value || null;
  }, 300);
});
watch(filterSearch, (value) => {
  if (value !== searchInput.value) searchInput.value = value;
});

const headers = [
  { title: "Data", key: "updatedAt", sortable: true, width: 140 },
  { title: "Węzeł", key: "nodeName", sortable: true },
  { title: "Autor", key: "userUid", sortable: false },
  { title: "Rodzaj", key: "kind", sortable: true },
  { title: "Notatka", key: "note", sortable: false },
  // Same order as the filters above the table, so the eye moves between the
  // two without re-reading the labels.
  { title: "Typ zgłoszenia", key: "adminType", sortable: false },
  { title: "Status", key: "adminStatus", sortable: true },
];

const kindFilterOptions = Object.entries(noteKindConfig).map(
  ([value, config]) => ({ title: config.title, value }),
);

const statusFilterOptions = [
  { title: "Bez statusu", value: "none" },
  { title: "Nierozwiązane", value: "unresolved" },
  { title: "Rozwiązane", value: "resolved" },
];

const nodeTypeLabels: Record<NodeType, string> = {
  person: "Osoba",
  place: "Instytucja",
  article: "Artykuł",
  region: "Region",
};

const nodeTypeIcons: Record<NodeType, string> = {
  person: mdiAccountOutline,
  place: mdiOfficeBuildingOutline,
  article: mdiFileDocumentOutline,
  region: mdiMapMarkerRadiusOutline,
};

const nodeTypeFilterOptions = Object.entries(nodeTypeLabels).map(
  ([value, title]) => ({ title, value }),
);

const statusLabels: Record<string, string> = {
  none: "Bez statusu",
  unresolved: "Nierozwiązane",
  resolved: "Rozwiązane",
};

const statusColors: Record<string, string> = {
  none: "grey",
  unresolved: "warning",
  resolved: "success",
};

const statusOptions: { title: string; value: NoteAdminStatus | null }[] = [
  { title: "Bez statusu", value: null },
  { title: "Nierozwiązane", value: "unresolved" },
  { title: "Rozwiązane", value: "resolved" },
];

const adminTypeLabels: Record<string, string> = {
  "": "Brak",
  missing_data: "Brakujące dane / Błąd",
  new_connection: "Nowe powiązanie",
  context: "Ciekawostka / Kontekst",
  other: "Inne",
};

const adminTypeOptions = Object.entries(adminTypeLabels).map(
  ([value, title]) => ({ title, value }),
);

const adminTypeFilterOptions = adminTypeOptions.filter(
  (option) => option.value !== "",
);

const items = ref<NoteRow[]>([]);
const total = ref(0);
const pending = ref(false);
const saving = ref<Record<string, boolean>>({});

const apiQuery = computed(() => ({
  page: page.value,
  limit: itemsPerPage.value,
  sortBy: sortBy.value[0]?.key ?? "updatedAt",
  sortDesc: sortBy.value[0]?.order === "asc" ? "false" : "true",
  kind: filterKind.value || undefined,
  status: filterStatus.value || undefined,
  adminType: filterAdminType.value || undefined,
  nodeType: filterNodeType.value || undefined,
  q: filterSearch.value || undefined,
}));

// Requests can land out of order once a filter and a page change chase each
// other, so only the newest one is allowed to write the table.
let latestRequest = 0;

const load = async () => {
  // The endpoint only answers a caller carrying an admin token, which the
  // server render has no way to present - it would spend a request on a 401.
  if (import.meta.server) return;

  const request = ++latestRequest;
  pending.value = true;
  try {
    const res = await authRequest<{ notes: NoteRow[]; total: number }>(
      "/api/notes/admin",
      { method: "GET", query: apiQuery.value },
    );
    if (request !== latestRequest) return;
    items.value = res.notes;
    total.value = res.total;
  } catch (error) {
    if (request !== latestRequest) return;
    console.error("Failed to load notes", error);
    items.value = [];
    total.value = 0;
  } finally {
    if (request === latestRequest) pending.value = false;
  }
};

watch(apiQuery, load, { immediate: true });

const patchRow = async (
  row: NoteRow,
  patch: { adminStatus?: NoteAdminStatus | null; adminType?: string | null },
) => {
  const previous = { adminStatus: row.adminStatus, adminType: row.adminType };
  // Applied straight away - the verdict is the whole point of the row, and
  // waiting on a round trip to see it makes triaging a page of them slow.
  Object.assign(row, patch);
  saving.value[row.key] = true;
  try {
    await authRequest("/api/notes/admin", {
      method: "POST",
      body: {
        noteId: row.noteId,
        sourceIndex: row.sourceIndex,
        ...patch,
      },
    });
  } catch (error) {
    console.error("Failed to update note admin data", error);
    Object.assign(row, previous);
  } finally {
    saving.value[row.key] = false;
  }
};

const openDrawer = shallowRef(false);
const focusedNode = shallowRef<NodeMaybeRich | undefined>(undefined);
const focusedNodeId = shallowRef<string | undefined>(undefined);
const { sources: focusedSources, targets: focusedTargets } =
  await useEdges(focusedNodeId);
const focusedEdges = computed(() => [
  ...focusedSources.value,
  ...focusedTargets.value,
]);

const focusNode = async (row: NoteRow) => {
  focusedNode.value = undefined;
  focusedNodeId.value = row.nodeId;
  openDrawer.value = true;

  try {
    // `latest` so a note written on a node nobody has approved yet still opens
    // instead of 404ing.
    const { node } = await $fetch<{ node: Node & { id?: string } }>(
      `/api/nodes/${row.nodeId}`,
      { query: { latest: "true" } },
    );
    if (focusedNodeId.value !== row.nodeId) return;
    focusedNode.value = { ...node, id: node.id ?? row.nodeId };
  } catch (error) {
    console.error(`Failed to fetch node ${row.nodeId}`, error);
  }
};

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString("pl-PL") : "-";
</script>

<style scoped>
.note-cell {
  min-width: 260px;
  max-width: 520px;
}

.note-text {
  white-space: pre-wrap;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.note-url {
  max-width: 320px;
  vertical-align: bottom;
}
</style>
