<template>
  <div style="display: contents">
    <v-autocomplete
      v-model="model"
      v-model:search="search"
      :label="props.label"
      :hint="props.hint"
      :items="items"
      :loading="loading"
      item-title="name"
      item-value="id"
      autocomplete="off"
      no-filter
      v-bind="$attrs"
      return-object
      required
      @update:focused="(val: boolean) => val && load()"
    >
      <!-- Rendered after the results and, when nothing matched, as the empty
         state - the entry you want may well be a different Jan Kowalski than
         the one that did match. -->
      <template #append-item>
        <template v-if="canCreate && createName">
          <v-divider class="my-1" />
          <v-list-item
            data-testid="entity-picker-add-new-entity"
            :prepend-icon="mdiPlus"
            @click="openCreate"
          >
            <v-list-item-title>
              Dodaj "<strong>{{ createName }}</strong
              >" do bazy.
            </v-list-item-title>
          </v-list-item>
        </template>
      </template>
      <template #no-data>
        <v-list-item v-if="loading">
          <v-list-item-title>Szukam...</v-list-item-title>
        </v-list-item>
        <v-list-item v-else-if="!search">
          <v-list-item-title>Zacznij pisać, aby wyszukać.</v-list-item-title>
        </v-list-item>
      </template>
    </v-autocomplete>

    <DialogProposeEditNode
      v-if="canCreate"
      ref="createDialog"
      :create-type="props.entity"
      :initial-name="pendingCreateName"
      hide-activator
      skip-redirect
      @created="onCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { mdiPlus } from "@mdi/js";
import { refDebounced } from "@vueuse/core";
import { useCurrentUser } from "vuefire";
import type { NodeType, Link, Article } from "~~/shared/model";

defineOptions({
  inheritAttrs: false,
});

const props = defineProps<{
  label?: string;
  hint?: string;
  entity: NodeType;
}>();

const model = defineModel<Link<NodeType> | undefined>();

const search = ref("");
const debouncedSearch = refDebounced(search, 300);
const loading = ref(false);
const results = ref<Link<NodeType>[]>([]);

const user = useCurrentUser();

/** Only a person or a place can be proposed from here: /api/revisions/create
 * validates against the person and company schemas and knows no other kind. */
const canCreate = computed(
  () => props.entity === "person" || props.entity === "place",
);

/** `/api/search` indexes people, places and regions by name prefix. Articles
 * are not in that index, so they are listed rather than searched. */
const isSearchable = computed(() => props.entity !== "article");

/** Every article, fetched once when the picker is first opened. Kept out of
 * setup so a form that never opens the source picker does not pay for it. */
const articles = ref<Link<NodeType>[] | null>(null);

async function loadArticles() {
  if (articles.value) return;
  try {
    const response = await $fetch<{ nodes: Record<string, Article> }>(
      "/api/nodes",
      { query: { type: "article" } },
    );
    articles.value = Object.entries(response.nodes)
      .filter(([, node]) => !!user.value || node.visibility !== false)
      .map(([id, node]) => ({
        type: "article" as NodeType,
        id,
        name: node.name,
      }));
  } catch (e) {
    console.error("Failed to list articles", e);
    articles.value = [];
  }
}

async function search_(term: string) {
  loading.value = true;
  try {
    const response = await $fetch<
      Array<{ id: string; name: string; type: string }>
    >("/api/search", { query: { q: term, latest: true } });
    results.value = response
      .filter((node) => node.type === props.entity)
      .map((node) => ({ type: props.entity, id: node.id, name: node.name }));
  } catch (e) {
    // A search that fails should offer nothing rather than spin forever.
    console.error("Search failed", e);
    results.value = [];
  } finally {
    loading.value = false;
  }
}

async function load() {
  if (isSearchable.value) {
    const term = (search.value || "").trim();
    if (term) await search_(term);
  } else {
    loading.value = true;
    await loadArticles();
    loading.value = false;
  }
}

watch(debouncedSearch, async (term) => {
  if (!isSearchable.value) return;
  const trimmed = (term || "").trim();
  if (!trimmed || trimmed === model.value?.name) {
    results.value = [];
    return;
  }
  await search_(trimmed);
});

const items = computed<Link<NodeType>[]>(() => {
  const base = isSearchable.value
    ? results.value
    : (articles.value ?? []).filter((article) =>
        article.name.toLowerCase().includes((search.value || "").toLowerCase()),
      );

  // The picked entry has to stay in the list, or the autocomplete has no title
  // to render for it once the search that found it has been cleared.
  const picked = model.value;
  if (picked && !base.some((item) => item.id === picked.id)) {
    return [...base, picked];
  }
  return base;
});

/** What to offer creating, empty while the results for it are still on the way:
 * otherwise "dodaj do bazy" flashes up as the only option during the debounce,
 * tempting people to add somebody who is already there. */
const createName = computed(() => {
  if (loading.value) return "";
  const settled = (debouncedSearch.value || "").trim();
  if (!settled || settled !== (search.value || "").trim()) return "";
  return settled;
});

// Captured on click, because opening the dialog blurs the autocomplete, which
// can reset `search` before the dialog reads the name to prefill.
const pendingCreateName = ref("");
const createDialog = ref<{ open: () => void } | null>(null);

function openCreate() {
  pendingCreateName.value = createName.value;
  createDialog.value?.open();
}

function onCreated(id: string) {
  const created = {
    type: props.entity,
    id,
    name: pendingCreateName.value,
  };
  results.value = [created];
  if (articles.value) articles.value = [created, ...articles.value];
  model.value = created;
  search.value = pendingCreateName.value;
}
</script>
