<template>
  <v-alert type="info" variant="tonal" class="mb-4" :icon="mdiAccountLock">
    <!-- Side by side where there is room; below the copy on a phone, where a
         button held on the same line squeezed the sentence into a column four
         words wide. -->
    <div
      class="d-flex flex-column flex-sm-row align-sm-center justify-space-between ga-3 w-100"
    >
      <div>
        Zaloguj się, aby uzyskać dostęp do jeszcze nieopublikowanych /
        niezweryfikowanych osób.
        <template v-if="hiddenCount > 0">
          W tym widoku znaleźliśmy jeszcze
          <strong>{{
            polishCounting(
              hiddenCount,
              "dodatkowa osoba",
              "dodatkowe osoby",
              "dodatkowych osób",
            )
          }}</strong
          >.
        </template>
      </div>
      <v-btn
        color="primary"
        variant="flat"
        to="/login"
        class="flex-shrink-0 align-self-start"
      >
        Zaloguj się
      </v-btn>
    </div>
  </v-alert>
</template>

<script setup lang="ts">
import { mdiAccountLock } from "@mdi/js";
defineProps<{
  hiddenCount: number;
}>();
</script>
