<template>
  <div>
    <h1 class="text-h4 font-weight-bold mb-2">Korytle</h1>
    <p class="text-body-1 text-medium-emphasis mb-4">
      Codziennie pokażemy mozaikę koryciarzy z jednego regionu Polski —
      podzieloną najpierw według branż spółek, w których pracują, a potem według
      partii, z którymi są powiązani. Twoje zadanie: zgadnąć, o które miasto
      chodzi. Po każdej próbie podpowiemy, jak daleko i w którym kierunku leży
      szukany region — jak w Wordle, tylko z korytami.
    </p>

    <v-alert
      type="info"
      variant="tonal"
      class="mb-6"
      text="Ta gra jest w przygotowaniu. Zajrzyj tu wkrótce!"
    />

    <!-- Non-interactive preview of the planned guess flow -->
    <v-card variant="outlined" class="pa-4" max-width="480">
      <v-text-field
        label="Które to miasto?"
        placeholder="np. Kraków"
        disabled
        hide-details
        class="mb-2"
      />
      <v-btn color="primary" disabled block>Zgadnij</v-btn>
    </v-card>

    <v-btn
      variant="text"
      color="primary"
      to="/gry"
      :prepend-icon="mdiChevronLeft"
      class="mt-6 ms-n4"
    >
      Wróć do listy gier
    </v-btn>
  </div>
</template>

<script lang="ts" setup>
import { mdiChevronLeft } from "@mdi/js";

definePageMeta({
  title: "Korytle",
  layout: "gry",
  fullWidth: true,
});
</script>
