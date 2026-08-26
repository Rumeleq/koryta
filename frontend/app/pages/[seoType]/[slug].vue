<template>
  <!-- An article has a page of its own. `EntityDetailView` could not serve it:
       every section it renders for an article reads the local graph, which
       drops any edge with an article on either end. -->
  <ArticleDetailView v-if="type === 'article'" :key="id" :node-id="id" />
  <!-- A company gets its own view for the same reason an article does: every
       section it wants - the register entry, who sits there now, who they took
       over from - is about a place, and none of them means anything on a
       person's page. -->
  <PlaceDetailView v-else-if="type === 'place'" :key="id" :node-id="id" />
  <EntityDetailView v-else :key="id" :node="id" :type="type" />
</template>

<script setup lang="ts">
import {
  parseEntityUrlSlug,
  slugPrefixToNodeType,
  generateNodeUrl,
  seoTypes,
  SLUG_REDIRECT_CODE,
  type SeoType,
} from "~/composables/slugs";
import type { NodeType, Node } from "~~/shared/model";
import { authFetch } from "@/composables/auth";

definePageMeta({
  validate: (route) => {
    return seoTypes.includes(route.params.seoType as SeoType);
  },
});

const route = useRoute();
const { id } = parseEntityUrlSlug(route.params.slug as string);
const type = slugPrefixToNodeType(route.params.seoType as SeoType) as NodeType;

// Self-healing check
const { data, status } = await authFetch<{ node: Node }>(`/api/nodes/${id}`);

if (status.value === "success" && data.value?.node?.name) {
  const expectedUrl = generateNodeUrl(data.value.node);
  // A node type with no canonical url of its own stays where it is. Without the
  // guard the undefined fell through to navigateTo and redirected the visitor to
  // the site root, which is where every article link in the sitemap used to land.
  if (expectedUrl && route.path !== expectedUrl) {
    if (import.meta.server) {
      await navigateTo(expectedUrl, { redirectCode: SLUG_REDIRECT_CODE });
    } else {
      await navigateTo(expectedUrl, { replace: true });
    }
  }
}

// The head is EntityDetailView's - it is the one that knows whether the node
// loaded, and it sets the description and the social card alongside the title.
</script>
