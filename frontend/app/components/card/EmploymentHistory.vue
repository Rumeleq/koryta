<template>
  <v-list class="px-2" variant="flat">
    <div class="d-flex align-center justify-space-between ga-2 mb-2">
      <div>
        <h3 class="text-h6">Historia powiązań</h3>
        <!-- What the list below adds up to, so the shape of a record is
             readable without counting the rows - and so a page with none says
             so rather than showing an empty box. -->
        <div class="text-caption text-medium-emphasis">
          {{ summary }}
        </div>
      </div>
      <v-btn
        v-if="canAdd"
        variant="text"
        size="small"
        color="primary"
        :prepend-icon="mdiPlus"
        data-testid="add-relation-employment"
        class="flex-shrink-0"
        @click="emit('add')"
      >
        Dodaj
      </v-btn>
    </div>

    <div class="pa-1">
      <v-list-item
        v-for="edge in edgesSorted"
        :key="edge.id"
        :to="`/entity/${edge.richNode.type}/${edge.richNode.id}`"
        base-color="surface-light"
        class="mt-1"
        rounded
      >
        <template #prepend>
          <v-icon :icon="getIcon(edge.richNode.type)" />
        </template>

        <v-list-item-title class="text-subtitle-2 font-weight-bold text-wrap">
          {{ edge.richNode.name }}
        </v-list-item-title>

        <div class="d-flex align-center flex-wrap ga-2">
          <span class="text-caption text-medium-emphasis text-wrap">
            {{ edgeLabel(edge) }}
          </span>
          <PartyChip v-if="partyOf(edge)" :party="partyOf(edge)!" />
          <span
            v-if="committeeOf(edge)"
            class="text-caption text-medium-emphasis text-wrap"
          >
            {{ committeeOf(edge) }}
          </span>
          <ChipPublicCompany :company="asCompany(edge)" />
        </div>

        <div v-if="isDated(edge)" class="d-md-none mt-2 pb-2">
          <ChipRelativeDuration
            :start="edge.start_date"
            :end="edge.end_date"
            :min-start="minStart"
            :max-end="maxEnd"
          />
        </div>

        <template #append>
          <div v-if="isDated(edge)" class="d-none d-md-flex">
            <ChipRelativeDuration
              :start="edge.start_date"
              :end="edge.end_date"
              :min-start="minStart"
              :max-end="maxEnd"
            />
          </div>
        </template>
      </v-list-item>
    </div>
  </v-list>
</template>

<script lang="ts" setup>
import {
  mdiAccountOutline,
  mdiOfficeBuildingOutline,
  mdiFileDocumentOutline,
  mdiCommentArrowRightOutline,
  mdiPlus,
} from "@mdi/js";
import { polishCounting } from "~/composables/polish";
import type { Company } from "~~/shared/model";

function getIcon(type: string) {
  switch (type) {
    case "person":
      return mdiAccountOutline;
    case "place":
      return mdiOfficeBuildingOutline;
    case "article":
      return mdiFileDocumentOutline;
    default:
      return mdiCommentArrowRightOutline;
  }
}

const props = defineProps<{
  edges: EdgeNode[];
  /** Whether this section offers adding a relation. */
  canAdd?: boolean;
}>();

const emit = defineEmits<{ add: [] }>();

/** How the relations below break down, as "3 miejsca pracy · 1 kandydatura".
 *
 * The counts are Polish, so each kind carries its own three forms rather than
 * being pluralised by a rule - "miejsce/miejsca/miejsc" and
 * "kandydatura/kandydatury/kandydatur" decline differently. */
const summary = computed(() => {
  const forms: Record<string, [string, string, string]> = {
    employed: ["miejsce pracy", "miejsca pracy", "miejsc pracy"],
    election: ["kandydatura", "kandydatury", "kandydatur"],
    owns: ["podmiot zależny", "podmioty zależne", "podmiotów zależnych"],
    connection: ["powiązanie", "powiązania", "powiązań"],
    mentions: ["wzmianka", "wzmianki", "wzmianek"],
    comment: ["komentarz", "komentarze", "komentarzy"],
  };

  const counts = new Map<string, number>();
  for (const edge of props.edges) {
    counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
  }
  if (counts.size === 0) return "Nie znamy jeszcze żadnych powiązań";

  return [...counts]
    .filter(([type]) => type in forms)
    .map(([type, count]) => polishCounting(count, ...forms[type]!))
    .join(" · ");
});

const edgesSorted = computed(() => {
  return props.edges.toSorted((a, b) => {
    if (!a.start_date) return -1;
    if (!b.start_date) return 1;

    return b.start_date.localeCompare(a.start_date);
  });
});

const minStart = computed(() => {
  return edgesSorted.value
    .map((e) => e.start_date)
    .filter((d): d is string => !!d)
    .toSorted((a, b) => a?.localeCompare(b))[0];
});

const maxEnd = computed(() => {
  return new Date().toISOString().split("T")[0];
});

function edgeLabel(edge: EdgeNode) {
  return edge.label;
}

/** The party a candidacy was run for, on the edges that assert one.
 *
 * Only `election` edges carry it in the schema, but the check is explicit: a
 * hand-made edge of another type that picked up a stray `party` should not
 * start rendering a party chip on somebody's profile.
 */
function partyOf(edge: EdgeNode): string | undefined {
  return edge.type === "election" ? edge.party || undefined : undefined;
}

/** The electoral committee a candidacy was run under.
 *
 * Shown next to the party rather than instead of it: `party` is the national
 * brand a committee was mapped onto, `committee` its full registered name, and
 * for a local committee ("KWW Wspólny Kalisz") there is no party at all. Both
 * are dropped when they say the same thing, which is the case for the committees
 * whose name *is* the party.
 */
function committeeOf(edge: EdgeNode): string | undefined {
  if (edge.type !== "election" || !edge.committee) return undefined;
  const party = partyOf(edge);
  if (party && party.toLowerCase() === edge.committee.toLowerCase()) {
    return undefined;
  }
  return edge.committee;
}

/** Whether the edge asserts a period at all.
 *
 * The card lists every relation a person has, not only the employment it is
 * named after, and some kinds carry no dates by construction - a `connection`
 * has no date fields in the schema. Drawing a full-width bar for those claims a
 * span nobody recorded, so they get the label and nothing else. */
function isDated(edge: EdgeNode): boolean {
  return !!(edge.start_date || edge.end_date);
}

/** The company behind an edge, when the edge leads to one at all. */
function asCompany(edge: EdgeNode): Company | undefined {
  return edge.richNode.type === "place"
    ? (edge.richNode as Company)
    : undefined;
}
</script>
