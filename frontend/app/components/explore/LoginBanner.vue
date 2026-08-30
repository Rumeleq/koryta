<template>
  <!-- `color`, as the zrzutka alert on /eksploruj/tabela already does: with
       `type="info"` alone Vuetify paints its own #2196f3 as the body text, and
       on the 12% wash the tonal variant lays under it that is 2.74:1 - the
       bold count and the icon with it. The type stays for the semantics; the
       palette's info ink on the wash its own colour then lays measures
       5.33:1. -->
  <v-alert
    type="info"
    color="ink-info"
    variant="tonal"
    class="mb-4"
    :icon="mdiAccountLock"
  >
    <!-- Wraps rather than sits in one line: on a phone the button used to be
         pushed off the right edge by the text beside it, which is where the
         page's 5px of sideways scroll came from. -->
    <div class="d-flex flex-wrap align-center justify-space-between ga-2 w-100">
      <div>
        {{ message }}
        <template v-if="hiddenCount > 0">
          W tym widoku znaleźliśmy jeszcze
          <strong>{{
            polishCounting(hiddenCount, forms[0], forms[1], forms[2])
          }}</strong
          >.
        </template>
      </div>
      <v-btn color="primary" variant="flat" to="/login" class="flex-shrink-0">
        Zaloguj się
      </v-btn>
    </div>
  </v-alert>
</template>

<script setup lang="ts">
import { mdiAccountLock } from "@mdi/js";

/** "There is more here once you log in", wherever that is true.
 *
 * The counted noun is a prop because Polish declines it three ways and the
 * banner appears over lists of different things - people on `/eksploruj/tabela`,
 * facts on an article page. Both default to the person wording, which is what
 * every existing caller means.
 */
withDefaults(
  defineProps<{
    hiddenCount?: number;
    message?: string;
    /** Singular, plural and genitive plural, as `polishCounting` takes them. */
    forms?: [string, string, string];
  }>(),
  {
    hiddenCount: 0,
    message:
      "Zaloguj się, aby uzyskać dostęp do jeszcze nieopublikowanych / niezweryfikowanych osób.",
    forms: () => ["dodatkowa osoba", "dodatkowe osoby", "dodatkowych osób"],
  },
);
</script>
