<template>
  <v-alert type="info" variant="tonal" class="mb-4" :icon="mdiAccountLock">
    <div class="d-flex align-center justify-space-between w-100">
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
      <v-btn
        color="primary"
        variant="flat"
        to="/login"
        class="ml-4 flex-shrink-0"
      >
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
