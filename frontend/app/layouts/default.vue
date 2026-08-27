<template>
  <v-app-bar :class="{ 'app-bar--searching': searchOpen }">
    <NuxtLink to="/" class="app-bar__hideable">
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
    <v-spacer class="app-bar__hideable" />

    <!-- One field serving both shapes of the bar - the 300px one a desktop
         draws in place, and the full-width one a phone opens from the magnifier
         - rather than a second instance inside a phone-sized dialog: OmniSearch
         brings a "dodaj nową osobę" dialog of its own, and two of it in one
         document means two of those too. Which shape shows is decided in the
         CSS below, because `useDisplay` has no viewport to read while the
         server renders and would hand every reader the phone bar first and
         rearrange it a frame later. -->
    <div
      class="app-bar__search"
      :class="{ 'app-bar__search--page-owns': route?.meta.hideSearch }"
      @keydown.esc="searchOpen = false"
    >
      <!-- Not mounted at all on a page that draws its own field, until a phone
           reader opens the bar's - two of these in one document would otherwise
           put two `#omni-search` inputs on the home page, and every selector
           that addresses the search by id would stop meaning one of them. The
           id below covers the one moment they do coexist. -->
      <omni-search
        v-if="!route?.meta.hideSearch || searchOpen"
        :input-id="searchInputId"
      />
    </div>

    <v-spacer class="app-bar__hideable" />

    <template #append>
      <!-- Phone only. The field itself is 300px and a phone's bar has room for
           the logo and the account button and little else, so before this the
           search was clipped out of the bar on every page that carried it and
           absent from the home page, which hides it - leaving a phone reader
           no way to search at all once the home page's own field scrolled
           away. -->
      <v-btn
        v-if="!searchOpen"
        aria-label="Szukaj"
        class="app-bar__search-open"
        data-testid="app-bar-search-open"
        :icon="mdiMagnify"
        @click="openSearch"
      />
      <v-btn
        v-else
        aria-label="Zamknij wyszukiwarkę"
        class="app-bar__search-close"
        data-testid="app-bar-search-close"
        :icon="mdiClose"
        @click="searchOpen = false"
      />

      <v-btn v-if="mdAndUp" text to="/tematy">Tematy</v-btn>
      <v-btn v-if="mdAndUp" text to="/o-nas">O nas</v-btn>
      <v-btn v-if="mdAndUp" text to="/pomoc">Działaj z nami</v-btn>
      <span class="app-bar__hideable d-flex align-center">
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
      </span>

      <!-- Phone only, and the counterpart to the three buttons above: below md
           they are all `v-if="mdAndUp"`, so the bar carried no navigation at
           all and the footer at the very bottom of the page was the only way
           to reach any of these. It still is, and it should be - but it should
           not be the only one. -->
      <v-menu location="bottom end">
        <template #activator="{ props: activator }">
          <v-btn
            v-bind="activator"
            aria-label="Menu"
            class="app-bar__nav app-bar__hideable"
            data-testid="app-bar-nav"
            :icon="mdiMenu"
          />
        </template>
        <v-list density="comfortable" min-width="200">
          <v-list-item
            v-for="link in phoneNav"
            :key="link.to"
            :data-testid="`app-bar-nav-${link.to.slice(1)}`"
            :prepend-icon="link.icon"
            :title="link.title"
            :to="link.to"
          />
        </v-list>
      </v-menu>
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
          :prepend-icon="mdiInboxArrowDown"
          variant="text"
          to="/admin/rewizje/kolejka"
        >
          Kolejka
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
          v-if="isAdmin"
          :prepend-icon="mdiMessageAlertOutline"
          variant="text"
          to="/admin/opinie"
        >
          Zgłoszenia
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
    <FeedbackLauncher />
  </v-main>
</template>

<script lang="ts" setup>
import {
  mdiAccount,
  mdiClose,
  mdiHandHeartOutline,
  mdiInboxArrowDown,
  mdiInformationOutline,
  mdiLightningBolt,
  mdiMagnify,
  mdiMenu,
  mdiNewspaperVariantOutline,
  mdiShieldAccount,
  mdiTagOutline,
  mdiViewList,
  mdiNoteTextOutline,
  mdiMessageAlertOutline,
} from "@mdi/js";
import { computed, nextTick, ref, watch } from "vue";
import { useAuthState } from "@/composables/auth";
import { useDisplay } from "vuetify";

const { mdAndUp } = useDisplay();
const { user, userConfig, logout, isAdmin } = useAuthState();
const route = useRoute();
const loginDialog = ref(false);

/** Whether the phone bar has given itself over to the search field. Never true
 * on a desktop, where the magnifier that sets it is not drawn. */
const searchOpen = ref(false);

/** What the phone's overflow menu offers. The same four entries as the footer's
 * "O projekcie" column, which until now was where a phone reader had to go for
 * any of them - and it sits below however long the page happens to be. Kept
 * here rather than shared with the footer: the footer also carries the legal
 * pages and the social links, and those belong at the bottom of a page rather
 * than one tap from every screen. */
const phoneNav = [
  { title: "Tematy", to: "/tematy", icon: mdiTagOutline },
  { title: "Źródła", to: "/zrodla", icon: mdiNewspaperVariantOutline },
  { title: "O nas", to: "/o-nas", icon: mdiInformationOutline },
  { title: "Działaj z nami", to: "/pomoc", icon: mdiHandHeartOutline },
];

/** The bar's field, which is the canonical `omni-search` everywhere except the
 * home page - there the page's own field has that id and this one stands
 * beside it. */
const searchInputId = computed(() =>
  route?.meta?.hideSearch ? "omni-search-bar" : "omni-search",
);

async function openSearch() {
  searchOpen.value = true;
  // The field was `display: none` - or, on a page that owns one, not mounted -
  // until the line above, so it can only take focus once Vue has drawn the bar
  // again.
  await nextTick();
  document.getElementById(searchInputId.value)?.focus();
}

// Picking a result navigates, and the bar has to be a bar again when the new
// page arrives - otherwise the reader lands somewhere with no logo, no account
// button and their own query still in the field.
watch(
  () => route.fullPath,
  () => {
    searchOpen.value = false;
  },
);
const maxWidth = computed(() =>
  route?.meta?.fullWidth ? "none" : (route?.meta?.maxWidth ?? 1200),
);
const rootPadding = computed(() => (route?.meta?.fullWidth ? 0 : undefined));
const affineLink = computed(() => route?.meta?.affineLink);
const pictureURL = computed(() => userConfig?.data?.value?.photoURL);
</script>

<style scoped>
/* The search in the app bar, in its two shapes.
 *
 * Media queries rather than `useDisplay`, because the bar is server rendered
 * and the composable has no viewport to answer with until hydration - it would
 * hand every reader the phone bar first and rearrange it a frame later. The
 * breakpoint is Vuetify's `md`, i.e. the one the rest of the bar already uses.
 */
.app-bar__search,
.app-bar__search-open,
.app-bar__search-close {
  display: none;
}

@media (min-width: 960px) {
  .app-bar__search {
    display: block;
  }

  /* The three buttons it stands in for are drawn in full up here. */
  .app-bar__nav {
    display: none;
  }

  /* The page draws a search field of its own - the home page does, as its
     first screen - so the bar's would be the second one on top of it. */
  .app-bar__search--page-owns {
    display: none;
  }
}

@media (max-width: 959.98px) {
  .app-bar__search-open {
    display: inline-flex;
  }

  .app-bar--searching .app-bar__search {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
  }

  /* VAutocomplete's `width` is an inline style, so the 300px the desktop bar
     wants can only be given back with `!important`. */
  .app-bar--searching .app-bar__search :deep(.v-input) {
    width: 100% !important;
  }

  /* Everything the field needs the room of. */
  .app-bar--searching .app-bar__hideable,
  .app-bar--searching .app-bar__search-open {
    display: none !important;
  }

  .app-bar--searching .app-bar__search-close {
    display: inline-flex;
  }
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
