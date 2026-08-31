import * as Sentry from "@sentry/nuxt";

/** Only a deployed nitro server reports.
 *
 * The client half can read the hostname; here there is no request yet, so the
 * signal has to come from the environment. `SENTRY_ENABLED` is set for both
 * backends in apphosting.yaml and is the one that is meant to be read;
 * `K_SERVICE` is Cloud Run's own marker, kept as a fallback so a backend that
 * has not picked up the new config still reports.
 *
 * Neither is set by `npm run dev`, `nuxt preview` or vitest, which is the
 * point: those were reporting emulator connection refusals and stale-worktree
 * import failures into the same project as production. */
const enabled =
  process.env.SENTRY_ENABLED === "true" || !!process.env.K_SERVICE;

Sentry.init({
  enabled,

  dsn: "https://bd99c377832328230cfd5519914b9984@o4510028768870400.ingest.de.sentry.io/4510028773392464",

  // We recommend adjusting this value in production, or using tracesSampler
  // for finer control
  tracesSampleRate: 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});
