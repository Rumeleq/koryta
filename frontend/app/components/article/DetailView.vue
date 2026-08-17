<template>
  <div style="width: 100%">
    <v-card v-if="status !== 'success'" class="mb-4">
      <v-card-title>{{
        user ? "Nie udało się wczytać artykułu" : "Dostęp zastrzeżony"
      }}</v-card-title>
      <v-card-text class="pt-0">
        <p v-if="!user" class="mb-4">
          Ta strona nie została znaleziona lub oczekuje na zatwierdzenie.
          Niezaakceptowane strony są widoczne tylko dla zalogowanych
          użytkowników.
        </p>
        <v-alert v-else type="warning" variant="tonal" class="mb-4">
          Prawdopodobnie artykuł nie istnieje, został usunięty lub nie masz do
          niego dostępu.
        </v-alert>
        <v-btn v-if="!user" color="primary" @click="handleLoginRedirect()">
          Zaloguj się
        </v-btn>
        <v-btn
          v-else
          color="primary"
          variant="tonal"
          :prepend-icon="mdiRefresh"
          @click="refreshNode()"
        >
          Odśwież
        </v-btn>
      </v-card-text>
    </v-card>

    <v-card v-else width="100%">
      <div class="pa-4">
        <!-- 1. What this is, and where it came from -->
        <div class="d-flex align-start ga-3 mb-2">
          <v-avatar
            v-if="article?.sourceURL"
            :image="getDomainIcon(article.sourceURL)"
            size="32"
            class="mt-1"
          />
          <div class="flex-grow-1">
            <h1 class="text-h5 font-weight-bold text-wrap">
              {{ article?.name }}
            </h1>
            <div
              class="d-flex align-center flex-wrap ga-2 mt-1 text-caption text-medium-emphasis"
            >
              <a
                v-if="article?.sourceURL"
                :href="article.sourceURL"
                target="_blank"
                rel="noopener"
                class="d-inline-flex align-center"
              >
                {{ domain }}
                <v-icon :icon="mdiOpenInNew" size="x-small" class="ml-1" />
              </a>
              <span v-if="publishedDate">· {{ publishedDate }}</span>
              <span v-if="author">· {{ author }}</span>
              <v-chip v-if="!isPublished" size="x-small" variant="tonal">
                szkic
              </v-chip>
              <ArticleCaptureStatus v-if="capture" :capture="capture" />
            </div>
          </div>
        </div>

        <!-- 2. Which story it belongs to -->
        <v-divider class="my-3" />
        <h2 class="text-subtitle-1 font-weight-bold mb-2">Tematy</h2>
        <ArticleTopicChips
          :topics="topics"
          :can-edit="!!user"
          :saving="savingTopics"
          @add="addTopic"
          @remove="removeTopic"
        />
        <v-alert
          v-if="topicError"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-2"
        >
          {{ topicError }}
        </v-alert>

        <!-- 3. What the extractor made of it -->
        <v-divider class="my-4" />
        <h2 class="text-subtitle-1 font-weight-bold mb-2">Wydobyte fakty</h2>
        <ExploreLoginBanner
          v-if="!user"
          message="Zaloguj się, aby zobaczyć fakty wydobyte z tego artykułu przez model."
        />
        <template v-else>
          <div v-if="facts.length" data-testid="article-facts">
            <ExtractionCard
              v-for="fact in facts"
              :key="fact.id ?? fact.url"
              :fact="fact"
              class="mb-3"
            >
              <template #actions>
                <ExtractionVoteButtons v-if="fact.id" :id="fact.id" />
              </template>
            </ExtractionCard>
          </div>
          <v-alert v-else type="info" variant="tonal" density="compact">
            Z tego artykułu nie wydobyto jeszcze żadnych faktów.
          </v-alert>
        </template>

        <!-- 4. Who it talks about -->
        <template v-if="mentions.length">
          <v-divider class="my-4" />
          <h2 class="text-subtitle-1 font-weight-bold mb-2">
            Wspomniane osoby i instytucje
          </h2>
          <div class="d-flex flex-wrap ga-2">
            <v-chip
              v-for="mention in mentions"
              :key="mention.edgeId"
              :to="mentionUrl(mention)"
              :variant="mention.published ? 'tonal' : 'outlined'"
              :prepend-icon="
                mention.nodeType ? nodeTypeIcon[mention.nodeType] : undefined
              "
              size="small"
            >
              {{ mention.name ?? mention.nodeId }}
            </v-chip>
          </div>
        </template>

        <!-- 5. What rests on it, and adding to that -->
        <v-divider class="my-4" />
        <div class="d-flex align-center flex-wrap ga-2 mb-2">
          <h2 class="text-subtitle-1 font-weight-bold">
            Artykuł stanowi źródło dla
          </h2>
          <v-spacer />
          <v-btn
            color="primary"
            variant="tonal"
            size="small"
            :prepend-icon="mdiPlus"
            data-testid="article-add-sourced-edge"
            @click="openAddEdge()"
          >
            Dodaj powiązanie
          </v-btn>
        </div>
        <ArticleSourcedEdgeList
          :edges="sourcedEdges"
          :can-edit="!!user"
          :removing="detaching"
          @detach="detachSource"
        />

        <ArticleAddSourcedEdgeDialog
          v-if="article"
          v-model="addEdgeOpen"
          :article-id="nodeId"
          :article-name="article.name"
          @added="refreshSourced()"
        />

        <!-- 6. The people behind it -->
        <template v-if="graphNodeIds.length">
          <v-divider class="my-4" />
          <h2 class="text-subtitle-1 font-weight-bold mb-2">Graf powiązań</h2>
          <div
            style="
              height: 460px;
              width: 100%;
              position: relative;
              border: 1px solid #ccc;
            "
          >
            <LazyGraphContainer
              :key="graphNodeIds[0]"
              :focus-node-id="graphNodeIds[0]!"
              :max-depth="1"
            />
          </div>
        </template>

        <NoteEditor :node-id="nodeId" node-type="article" class="mt-4" />
      </div>

      <v-divider />

      <div v-if="user" class="pa-4">
        <CommentsSection :node-id="nodeId" />
      </div>
    </v-card>
  </div>
</template>

<script setup lang="ts">
/** Everything worth knowing about one article, on its own page.
 *
 * Split out of `EntityDetailView` rather than added to it: that component is
 * mostly person, place and region branching, and an article shares almost none
 * of it. It also could not have worked here - `useEdges` reads the local graph,
 * which drops every edge touching an article, so an article's own relations
 * have to come from `/api/articles/[id]/relations`.
 */
import { computed, ref } from "vue";
import { mdiOpenInNew, mdiPlus, mdiRefresh } from "@mdi/js";
import { useCurrentUser } from "vuefire";
import { authFetch, authRequest } from "~/composables/auth";
import { useDomainIcon } from "~/composables/useDomainIcon";
import { useExtractions } from "~/composables/extractions";
import { useCanCapture } from "~/composables/captures";
import { entityDescription, SOCIAL_CARD } from "~/composables/entitySeo";
import { generateEntityUrl } from "~/composables/slugs";
import { nodeTypeIcon } from "~~/shared/model";
import type { Article, Link, NodeType } from "~~/shared/model";
import type { ArticleCapture } from "~~/shared/capture";
import type {
  ArticleRelation,
  ArticleRelations,
} from "~~/server/api/articles/[id]/relations.get";
import type { SourcedEdge } from "~~/server/api/edges/byReference.get";
import CommentsSection from "@/components/comment/CommentsSection.vue";

const props = defineProps<{ nodeId: string }>();

const nodeId = props.nodeId;
const user = useCurrentUser();
const route = useRoute();
const router = useRouter();
const { getDomainIcon } = useDomainIcon();

function handleLoginRedirect() {
  router.push({ path: "/login", query: { redirect: route.fullPath } });
}

const {
  data: nodeResponse,
  status,
  refresh: refreshNode,
} = await authFetch<{ node: Article }>(`/api/nodes/${nodeId}`);

const article = computed(() => nodeResponse.value?.node);
const isPublished = computed(() => article.value?.published === true);

const domain = computed(() => {
  const url = article.value?.sourceURL;
  if (!url) return "";
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
});

const publishedDate = computed(() => {
  const raw = article.value?.publishedDate as unknown;
  if (!raw) return "";
  // Firestore timestamps arrive over SSR as `{ _seconds }`, and as an ISO
  // string once they have been through a revision.
  const seconds = (raw as { _seconds?: number })._seconds;
  const date = seconds ? new Date(seconds * 1000) : new Date(String(raw));
  return isNaN(date.getTime()) ? "" : date.toLocaleDateString("pl-PL");
});

/** The ld+json the scraper kept, when it named an author. Its shape varies by
 * publisher, so anything unrecognised is left out rather than guessed at. */
const author = computed(() => {
  const meta = article.value?.meta as { author?: unknown } | undefined;
  const raw = meta?.author;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const names = raw
      .map((entry) => (entry as { name?: string } | null)?.name)
      .filter((name): name is string => typeof name === "string");
    return names.join(", ");
  }
  return (raw as { name?: string } | undefined)?.name ?? "";
});

// The capture is datascience-only; anyone else simply gets no chip.
const canCapture = useCanCapture();
const capture = ref<ArticleCapture | undefined>(undefined);
watchEffect(async () => {
  if (!canCapture.value || !article.value?.sourceURL) return;
  try {
    const response = await authRequest<{ captures: ArticleCapture[] }>(
      "/api/pages",
      { method: "GET", query: { url: article.value.sourceURL, limit: 1 } },
    );
    capture.value = response.captures[0];
  } catch {
    capture.value = undefined;
  }
});

const { data: relations, refresh: refreshRelations } =
  await authFetch<ArticleRelations>(`/api/articles/${nodeId}/relations`);
const topics = computed(() => relations.value?.topics ?? []);
const mentions = computed(() => relations.value?.mentions ?? []);

const { data: sourcedResponse, refresh: refreshSourced } = await authFetch<{
  edges: SourcedEdge[];
}>("/api/edges/byReference", { query: { articleId: nodeId } });
const sourcedEdges = computed(() => sourcedResponse.value?.edges ?? []);

const { data: extractions } = useExtractions({
  articleUrl: computed(() => article.value?.sourceURL),
});
const facts = computed(() => extractions.value?.facts ?? []);

/** Which node the embedded graph is centred on.
 *
 * An article is not drawn in the graph at all, so centring on it renders an
 * empty canvas. The people this article puts on the record are the interesting
 * thing, so it centres on the first of them instead.
 */
const graphNodeIds = computed(() => {
  const fromEdges = sourcedEdges.value.flatMap((edge) => [
    edge.source,
    edge.target,
  ]);
  const fromMentions = mentions.value
    .filter((mention) => mention.nodeType !== "topic")
    .map((mention) => mention.nodeId);
  return Array.from(new Set([...fromEdges, ...fromMentions]));
});

function mentionUrl(mention: ArticleRelation) {
  return mention.nodeType && mention.name
    ? generateEntityUrl(mention.nodeType, mention.nodeId, mention.name)
    : undefined;
}

const savingTopics = ref(false);
const topicError = ref<string | null>(null);

async function changeTopics(body: { add?: string[]; remove?: string[] }) {
  savingTopics.value = true;
  topicError.value = null;
  try {
    await authRequest(`/api/articles/${nodeId}/topics`, {
      method: "POST",
      body,
    });
    await refreshRelations();
  } catch (e: unknown) {
    const data = (e as { data?: { message?: string } } | null)?.data;
    topicError.value =
      data?.message ||
      (e instanceof Error ? e.message : "") ||
      "Nie udało się zapisać tematu.";
  } finally {
    savingTopics.value = false;
  }
}

const addTopic = (topic: Link<NodeType>) => changeTopics({ add: [topic.id] });
const removeTopic = (topic: ArticleRelation) =>
  changeTopics({ remove: [topic.nodeId] });

const addEdgeOpen = ref(false);
function openAddEdge() {
  if (!user.value) {
    handleLoginRedirect();
    return;
  }
  addEdgeOpen.value = true;
}

const detaching = ref<string | null>(null);
async function detachSource(edge: SourcedEdge) {
  detaching.value = edge.id;
  try {
    await authRequest(`/api/edges/${edge.id}/references`, {
      method: "POST",
      body: { remove: [nodeId] },
    });
    await refreshSourced();
  } finally {
    detaching.value = null;
  }
}

const seoTitle = computed(() =>
  status.value === "success"
    ? (article.value?.name ?? "Artykuł")
    : "Strona nieznaleziona",
);

useSeoMeta({
  title: seoTitle,
  description: () =>
    article.value
      ? entityDescription(article.value, sourcedEdges.value.length)
      : null,
  ogTitle: seoTitle,
  ogType: "article",
  ogImage: SOCIAL_CARD,
  twitterCard: "summary_large_image",
  twitterImage: SOCIAL_CARD,
});
</script>
