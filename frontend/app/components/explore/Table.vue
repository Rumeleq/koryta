<template>
  <v-data-table-server
    :items-per-page="itemsPerPage"
    :page="page"
    :sort-by="sortBy"
    fixed-header
    :headers="headers"
    :items="items"
    :items-length="totalItems"
    :loading="pending"
    :no-data-text="noDataText"
    :hide-default-footer="hideDefaultFooter"
    :mobile="mobile"
    class="explore-table"
    @update:page="$emit('update:page', $event)"
    @update:items-per-page="$emit('update:itemsPerPage', $event)"
    @update:sort-by="$emit('update:sortBy', $event)"
    @update:options="$emit('update:options', $event)"
  >
    <template #[`header.experience`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Sumaryczna liczba lat przepracowanych w publicznych spółkach"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.latestEmploymentStart`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Najnowsza data rozpoczęcia zatrudnienia w publicznej spółce"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.notesCount`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Liczba notatek stworzonych przez społeczność na temat powiązań tej osoby"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.votes.interesting`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Suma głosów społeczności określających jak interesująca jest ta osoba"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.userVote`]="{ column }">
      <ExploreTableColumnHeader
        :tooltip="userVoteTooltip"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.visibility`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Czy strona osoby jest już opublikowana, czy jest w fazie szkicu (widoczna tylko dla zalogowanych)"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <template #[`header.explore`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Wyświetla panel boczny z większą ilością informacji i opcją interakcji"
        :column="column"
        :sort-by="sortBy"
      />
    </template>

    <!-- One card per person below the breakpoint. The eleven columns cannot be
         made to fit a phone, and stacking them as eleven labelled lines each
         buries the two that matter - who this is and where they worked - under
         nine zeroes. -->
    <template v-if="mobile" #item="{ item }">
      <tr class="explore-table__mobile-row">
        <td>
          <ExploreTableMobileCard
            :item="item"
            :region="region"
            :company="company"
            :disable-focus="disableFocus"
            :show-visibility="showsVisibility"
            @focus="$emit('focus', $event)"
            @action:voted="$emit('action:voted', $event)"
            @action:explored="$emit('action:explored', $event)"
          />
        </td>
      </tr>
    </template>

    <template #[`item.name`]="{ item }">
      <div style="max-width: 150px">
        <template v-if="disableFocus">
          <span class="text-primary font-weight-bold">
            {{ item.name }}
          </span>
        </template>
        <template v-else>
          <NuxtLink
            class="text-primary cursor-pointer"
            @click="$emit('focus', item)"
          >
            {{ item.name }}
          </NuxtLink>
        </template>
      </div>
    </template>

    <template #[`item.parties`]="{ item }">
      <v-chip
        v-for="party in item.parties"
        :key="party"
        size="small"
        class="mr-1"
      >
        {{ party }}
      </v-chip>
    </template>

    <template #[`item.companies`]="{ item }">
      <ExploreTableCompanyChips
        :companies="item.companies"
        style="max-width: 300px"
      />
    </template>

    <template #[`item.elections`]="{ item }">
      <ExploreTableElectionChips :elections="item.elections" />
    </template>

    <template #[`item.visibility`]="{ item }">
      <v-chip
        size="small"
        :color="item.visibility ? 'success' : 'warning'"
        variant="tonal"
      >
        {{ item.visibility ? "Opublikowane" : "Szkic" }}
      </v-chip>
    </template>

    <template #[`item.notesCount`]="{ item }">
      {{ item.stats?.notesCount || 0 }}
    </template>

    <template #[`item.votes.interesting`]="{ item }">
      {{ item.stats?.votes?.interesting || 0 }}
    </template>

    <template #[`item.userVote`]="{ item }">
      <ButtonVoteNumber
        :id="item.id"
        category="interesting"
        @voted="$emit('action:voted', item)"
      />
    </template>

    <template #[`item.explore`]="{ item }">
      <div class="d-flex flex-nowrap">
        <v-tooltip
          text="Otwiera wiele kart wyszukiwania jednocześnie. Upewnij się, że blokowanie okienek (pop-up) jest wyłączone."
          open-delay="2000"
          location="top"
        >
          <template #activator="{ props: exploreProps }">
            <v-btn
              v-bind="exploreProps"
              :icon="mdiOpenInNew"
              variant="text"
              color="secondary"
              @click.stop="
                executeSearchAll(item, region, company);
                $emit('action:explored', item);
                if (!disableFocus) $emit('focus', item);
              "
            />
          </template>
        </v-tooltip>
        <v-btn
          v-if="!disableFocus"
          :icon="mdiMagnify"
          variant="text"
          color="primary"
          @click.stop="$emit('focus', item)"
        />
      </div>
    </template>
  </v-data-table-server>
</template>

<script setup lang="ts">
import { mdiMagnify, mdiOpenInNew } from "@mdi/js";
import { computed } from "vue";
import { useDisplay } from "vuetify";
import { executeSearchAll } from "~/composables/usePersonSearch";
import { voteScaleSummary } from "~/composables/votes";
import type { PersonRich } from "~~/shared/model";

const userVoteTooltip = [
  "Twój osobisty głos dla tej osoby (widoczny tylko dla Ciebie).",
  voteScaleSummary("interesting"),
]
  .filter(Boolean)
  .join(" ");

const props = withDefaults(
  defineProps<{
    items: PersonRich[];
    totalItems: number;
    pending: boolean;
    page?: number;
    itemsPerPage?: number;
    sortBy?: { key: string; order: "asc" | "desc" }[];
    headers: Record<string, unknown>[];
    /** Left to Vuetify's Polish locale unless a caller has something more
     * specific to say about why this particular table is empty. */
    noDataText?: string;
    hideDefaultFooter?: boolean;
    region?: [string, string];
    company?: [string, string];
    disableFocus?: boolean;
  }>(),
  {
    page: 1,
    itemsPerPage: 10,
    sortBy: () => [],
    noDataText: undefined,
    hideDefaultFooter: false,
    disableFocus: false,
    region: undefined,
    company: undefined,
  },
);

defineEmits<{
  (e: "update:page" | "update:itemsPerPage", val: number): void;
  (e: "update:sortBy", val: { key: string; order: "asc" | "desc" }[]): void;
  (
    e: "update:options",
    val: {
      sortBy: { key: string; order: string }[];
      page: number;
      itemsPerPage: number;
    },
  ): void;
  (e: "action:explored" | "action:voted" | "focus", item: PersonRich): void;
}>();

// Vuetify's own mobile switch is `mobile-breakpoint`, but the card needs to
// know too, and reading the same breakpoint here keeps the two in step.
const { mobile } = useDisplay({ mobileBreakpoint: "md" });

/** Whether the caller asked for the draft/published column, which only the
 * signed in get. The card shows the same chip on the same condition. */
const showsVisibility = computed(() =>
  props.headers.some((header) => header.key === "visibility"),
);
</script>

<style scoped>
/* The card is the whole row and brings its own vertical rhythm, so the cell
   only supplies the gutters. */
.explore-table__mobile-row > td {
  padding: 0 12px;
}
</style>
