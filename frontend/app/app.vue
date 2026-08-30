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

/* Vuetify draws a field's label as a `.v-label`, at
   `--v-medium-emphasis-opacity` - 0.6 in the light theme - over the
   rgba(0, 0, 0, 0.87) the app inherits from `.v-application`. That composites
   to #7a7a7a on white, 4.29:1, under the 4.5:1 AA asks for; and the floating
   copy, the one an outlined field shows once it holds a value and the only
   thing then naming the control, is 0.75em - 12px. The palette's neutral ink
   at full opacity measures 6.50:1.

   Global rather than per-page: the label is a Vuetify default, so every form
   on the site carries it. Three classes deep, which leaves Vuetify's own
   four-class `.v-field--error:not(.v-field--disabled) .v-label.v-field-label`
   ahead of it, so an invalid field still labels itself in red. */
.v-field .v-label.v-field-label {
  opacity: 1;
  color: rgb(var(--v-theme-ink-neutral));
}

/* A link that is the row rather than a call to action - an entry name in a
   list, where every row carries one and the browser default turns the whole
   column blue. Reads as body text, underlines only when it is actually being
   pointed at, so the affordance survives without the colour.

   Global because the profile card and the review queue render the same
   proposal and must not drift apart; `.zrodla-link` and `.contributors__link`
   are older, scoped copies of these exact rules. */
.link-plain,
.link-plain:visited {
  color: inherit;
  text-decoration: none;
}

.link-plain:hover,
.link-plain:focus-visible {
  text-decoration: underline;
}
</style>
