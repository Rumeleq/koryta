<template>
  <v-app-bar>
    <NuxtLink to="/">
      <NuxtImg
        class="mx-2"
        src="/logo_small.png"
        width="40"
        height="40"
        fetchpriority="high"
        preload
        style="cursor: pointer; object-fit: contain"
        alt="Koryta.pl"
      />
    </NuxtLink>

    <v-app-bar-title v-if="mdAndUp">
      <NuxtLink
        to="/"
        class="text-decoration-none"
        style="color: inherit; cursor: pointer"
      >
        koryta.pl
      </NuxtLink>
    </v-app-bar-title>
    <v-spacer />
    <omni-search v-if="!route?.meta.hideSearch" />
    <v-spacer />

    <template #append>
      <v-btn v-if="mdAndUp" text to="/o-nas">O nas</v-btn>
      <v-btn v-if="mdAndUp" text to="/pomoc">Działaj z nami</v-btn>
      <ClientOnly>
        <v-btn v-if="user && pictureURL" icon to="/profil" size="32">
          <v-avatar :image="pictureURL" size="32" />
        </v-btn>
        <v-btn v-if="user && !pictureURL" icon to="/profil">
          <v-icon :icon="mdiAccount" />
        </v-btn>
        <v-btn v-if="!user" :icon="!mdAndUp" @click="loginDialog = true">
          <v-icon v-if="!mdAndUp" :icon="mdiAccount" />
          <span class="d-none d-md-inline">Zaloguj się</span>
        </v-btn>
        <v-btn v-if="user && mdAndUp" text @click="logout">Wyloguj</v-btn>
        <DialogLogin v-model="loginDialog" hide-activator />
        <template #fallback>
          <v-btn :icon="!mdAndUp" @click="loginDialog = true">
            <v-icon v-if="!mdAndUp" :icon="mdiAccount" />
            <span class="d-none d-md-inline">Zaloguj się</span>
          </v-btn>
        </template>
      </ClientOnly>
    </template>
  </v-app-bar>
  <v-main class="d-flex flex-column">
    <ClientOnly>
      <v-toolbar
        v-if="user"
        density="compact"
        color="primary"
        class="user-toolbar"
      >
        <v-spacer />

        <v-btn
          v-if="isAdmin"
          :prepend-icon="mdiShieldAccount"
          variant="text"
          to="/admin"
        >
          Admin
        </v-btn>
        <v-btn :prepend-icon="mdiViewList" variant="text" to="/admin/rewizje">
          Rewizje
        </v-btn>
        <v-btn
          v-if="isAdmin"
          :prepend-icon="mdiNoteTextOutline"
          variant="text"
          to="/admin/notatki"
        >
          Notatki
        </v-btn>
        <v-btn
          :prepend-icon="mdiLightningBolt"
          variant="text"
          href="https://github.com/users/SzymonPajzert/projects/2/views/3"
          target="_blank"
        >
          Nowy bug w GitHubie
        </v-btn>
        <v-btn
          v-if="affineLink"
          :prepend-icon="mdiLightningBolt"
          variant="text"
          :href="`https://app.affine.pro/workspace/794db959-e4b7-4756-8db2-61cf824329fa/${affineLink}?mode=edgeless`"
          target="_blank"
        >
          Dyskusja w affine
        </v-btn>
        <v-spacer icon />
      </v-toolbar>
    </ClientOnly>
    <v-container
      class="position-relative fill-height"
      :max-width="maxWidth"
      :style="{ padding: rootPadding }"
    >
      <slot />
    </v-container>
    <HomeAppFooter class="mt-auto w-100" />
  </v-main>
</template>

<script lang="ts" setup>
import {
  mdiAccount,
  mdiLightningBolt,
  mdiShieldAccount,
  mdiViewList,
  mdiNoteTextOutline,
} from "@mdi/js";
import { computed, ref } from "vue";
import { useAuthState } from "@/composables/auth";
import { useDisplay } from "vuetify";

const { mdAndUp } = useDisplay();
const { user, userConfig, logout, isAdmin } = useAuthState();
const route = useRoute();
const loginDialog = ref(false);
const maxWidth = computed(() =>
  route?.meta?.fullWidth ? "none" : (route?.meta?.maxWidth ?? 1200),
);
const rootPadding = computed(() => (route?.meta?.fullWidth ? 0 : undefined));
const affineLink = computed(() => route?.meta?.affineLink);
const pictureURL = computed(() => userConfig?.data?.value?.photoURL);
</script>

<style scoped>
/* `fill-height` makes the container a flex row, so a page is a flex item and
   is sized from its own content rather than from the container.

   Its automatic minimum is that content's minimum, which is how one wide table
   made the whole document 1242px on a 390px phone - taking the app bar and the
   filters with it, and `html { overflow-x: hidden }` then clipped what had been
   pushed out instead of letting anyone scroll to it. `min-width: 0` lets the
   page shrink and leaves the overflow to whatever scrolls inside it.

   Its automatic maximum is that content's max-content width, which leaves a
   page narrower than the container it was given whenever the viewport is wider
   than the widest thing on it - the explore table stopping short of the right
   edge of a laptop screen. Growing takes the width that was offered. */
.v-container > :deep(*) {
  min-width: 0;
  flex-grow: 1;
}

/* Vuetify clips the toolbar content, so on narrow screens the trailing
   buttons are unreachable. Let it scroll sideways instead. The spacers
   collapse to zero once the buttons overflow, so wide screens still centre. */
.user-toolbar :deep(.v-toolbar__content) {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.user-toolbar :deep(.v-toolbar__content)::-webkit-scrollbar {
  display: none;
}

.user-toolbar :deep(.v-btn) {
  flex: 0 0 auto;
}
</style>
