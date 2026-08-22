<template>
  <v-card flat class="ma-2">
    <v-card-title class="text-subtitle-1 d-flex align-center ga-2">
      <v-icon :icon="mdiMapMarkerOutline" size="small" />
      Na mapie
    </v-card-title>

    <v-card-text class="pt-0">
      <div class="text-caption text-medium-emphasis mb-2">
        Gdzie ta osoba startowała w wyborach i gdzie pracuje.
      </div>

      <svg
        class="person-locations-map"
        viewBox="0 0 800 744"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        :aria-label="`Mapa Polski: ${placedNames.join(', ') || 'brak miejsc'}`"
      >
        <defs>
          <!-- A place that is both is drawn as both, rather than as a third
               colour nothing else in the legend explains. -->
          <pattern
            id="person-locations-both"
            width="10"
            height="10"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <rect width="10" height="10" class="swatch-election-fill" />
            <rect width="5" height="10" class="swatch-work-fill" />
          </pattern>
        </defs>

        <path
          v-for="powiat in powiaty"
          :key="powiat.teryt"
          :d="powiat.d"
          :data-teryt="powiat.teryt"
          :class="['powiat', powiat.fillClass]"
        >
          <title v-if="powiat.names">{{ powiat.names }}</title>
        </path>

        <!-- Województwo borders on top, so a powiat coloured on its own still
             reads as part of a shape the eye knows. -->
        <path
          v-for="wojewodztwo in wojewodztwaPaths"
          :key="`woj-${wojewodztwo.teryt}`"
          :d="wojewodztwo.d"
          class="wojewodztwo"
        />
      </svg>

      <div class="d-flex flex-wrap ga-1 mt-2">
        <v-chip
          v-for="location in locations"
          :key="`${location.teryt ?? ''}-${location.name}`"
          size="small"
          variant="flat"
          :color="chipColor(location.kinds)"
          :title="kindsLabel(location.kinds)"
        >
          {{ location.name }}
        </v-chip>
      </div>

      <div class="d-flex flex-wrap ga-3 mt-3 text-caption text-medium-emphasis">
        <span class="d-inline-flex align-center ga-1">
          <span class="swatch swatch-election-fill" />
          wybory
        </span>
        <span class="d-inline-flex align-center ga-1">
          <span class="swatch swatch-work-fill" />
          praca
        </span>
      </div>

      <div
        v-if="unplaced.length"
        class="text-caption text-medium-emphasis mt-2"
      >
        Poza mapą, bo nie mamy dla nich kodu TERYT:
        {{ unplaced.map((location) => location.name).join(", ") }}.
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { mdiMapMarkerOutline } from "@mdi/js";
import powiatyPaths from "@/assets/poland_powiaty.json";
import wojewodztwaPaths from "@/assets/poland_voivodeships.json";
import type {
  PersonLocation,
  PersonLocationKind,
} from "~/utils/personLocations";
import {
  locationKinds,
  locationsCovering,
  unplaceableLocations,
} from "~/utils/personLocations";

const { locations } = defineProps<{
  /** Every place tied to the person, from `personLocations`. */
  locations: PersonLocation[];
}>();

/** The map is drawn in powiaty; a województwo colours all of its own. The
 * asset stores the codes unpadded, as `ChartPolandMap` also has to allow for -
 * `204` is dolnośląskie's fourth powiat, not the two hundred and fourth. */
const powiaty = computed(() =>
  powiatyPaths.map((powiat) => {
    const teryt = powiat.teryt.padStart(4, "0");
    const covering = locationsCovering(locations, teryt);
    const kinds = locationKinds(covering);
    return {
      teryt,
      d: powiat.d,
      names: covering.map((location) => location.name).join(", "),
      fillClass:
        kinds.length === 2
          ? "powiat--both"
          : kinds.length === 1
            ? `powiat--${kinds[0]}`
            : "",
    };
  }),
);

const unplaced = computed(() => unplaceableLocations(locations));

const placedNames = computed(() =>
  locations
    .filter((location) => location.teryt)
    .map((location) => location.name),
);

const kindsLabel = (kinds: PersonLocationKind[]) =>
  kinds.length === 2
    ? "wybory i praca"
    : kinds[0] === "election"
      ? "wybory"
      : "praca";

const chipColor = (kinds: PersonLocationKind[]) =>
  kinds.includes("election") ? "primary" : "secondary";
</script>

<style scoped>
.person-locations-map {
  display: block;
  width: 100%;
  max-width: 360px;
  height: auto;
  margin: 0 auto;
}

.powiat {
  fill: rgba(var(--v-theme-on-surface), 0.06);
  stroke: rgba(var(--v-theme-on-surface), 0.15);
  stroke-width: 1;
}

.powiat--election {
  fill: rgb(var(--v-theme-primary));
}

.powiat--work {
  fill: rgb(var(--v-theme-secondary));
}

.powiat--both {
  fill: url(#person-locations-both);
}

.wojewodztwo {
  fill: none;
  stroke: rgba(var(--v-theme-on-surface), 0.45);
  stroke-width: 2;
  pointer-events: none;
}

.swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.25);
  border-radius: 2px;
}

.swatch-election-fill {
  fill: rgb(var(--v-theme-primary));
  background-color: rgb(var(--v-theme-primary));
}

.swatch-work-fill {
  fill: rgb(var(--v-theme-secondary));
  background-color: rgb(var(--v-theme-secondary));
}
</style>
