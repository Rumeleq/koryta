<template>
  <v-tooltip v-if="chip" :text="chip.tooltip" location="bottom">
    <template #activator="{ props: tooltipProps }">
      <!-- `flat` where the chip has a colour, `tonal` where it does not, for
           the reason `chip/PublicCompany.vue` gives at greater length: this
           theme's primary is a pale sage, and sage ink on a sage wash is
           1.73:1. -->
      <v-chip
        v-bind="tooltipProps"
        :color="chip.color"
        :prepend-icon="chip.icon"
        size="x-small"
        :variant="chip.color ? 'flat' : 'tonal'"
        :data-testid="`election-outcome-${outcome}`"
      >
        {{ chip.label }}
      </v-chip>
    </template>
  </v-tooltip>
</template>

<script lang="ts" setup>
import {
  mdiCheckCircleOutline,
  mdiCloseCircleOutline,
  mdiHelpCircleOutline,
} from "@mdi/js";
import { electionOutcome, electionOutcomeText } from "~~/shared/election";

const props = defineProps<{
  /** The stored `elected` field of a candidacy, in all three of its states. */
  elected: boolean | null | undefined;
  /** Whether to say so when PKW recorded no result, rather than staying
   * silent. Worth it on a page about one candidacy, where the reader can see
   * that the question was asked; only noise in a list where most rows would
   * carry it - which today is nearly all of them. */
  showUnknown?: boolean;
}>();

const outcome = computed(() => electionOutcome(props.elected));

/* Sage for the mandate and nothing for the loss, deliberately. A colour here
   would read as the site's verdict on the person rather than as PKW's record
   of the count, and it is the section below the relations - not a chip - that
   is allowed to draw a conclusion from a lost election. */
const chip = computed(() => {
  const text = electionOutcomeText[outcome.value];
  if (outcome.value === "elected") {
    return {
      ...text,
      color: "primary",
      icon: mdiCheckCircleOutline,
      tooltip: text.detail,
    };
  }
  if (outcome.value === "lost") {
    return {
      ...text,
      color: undefined,
      icon: mdiCloseCircleOutline,
      tooltip: text.detail,
    };
  }
  if (!props.showUnknown) return undefined;
  return {
    ...text,
    color: undefined,
    icon: mdiHelpCircleOutline,
    tooltip: text.detail,
  };
});
</script>
