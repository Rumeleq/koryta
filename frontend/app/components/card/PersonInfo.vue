<template>
  <div
    v-if="person?.birthDate || profiles.length"
    class="d-flex flex-wrap align-center ga-2"
  >
    <span v-if="person?.birthDate" class="text-body-2 text-medium-emphasis">
      ur. {{ person.birthDate }}
    </span>

    <v-chip
      v-for="profile in profiles"
      :key="profile.label"
      :href="profile.href"
      target="_blank"
      rel="noopener"
      size="small"
      variant="outlined"
      :append-icon="mdiOpenInNew"
    >
      {{ profile.label }}
    </v-chip>
  </div>
</template>

<script setup lang="ts">
import { mdiOpenInNew } from "@mdi/js";
import { computed } from "vue";
import type { Person, PersonRich } from "~~/shared/model";

const props = defineProps<{
  person: Person | PersonRich | undefined;
}>();

/** The registries this person can be looked up in. They used to be a labelled
 * column each - an uppercase heading over a link, three of them across - which
 * on a phone stacked into a screen of headings. As chips they say the same
 * thing in a line. */
const profiles = computed(() =>
  [
    { label: "Wikipedia", href: props.person?.wikipedia },
    { label: "Rejestr.io", href: props.person?.rejestrIo },
    { label: "Kto ma co", href: props.person?.ktomaco },
  ].filter((profile): profile is { label: string; href: string } =>
    Boolean(profile.href),
  ),
);
</script>
