<template>
  <v-app>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </v-app>
</template>

<style scoped></style>

<style>
html {
  scroll-behavior: smooth;

  /* Vuetify sizes its type in rem off the root, and its default of 16px is a
     reading size for prose. Most of this site is a register - tables of names,
     dates and chips - which at 16px came out large enough that a laptop reader
     had to sit at 80% browser zoom to see a useful number of rows. 14px is the
     size they were zooming to.

     Only type scales with this: the spacing helpers (`pa-4` and friends) are
     px, so the layout keeps its gutters. Vuetify's own rule lives in
     `@layer base`, which is why this unlayered one wins wherever it is
     injected. */
  font-size: 87.5%;
}

/* Vuetify tints disabled filled buttons by laying a dark overlay over the
   button colour, which turns our sage primary into an unreadable olive.
   Use a neutral grey container + label instead. */
.v-btn--disabled.v-btn--variant-elevated,
.v-btn--disabled.v-btn--variant-flat {
  background: rgba(var(--v-theme-on-surface), 0.12) !important;
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}

.v-btn--disabled.v-btn--variant-elevated .v-btn__overlay,
.v-btn--disabled.v-btn--variant-flat .v-btn__overlay {
  opacity: 0;
}
</style>
