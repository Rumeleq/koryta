<template>
  <div class="d-flex flex-column ga-1 py-2">
    <div class="d-flex align-center ga-2">
      <!-- Both actions live on the title line. The magnifier the desktop row
           carries is not repeated: tapping the name is the same thing, and a
           phone has no hover to make the difference discoverable anyway. -->
      <div class="flex-grow-1" style="min-width: 0">
        <span
          v-if="disableFocus"
          class="text-primary font-weight-bold text-body-1"
        >
          {{ item.name }}
        </span>
        <NuxtLink
          v-else
          class="text-primary font-weight-bold text-body-1 cursor-pointer"
          @click="emit('focus', item)"
        >
          {{ item.name }}
        </NuxtLink>
      </div>

      <ButtonVoteNumber
        :id="item.id"
        category="interesting"
        @voted="emit('action:voted', item)"
      />

      <v-btn
        :icon="mdiOpenInNew"
        variant="text"
        color="secondary"
        density="comfortable"
        aria-label="Otwórz wyszukiwania w nowych kartach"
        @click.stop="
          executeSearchAll(item, region, company);
          emit('action:explored', item);
          if (!disableFocus) emit('focus', item);
        "
      />
    </div>

    <div
      v-if="item.parties?.length || showVisibility"
      class="d-flex flex-wrap align-center ga-1"
    >
      <v-chip v-for="party in item.parties" :key="party" size="x-small">
        {{ party }}
      </v-chip>
      <v-chip
        v-if="showVisibility"
        size="x-small"
        :color="item.visibility ? 'success' : 'warning'"
        variant="tonal"
      >
        {{ item.visibility ? "Opublikowane" : "Szkic" }}
      </v-chip>
    </div>

    <ExploreTableCompanyChips
      v-if="item.companies?.length"
      :companies="item.companies"
      size="x-small"
      max-width="100%"
    />

    <ExploreTableElectionChips
      v-if="item.elections?.length"
      :elections="item.elections"
      size="x-small"
    />

    <div v-if="facts.length" class="text-caption text-medium-emphasis">
      {{ facts.join(" · ") }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { mdiOpenInNew } from "@mdi/js";
import { computed } from "vue";
import { executeSearchAll } from "~/composables/usePersonSearch";
import { polishCounting } from "~/composables/polish";
import type { PersonRich } from "~~/shared/model";

const props = withDefaults(
  defineProps<{
    item: PersonRich;
    region?: [string, string];
    company?: [string, string];
    disableFocus?: boolean;
    /** Whether the reader may see draft pages, and so whether saying which is
     * a draft tells them anything. */
    showVisibility?: boolean;
  }>(),
  {
    region: undefined,
    company: undefined,
    disableFocus: false,
    showVisibility: false,
  },
);

const emit = defineEmits<{
  (e: "action:explored" | "action:voted" | "focus", item: PersonRich): void;
}>();

/** The numeric columns, folded into one line. Each is worth a whole column on a
 * desktop table and none is worth a whole row on a phone, so they read as a
 * sentence - and a zero is left out rather than repeated four times down the
 * page. */
const facts = computed(() => {
  const out: string[] = [];
  const { experience, latestEmploymentStart, stats } = props.item;

  if (experience) {
    out.push(
      polishCounting(experience, "rok pracy", "lata pracy", "lat pracy"),
    );
  }
  if (latestEmploymentStart) {
    out.push(`ostatnie zatrudnienie: ${latestEmploymentStart}`);
  }
  if (stats?.notesCount) {
    out.push(polishCounting(stats.notesCount, "notatka", "notatki", "notatek"));
  }
  if (stats?.votes?.interesting) {
    out.push(
      polishCounting(stats.votes.interesting, "głos", "głosy", "głosów"),
    );
  }
  return out;
});
</script>
