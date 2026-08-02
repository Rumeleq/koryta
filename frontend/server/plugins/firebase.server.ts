import { initializeApp, getApps } from "firebase-admin/app";
import { assertFirebaseTarget, isKorytaEnv } from "~~/shared/firebase-env";

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig();
  const { korytaEnv, firestoreDatabase, usersDatabase, databaseURL } =
    config.public;

  // Runtime overrides arrive as strings from the environment, so this is the
  // first place that can tell "preview" from a typo, or notice that a preview
  // deployment came up pointing at production's data. Throwing here fails the
  // rollout instead of serving a page that writes to the live database.
  if (!isKorytaEnv(korytaEnv)) {
    throw new Error(
      `Refusing to start: unknown KORYTA_ENV ${JSON.stringify(korytaEnv)}`,
    );
  }
  assertFirebaseTarget(korytaEnv, {
    firestoreDatabase,
    usersDatabase,
    databaseURL,
  });

  // Make sure we're not re-initializing the app on every hot-reload
  if (getApps().length === 0) {
    // See: https://firebase.google.com/docs/admin/setup#initialize-sdk
    if (config.public.isLocal) {
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
      process.env.FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";
      process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    }

    initializeApp({
      projectId: config.public.vuefire.config.projectId,
      // Without this the admin SDK has nothing to resolve - it throws "Can't
      // determine Firebase Database URL" rather than guessing the way the
      // client SDK does.
      databaseURL,
    });
  }
});
