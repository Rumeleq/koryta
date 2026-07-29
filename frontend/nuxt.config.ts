// https://nuxt.com/docs/api/configuration/nuxt-config

import { resolveBuildInfo } from "./build-info";

// Force IPv4 for emulators to avoid Node 17+ IPv6 issues
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";
const isLocal =
  !!process.env.VITEST ||
  process.env.USE_EMULATORS === "true" ||
  process.env.NODE_ENV === "development";
const useProdProject = process.env.USE_PROD_PROJECT === "true";
const ssr = process.env.SSR !== "false";
const buildInfo = resolveBuildInfo(isLocal);
console.log(
  "Nuxt Config - isLocal:",
  isLocal,
  "USE_EMULATORS:",
  process.env.USE_EMULATORS,
  "SSR:",
  ssr,
  "appEnv:",
  buildInfo.appEnv,
  "release:",
  buildInfo.release,
);

export default defineNuxtConfig({
  app: {
    head: {
      meta: [
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
        {
          charset: "utf-8",
        },
      ],
      htmlAttrs: {
        lang: "pl",
      },
      link: [
        { rel: "preconnect", href: "https://cdn.jsdelivr.net" },
        { rel: "preconnect", href: "https://firestore.googleapis.com" },
      ],
      style: [],
      script: [],
      noscript: [],
    },
  },

  compatibilityDate: "2025-07-15",

  typescript: {
    strict: true,
    tsConfig: {
      vueCompilerOptions: {
        plugins: [],
      },
    },
  },

  devtools: { enabled: true },

  ssr,

  components: [
    {
      path: "~/components",
      pathPrefix: true,
    },
  ],

  runtimeConfig: {
    public: {
      isLocal,
      // Reported by /api/health and attached to every Sentry event. Each field
      // is overridable at runtime as NUXT_PUBLIC_BUILD_INFO_*, so a backend can
      // correct its own label without a rebuild.
      buildInfo,
      sentry: {
        // Prod carries the traffic, so it samples; autopush carries almost
        // none, and there a full trace on every request is what makes a single
        // manual click worth looking at.
        tracesSampleRate: buildInfo.appEnv === "prod" ? 0.1 : 1.0,
        replaysSessionSampleRate: buildInfo.appEnv === "prod" ? 0.01 : 0.1,
      },
    },
  },

  modules: [
    "@pinia/nuxt",
    "@nuxt/content",
    "@nuxt/fonts",
    "@nuxt/eslint",
    "nuxt-vuefire",
    "vuetify-nuxt-module",
    "@sentry/nuxt/module",
    "@nuxt/test-utils/module",
    "@nuxtjs/seo",
    "@nuxt/image",
    "@nuxtjs/plausible",
  ],

  site: {
    url: isLocal ? "http://localhost:3000" : "https://koryta.pl",
    name: "Koryta.pl",
    description: "Największy, niezależny agregator koryciarstwa",
    defaultLocale: "pl",
  },

  sitemap: {
    sources: ["/api/_sitemap-urls"],
  },
  plausible: {
    // Prevent tracking on localhost
    ignoredHostnames: ["localhost"],
  },

  eslint: {
    checker: true,
  },

  fonts: {
    families: [{ name: "Roboto", provider: "fontsource" }],
    defaults: {
      weights: [100, 300, 400, 500, 700, 900],
      styles: ["normal", "italic"],
      subsets: ["latin", "latin-ext"],
    },
  },

  vuetify: {
    moduleOptions: {
      // Vuetify's auto-imported useLayout shadows the one Nuxt provides, and
      // nothing here needs those auto-imports: every call site imports the
      // composable it wants from "vuetify" by hand.
      importComposables: false,
    },
    vuetifyOptions: {
      icons: {
        defaultSet: "mdi-svg",
      },
      theme: {
        defaultTheme: "light",
        themes: {
          light: {
            colors: {
              primary: "#a8c79f",
              secondary: "#fad3d0",
            },
          },
        },
      },
    },
  },

  vuefire: {
    auth: {
      enabled: true,
    },
    appCheck: {
      enabled: !isLocal,
    },
    config: {
      apiKey: "AIzaSyD54RK-k0TIcJtVbZerx2947XiduteqvaM",
      authDomain:
        isLocal && !useProdProject
          ? "demo-koryta-pl.firebaseapp.com"
          : "koryta-pl.firebaseapp.com",
      projectId: isLocal && !useProdProject ? "demo-koryta-pl" : "koryta-pl",
      storageBucket:
        isLocal && !useProdProject
          ? undefined
          : "koryta-pl.firebasestorage.app",
      messagingSenderId:
        isLocal && !useProdProject ? undefined : "735903577811",
      appId: "1:735903577811:web:53e6461c641b947a4e8626",
    },
    emulators: {
      enabled: isLocal,
      auth: {
        host: "127.0.0.1",
        port: 9099,
      },
      functions: {
        host: "127.0.0.1",
        port: 5001,
      },
      firestore: {
        host: "127.0.0.1",
        port: 8080,
      },
      database: {
        host: "127.0.0.1",
        port: 9000,
      },
      storage: {
        host: "127.0.0.1",
        port: 9199,
      },
    },
    options: {
      firestore: {},
    },
  },

  sentry: {
    sourceMapsUploadOptions: {
      org: "romb",
      project: "koryta-pl",
    },
    telemetry: !isLocal,
  },

  sourcemap: {
    client: "hidden",
  },

  ogImage: {
    defaults: {
      extension: "png",
    },
  },

  nitro: {
    preset: "firebase_app_hosting", // or 'firebase-functions'
    experimental: {
      asyncContext: true,
    },
  },
  routeRules: {
    "/": { swr: 3600 },
    "/admin/**": { ssr: false },
  },
  devServer: {
    host: "127.0.0.1",
  },
  vite: {
    optimizeDeps: {
      include: [
        "@mdi/js",
        "@plausible-analytics/tracker",
        "@vue/devtools-core",
        "@vue/devtools-kit",
        "@vueuse/core",
        "v-network-graph",
        // The layout engine is a separate entry point, imported only once the
        // graph store loads. Discovering it mid-run restarts the optimizer,
        // which reloads every open page and drops the vite-node IPC with it.
        "v-network-graph/lib/force-layout",
        "vue3-apexcharts",
        "vuefire",
      ],
    },
  },
});
