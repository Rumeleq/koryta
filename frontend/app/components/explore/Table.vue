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
    :items-per-page-text="itemsPerPageText"
    :items-per-page-options="itemsPerPageOptions"
    :no-data-text="noDataText"
    :loading-text="loadingText"
    :hide-default-footer="hideDefaultFooter"
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
        tooltip="Firmy, w których osoba pracowała, i wybory, w których startowała. Sortowanie po dacie ostatniego zatrudnienia w publicznej spółce; w menu kolumny także po sumarycznej liczbie lat pracy."
        :column="column"
        :sort-by="sortBy"
        :sort-options="EMPLOYMENT_SORT_OPTIONS"
        @sort="sortOn"
      />
    </template>

    <template #[`header.elections`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Wybory, w których osoba startowała. Najedź na żeton, by zobaczyć miejscowość, województwo i komitet."
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

    <!-- `header.stats.votes.interesting`, not `header.votes.interesting`:
         Vuetify looks a header slot up as `header.${column.key}`, and the key
         /eksploruj/tabela declares is `stats.votes.interesting`. Under the old
         name the slot matched no column at all, so the tooltip below was never
         on the page - the header fell through to Vuetify's default, which
         prints the title and nothing that says what the number counts. -->
    <template #[`header.stats.votes.interesting`]="{ column }">
      <ExploreTableColumnHeader
        tooltip="Suma głosów społeczności określających jak interesująca jest ta osoba. W menu kolumny można sortować także po liczbie notatek."
        :column="column"
        :sort-by="sortBy"
        :sort-options="VOTES_SORT_OPTIONS"
        @sort="sortOn"
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

    <!-- Who the person is: the name and the parties they have stood for, in
         one cell. They were two columns, which on a phone meant two ~60px
         boxes and a party ellipsised after six letters. A wrapping flex row
         gets both readings out of one rule - the chips sit beside a short
         name and drop under a long one - and the column can afford to be wide
         because there are now two of them rather than four. -->
    <template #[`item.name`]="{ item }">
      <div class="name-cell">
        <div class="d-flex flex-wrap align-center ga-1">
          <template v-if="disableFocus">
            <span class="text-primary font-weight-bold">
              {{ item.name }}
            </span>
          </template>
          <template v-else>
            <!-- `text-primary cursor-pointer` on the link is load-bearing:
                 five e2e specs use it as their "the table has loaded"
                 locator. -->
            <NuxtLink
              class="text-primary cursor-pointer"
              @click="$emit('focus', item)"
            >
              {{ item.name }}
            </NuxtLink>
          </template>
          <v-chip
            v-for="party in item.parties"
            :key="party"
            size="small"
            class="party-chip"
          >
            {{ party }}
          </v-chip>

          <!-- The pink button off the "Eksploruj" column, moved next to the
               name the searches are built out of. The magnifier that stood
               beside it did not come along: it opened the drawer, which is
               what clicking the name has always done, so a whole column was
               being spent on a second way to do one thing.
               `size="small"` where the column's copy took the default 48px,
               because this one shares a flex row with the party chips and a
               full-height button would set the height of every row.
               `hidden-sm-and-down` rather than a `useDisplay()` test: under
               SSR Vuetify builds its display state from a placeholder 1280px
               and corrects it only when suspense resolves, so a phone would
               get the button for as long as that takes and keep it if that
               update never runs. And there is no room for it down there - the
               cell is capped at 120px and shares 343px with the history one. -->
          <v-tooltip
            v-if="searchWithName"
            :text="SEARCH_ALL_TOOLTIP"
            open-delay="2000"
            location="top"
          >
            <template #activator="{ props: searchProps }">
              <v-btn
                v-bind="searchProps"
                :icon="mdiOpenInNew"
                variant="text"
                color="secondary"
                size="small"
                class="hidden-sm-and-down"
                @click.stop="
                  executeSearchAll(item, region, company);
                  $emit('action:explored', item);
                  if (!disableFocus) $emit('focus', item);
                "
              />
            </template>
          </v-tooltip>
        </div>

        <!-- On a one-person queue the total is what put this person in front
             of the reader, so it stays on the row - as a line under the name,
             which costs nothing, rather than as a column, which costs 32px of
             padding plus its header word. -->
        <div v-if="scoreWithName" class="text-caption text-medium-emphasis">
          Suma ocen: {{ item.stats?.votes?.interesting || 0 }}
        </div>

        <!-- `v-else-if`, so that a page asking for both never prints the total
             twice on a phone. -->
        <div
          v-else-if="scoreOnPhone"
          class="text-caption text-medium-emphasis d-md-none"
        >
          Suma ocen: {{ item.stats?.votes?.interesting || 0 }}
        </div>
      </div>
    </template>

    <!-- What the person has done: employers, when the most recent of them
         started, and the elections they stood in. Keyed on
         `latestEmploymentStart` rather than on a fresh `history` key, and that
         is not cosmetic - the header key is what the table emits as `sortBy`
         and `server/api/nodes/index.get.ts` hands an unrecognised one straight
         to a Firestore `orderBy`, which drops every document that lacks the
         field. A new key would empty the table on the first tap of the header
         and break the `?sortBy=latestEmploymentStart` links the QA list and
         /eksploruj/nowe already point at. -->
    <template #[`item.latestEmploymentStart`]="{ item }">
      <div class="history-cell d-flex flex-column flex-md-row ga-1 ga-md-4">
        <div
          v-if="item.companies?.length || item.latestEmploymentStart"
          class="companies-cell"
        >
          <div class="d-flex flex-wrap ga-1 py-1">
            <span v-for="companyName in item.companies" :key="companyName">
              <v-tooltip :text="shortCompanyName(companyName)" location="top">
                <template #activator="{ props: shortCompanyProps }">
                  <v-chip
                    v-bind="shortCompanyProps"
                    size="small"
                    class="mb-1 text-truncate d-flex company-chip"
                    variant="outlined"
                  >
                    {{ shortCompanyName(companyName) }}
                  </v-chip>
                </template>
              </v-tooltip>
            </span>
          </div>
          <!-- „Lata pracy” lost its column to the merge and kept its sort
               key, so without these words /eksploruj/tabela orders the table
               by a number that is nowhere on it. Left out for a page that does
               still declare the column - /eksploruj/nowe does - which would
               otherwise print the same years twice on one row.
               The prefix goes on a phone and the bare „od <data>” stays: it
               is the only date in the cell, and the two columns left down
               there have no room for eleven characters of it. -->
          <div
            v-if="item.latestEmploymentStart"
            class="text-caption text-medium-emphasis"
          >
            <span class="d-none d-md-inline">Ostatnie zatrudnienie: </span
            ><span class="d-md-none">od </span>{{ employmentSummary(item) }}
          </div>
        </div>

        <!-- Drawn whatever the page declares, and which copy the reader sees
             is left to a class rather than to a `v-if`: /eksploruj/tabela's
             „Wybory” column is in `headers` at every width and takes itself
             off a phone with `hidden-sm-and-down`, so a computed over that
             array answers "there is a column" below 960px too - and the chips
             were leaving the phone altogether, out of the column that is
             hidden and out of the cell that deferred to it. `d-md-none` is the
             other half of that same rule, so exactly one copy is on the page
             at any width. /eksploruj/nowe declares no such column and keeps
             this copy throughout. -->
        <ExploreTableElectionChips
          :class="{ 'd-md-none': hasElectionsColumn }"
          :elections="item.elections"
        />
      </div>
    </template>

    <!-- Elections as a column rather than as the second half of the history
         cell, which is what /eksploruj/tabela asks for above 960px: the two
         readings are „gdzie pracował” and „gdzie startował”, and a reader
         scanning for one of them was scanning the same box for both. Below
         that width the column is hidden by the page and the chips come back
         into the history cell, where there is one column to spare and not two.
         `sortable: false` on the page, and it has to stay that way: `elections`
         is not a key `server/api/nodes/index.get.ts` maps onto a Firestore
         path, so a click on it would go into `orderBy` verbatim and drop every
         document that stores the field under any other shape. -->
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

    <!-- Same key mismatch as the header above. The cell was falling through to
         Vuetify's own value lookup, which is right for everybody who has a
         `stats` document and blank for everybody who does not - where this
         slot reads that as the zero votes it is. -->
    <template #[`item.stats.votes.interesting`]="{ item }">
      {{ item.stats?.votes?.interesting || 0 }}
      <!-- „Notatki” is one of the sorts this column's menu offers and has no
           column of its own left to be read in, so the count sits under the
           total rather than being orderable and invisible. Nothing at zero: a
           second line on every row would make the table taller to print a
           number that says what its absence already says. -->
      <div
        v-if="item.stats?.notesCount"
        class="text-caption text-medium-emphasis"
      >
        {{
          polishCounting(item.stats.notesCount, "notatka", "notatki", "notatek")
        }}
      </div>
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
        <v-tooltip :text="SEARCH_ALL_TOOLTIP" open-delay="2000" location="top">
          <template #activator="{ props: searchProps }">
            <v-btn
              v-bind="searchProps"
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
import { computed } from "vue";
import { mdiMagnify, mdiOpenInNew } from "@mdi/js";
import {
  SEARCH_ALL_TOOLTIP,
  executeSearchAll,
} from "~/composables/usePersonSearch";
import { polishCounting } from "~/composables/polish";
import { voteScaleSummary } from "~/composables/votes";
import type { PersonRich } from "~~/shared/model";

const userVoteTooltip = [
  "Twój osobisty głos dla tej osoby (widoczny tylko dla Ciebie).",
  voteScaleSummary("interesting"),
]
  .filter(Boolean)
  .join(" ");

/** What each merged column may be sorted by, own key first, as its menu lists
 * it. `sentence` is read after "Sortuj wg" so it is genitive; `short` sits
 * beside the column title so it is nominative.
 *
 * Every key here is one `server/api/nodes/index.get.ts` already maps onto a
 * Firestore path, spelled exactly as it spells it. That file has no allow-list:
 * a key it does not recognise goes straight into `orderBy`, which drops every
 * document that lacks the field instead of failing, so a typo in this table
 * would answer the click with an empty table and no error anywhere.
 *
 * "Lata pracy" and "Notatki" are here rather than in the header row because
 * seven days of api logs put them at under 4% of sorted queries between them,
 * against 61 combinations for `latestEmploymentStart` and 39 for
 * `stats.votes.interesting`. They cost two columns of width for that. */
const EMPLOYMENT_SORT_OPTIONS = [
  {
    key: "latestEmploymentStart",
    sentence: "ostatniego zatrudnienia",
    short: "ostatnie zatrudnienie",
  },
  { key: "experience", sentence: "lat pracy", short: "lata pracy" },
];

const VOTES_SORT_OPTIONS = [
  { key: "stats.votes.interesting", sentence: "sumy ocen", short: "suma ocen" },
  { key: "notesCount", sentence: "liczby notatek", short: "liczba notatek" },
];

const props = withDefaults(
  defineProps<{
    items: PersonRich[];
    totalItems: number;
    pending: boolean;
    page?: number;
    itemsPerPage?: number;
    sortBy?: { key: string; order: "asc" | "desc" }[];
    headers: Record<string, unknown>[];
    noDataText?: string;
    itemsPerPageText?: string;
    itemsPerPageOptions?: { value: number; title: string }[];
    loadingText?: string;
    hideDefaultFooter?: boolean;
    region?: [string, string];
    company?: [string, string];
    disableFocus?: boolean;
    /** Print the aggregate score under the name instead of expecting a
     * `stats.votes.interesting` column.
     *
     * A per-page flag on the shared component, like `disableFocus` above,
     * because the name cell lives here and there is no pass-through slot for
     * it. /eksploruj/nowe shows one person at a time and had to drop columns
     * to fit its card, but the total is the number its queue is ordered by -
     * so it moves rather than going away. Off everywhere else, so
     * /eksploruj/tabela - which still declares the column - draws no extra
     * line. */
    scoreWithName?: boolean;
    /** Put the pink "otwórz wyszukiwarki" button inline in the name cell,
     * desktop only.
     *
     * /eksploruj/tabela dropped its "Eksploruj" column: of the two buttons in
     * it, the magnifier only opened the drawer, which is what clicking the
     * name has done all along - so a column's worth of header and padding was
     * being spent, half of it on a second way to do one thing. The half that
     * is not redundant comes back here, on the row it acts on. Off by default,
     * because /eksploruj/nowe still declares the column and would otherwise
     * draw the same button twice on one row. */
    searchWithName?: boolean;
    /** Print the aggregate score under the name below 960px only.
     *
     * Not the same flag as `scoreWithName` above and deliberately not merged
     * with it: that one is /eksploruj/nowe's, at every width, standing in for a
     * column that page does not draw at all. This one is /eksploruj/tabela's,
     * which does draw the "Oceny" column - but only above 960px, and at 390px
     * the merged column set measures 447px against a 358px viewport, putting
     * the "Oceny" header at x=363. Off screen, so the sort behind it cannot be
     * tapped and the number cannot be read; this line is where a phone gets
     * it. */
    scoreOnPhone?: boolean;
  }>(),
  {
    page: 1,
    itemsPerPage: 10,
    sortBy: () => [],
    noDataText: "Brak danych",
    itemsPerPageText: "Wierszy na stronę:",
    // Vuetify's defaults, except that the last one is labelled by its English
    // locale string ("All") - the app never sets a Polish locale.
    itemsPerPageOptions: () => [
      { value: 10, title: "10" },
      { value: 25, title: "25" },
      { value: 50, title: "50" },
      { value: 100, title: "100" },
      { value: -1, title: "Wszystkie" },
    ],
    loadingText: "Ładowanie...",
    hideDefaultFooter: false,
    disableFocus: false,
    scoreWithName: false,
    searchWithName: false,
    scoreOnPhone: false,
    region: undefined,
    company: undefined,
  },
);

const emit = defineEmits<{
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

/** What a click in a column's sort menu does. The same rule as a click on the
 * header itself, except for the direction it starts from: a header click opens
 * ascending, and none of the keys these menus offer is worth reading that way
 * round - the newest job, the most years, the most votes and the most notes are
 * all at the descending end. Picking the key that is already active flips it,
 * so the ascending order is still one more click away. */
function sortOn(key: string) {
  const current = props.sortBy[0];
  const order =
    current?.key === key && current.order === "desc" ? "asc" : "desc";
  emit("update:sortBy", [{ key, order }]);
}

const shortCompanyName = (companyName: string | undefined) => {
  if (!companyName) return "";
  const spolkaIndex = companyName.indexOf(
    "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
  );
  if (spolkaIndex !== -1) {
    companyName =
      companyName.slice(0, spolkaIndex) + companyName.slice(spolkaIndex + 39);
  }
  return companyName;
};

/** Whether the page draws a „Wybory” column of its own, which decides which
 * copy of the chips is visible and not whether one is rendered. Read off the
 * headers the page passed rather than from a prop of its own, because a flag
 * could disagree with the column list - which would show the chips twice or
 * not at all, in a table whose other columns look right.
 *
 * It says nothing about width, and reading it as if it did is what took the
 * chips off a phone: /eksploruj/tabela declares the column at every width and
 * hides it below 960px with `hidden-sm-and-down`, so this is true down there
 * as well. All it can pick is the class that puts the chips back in the
 * history cell. */
const hasElectionsColumn = computed(() =>
  props.headers.some((header) => header.key === "elections"),
);

/** Whether the page draws a „Lata pracy” column of its own. /eksploruj/nowe
 * still does; /eksploruj/tabela folded it into the „Firmy” sort menu, and
 * that is the page whose caption below has to carry the number.
 *
 * A `v-if` off this one is exact where the same shape was wrong for the
 * elections above: this column is drawn at every width, so there is no
 * breakpoint for a header list to be blind to. */
const hasExperienceColumn = computed(() =>
  props.headers.some((header) => header.key === "experience"),
);

/** „2021-03-01 · 11 lat pracy”: when the person was last hired and how long
 * they have worked altogether, in the one caption under the employers.
 *
 * `polishCounting` returns the number with the noun, so the years are not
 * printed again beside it, and the three forms are the ones it asks for in the
 * order it asks for them - a nominative plural in the last slot would answer
 * eleven years with „11 lata pracy”. */
function employmentSummary(item: PersonRich) {
  const years =
    item.experience && !hasExperienceColumn.value
      ? polishCounting(item.experience, "rok pracy", "lata pracy", "lat pracy")
      : undefined;
  return [item.latestEmploymentStart, years].filter(Boolean).join(" · ");
}
</script>

<style scoped>
/* Committee names run to "KOMITET WYBORCZY WYBORCÓW ..." and used to sit in
 * the chip, which made this the widest column on the page by a distance. It is
 * in the tooltip now, and what is left is capped so a long town name cannot do
 * the same thing again. The cap lives here rather than in
 * explore/table/ElectionChips.vue because it is a budget this table sets - the
 * same 220px whether the chips are a column of their own or the second half of
 * the history cell - and a child's root element carries the parent's scope id,
 * so the rule reaches it. */
.elections-cell {
  max-width: 220px;
}

/* The name, the party chips and (on /eksploruj/nowe) the score share this now,
 * so it can be wider than the 150px the name alone had - the column it sits in
 * is one of two rather than one of four, and the room came out of the two that
 * went. Still called `name-cell` rather than something honest like
 * `person-cell` because `tests/e2e/remove_edge.spec.ts` clicks the drawer open
 * through it. */
.name-cell {
  max-width: 200px;
}

.companies-cell {
  max-width: 300px;
}

/* Matches the cell, in pixels rather than a percentage: the chip sits in an
 * auto sized flex item, so there is nothing definite for a percentage to
 * resolve against. */
.company-chip {
  max-width: 300px;
}

/* Above the breakpoint the two halves of the history sit side by side and
 * each keeps the cap it had as a column of its own; below it they stack, which
 * is what `flex-column flex-md-row` on the cell does. No cap here on purpose -
 * the children carry theirs, and a cap on the parent would fight the gap. */
.history-cell {
  align-items: flex-start;
}

/* The page drops to two columns here (see pages/eksploruj/tabela.vue), and a
 * 375px phone leaves the table 343px to put them in: 311px of content once the
 * reduced 8px padding on four cell edges is out. A chip cannot wrap, so
 * whatever it is allowed to be wide is what its column costs at a minimum, and
 * these caps are that budget split 120/185 - they are what keeps the page off
 * a sideways scroll. It is a far kinder split than the 100/60/72/72 four
 * columns forced, which ellipsised a party after six letters. A name or a
 * company longer than its share is still truncated rather than setting the
 * width of the column for every other row - the drawer behind the name has all
 * of it in full. */
@media (max-width: 959.98px) {
  .name-cell,
  .party-chip {
    max-width: 120px;
    /* A surname long enough to not fit is broken across lines rather than
     * pushing the history column out. */
    overflow-wrap: anywhere;
  }

  .history-cell,
  .companies-cell,
  .company-chip,
  .elections-cell {
    max-width: 185px;
  }

  /* Vuetify's 16px each side, twice over, is 64px of those 343px. Halving it
   * buys 32px back, which is a whole party chip. */
  :deep(.v-data-table__td),
  :deep(.v-data-table__th) {
    padding-inline: 8px !important;
  }
}

.party-chip :deep(.v-chip__content) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}
</style>
