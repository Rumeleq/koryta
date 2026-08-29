<template>
  <div class="d-inline-flex align-center w-100">
    <v-tooltip :text="tooltip" location="top" max-width="300">
      <template #activator="{ props: tipProps }">
        <v-icon
          :icon="mdiInformationOutline"
          v-bind="tipProps"
          size="small"
          class="mr-2"
          color="grey-darken-1"
          @click.stop
        />
      </template>
    </v-tooltip>
    <span>{{ column.title }}</span>

    <!-- Which of the column's keys the table is ordered by, printed only when
         it is not the one the title already names. A merged column answers for
         more than one sort now - "Firmy" for both the date of the last job and
         the years worked - and an arrow on its own cannot tell those apart, so
         a reader who picked "lat pracy" out of the menu would see the rows move
         under a header that still reads like the date sort. -->
    <span
      v-if="activeSort && activeSort.key !== column.key"
      class="ml-1 text-medium-emphasis text-no-wrap"
    >
      ({{ activeSort.short }})
    </span>

    <!-- The arrow used to key off `sortBy[0].key === column.key`, which held
         for as long as a column meant exactly one sort key. It stopped holding
         the moment the menu below could set `experience` or `notesCount` while
         the column that offers them is keyed on something else: the comparison
         is then false on every header at once, the table reorders itself and
         nothing on the page says so. Matching against the keys the column
         covers is what keeps the cue attached to the click that caused it. -->
    <v-icon
      v-if="column.sortable"
      :icon="
        activeSort && sortBy[0]?.order === 'desc' ? mdiArrowDown : mdiArrowUp
      "
      size="small"
      class="ml-1"
      :class="{ 'opacity-0': !activeSort }"
    ></v-icon>

    <!-- Only for a column that really does cover a second key - a menu holding
         one entry would be a click that changes nothing - and only where the
         page sorts at all. /eksploruj/nowe declares every column
         `sortable: false` and drives the order from its own two buttons, so
         its copy of this header would otherwise grow a menu that emits an
         `update:sortBy` nobody over there is listening for.
         `@keydown.stop` is the guard the activator does not come with. Vuetify
         puts both a click and a keydown handler on the <th> - the second one
         sorts on Enter - and stops the click itself inside the activator, but
         nothing stops the keydown. Without this, a reader who tabs to the
         button and presses Enter opens the menu and reorders the table on the
         column's own key in the same keystroke, which is the opposite of what
         they were reaching for. -->
    <v-menu v-if="column.sortable && sortOptions.length > 1">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          :icon="mdiDotsVertical"
          size="x-small"
          variant="text"
          class="ml-1"
          :aria-label="`Sortowanie kolumny ${column.title}`"
          @keydown.stop
        />
      </template>
      <v-list density="compact" min-width="220">
        <v-list-subheader>Sortuj wg</v-list-subheader>
        <v-list-item
          v-for="option in sortOptions"
          :key="option.key"
          :active="activeSort?.key === option.key"
          @click="$emit('sort', option.key)"
        >
          <v-list-item-title class="text-body-2">
            {{ option.sentence }}
          </v-list-item-title>
          <template #append>
            <v-icon
              v-if="activeSort?.key === option.key"
              size="small"
              :icon="sortBy[0]?.order === 'desc' ? mdiArrowDown : mdiArrowUp"
            />
          </template>
        </v-list-item>
      </v-list>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import {
  mdiArrowDown,
  mdiArrowUp,
  mdiDotsVertical,
  mdiInformationOutline,
} from "@mdi/js";

const props = withDefaults(
  defineProps<{
    tooltip: string;
    column: {
      title?: string;
      key: string | null;
      sortable?: boolean;
    };
    sortBy: { key: string; order: "asc" | "desc" }[];
    /** The sort keys this one column stands for, own key first, as the menu
     * lists them. `sentence` is read after "Sortuj wg" so it is genitive;
     * `short` is printed beside the column title so it is nominative.
     *
     * Left empty by every column that still means exactly one sort, and then
     * the header behaves as it always did. */
    sortOptions?: { key: string; sentence: string; short: string }[];
  }>(),
  { sortOptions: () => [] },
);

defineEmits<{ (e: "sort", key: string): void }>();

/** A column with no menu still has one key it can be sorted by - its own - so
 * the two cases below are the same lookup rather than a branch. */
const options = computed(() =>
  props.sortOptions.length
    ? props.sortOptions
    : [{ key: props.column.key ?? "", sentence: "", short: "" }],
);

const activeSort = computed(() =>
  options.value.find((option) => option.key === props.sortBy[0]?.key),
);
</script>
