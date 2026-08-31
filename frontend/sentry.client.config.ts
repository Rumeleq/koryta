import * as Sentry from "@sentry/nuxt";

/** Which origins report, and as what.
 *
 * The Sentry module loads this file directly rather than through
 * nuxt.config.ts, so the `isLocal` that gates vuefire and app check there
 * cannot reach it. Until this guard existed every `npm run dev`, every e2e run
 * and every local production build reported into the same project: over the 30
 * days to 2026-08-31, ~1,400 events, of which 30 came from the real site. The
 * rest buried it.
 *
 * An allowlist rather than a check for localhost, because the noisiest source
 * was `nuxt preview` on 127.0.0.1:3000 calling itself production - `dev:build`
 * runs it outside the `cross-env` that sets USE_EMULATORS, so nothing in the
 * environment says local and Sentry falls back to NODE_ENV for the tag. Only
 * the hostname tells the two apart. */
const environments: Record<string, string> = {
  "koryta.pl": "production",
  "autopush.koryta.pl": "autopush",
};
const environment =
  typeof window === "undefined"
    ? undefined
    : environments[window.location.hostname];

Sentry.init({
  enabled: !!environment,
  environment,

  // If set up, you can use your runtime config here
  // dsn: useRuntimeConfig().public.sentry.dsn,
  dsn: "https://bd99c377832328230cfd5519914b9984@o4510028768870400.ingest.de.sentry.io/4510028773392464",

  // We recommend adjusting this value in production, or using tracesSampler
  // for finer control
  tracesSampleRate: 1.0,

  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.01,

  // If the entire session is not sampled, use the below sample rate to sample
  // sessions when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // If you don't want to use Session Replay, just remove the line below:
  integrations: [],

  /** Someone else's code, running in the reader's browser.
   *
   * `__firefox__` is Firefox for iOS injecting its reader-mode bridge, and
   * `window.ethereum` is a wallet extension claiming the name. Neither touches
   * anything we ship, and between them they were the two most frequent
   * production issues on /eksploruj/tabela. */
  ignoreErrors: [/__firefox__/, /window\.ethereum/],

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});
