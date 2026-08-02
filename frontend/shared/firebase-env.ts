// Which set of Firebase data a build talks to.
//
// The interesting one is `preview`: a deployment of a feature branch, reachable
// from a phone, that must not be able to touch the data koryta.pl serves. It
// runs in the same Firebase project as production - same web app, same Auth
// users, same App Check registration, so nothing has to be set up twice - but
// against its own Firestore database and its own Realtime Database instance,
// both refreshed from the nightly export.
//
// Sharing the project means one wrong string is the difference between a
// throwaway environment and writing into production, so the values are pinned
// here and asserted at boot rather than left to whatever the environment
// happens to supply. See assertFirebaseTarget below.
export type KorytaEnv = "local" | "preview" | "prod";

export const KORYTA_ENVS: readonly KorytaEnv[] = ["local", "preview", "prod"];

export type FirebaseTarget = {
  /** Firestore database id within the project - not the project id. */
  firestoreDatabase: string;
  /**
   * Where the `users` collection lives. Production keeps it in the unnamed
   * database rather than alongside everything else - useFirestore(), which is
   * what those two call sites used, returns "(default)" - and moving it would
   * be a data migration, not a deployment change. Preview has no such history,
   * so it folds `users` into its one database.
   */
  usersDatabase: string;
  /** Realtime Database instance URL, as the SDKs want it. */
  databaseURL: string;
};

// Named so scripts outside Nuxt can default to it without importing a target.
export const PROD_FIRESTORE_DATABASE_ID = "koryta-pl";

// The emulator hosts the production database id (firebase.json pins it), so an
// export drops straight in. Nothing here reaches a real project anyway.
const LOCAL: FirebaseTarget = {
  firestoreDatabase: PROD_FIRESTORE_DATABASE_ID,
  usersDatabase: "(default)",
  // Replaced by localTarget() with the URL of whichever project is being
  // emulated; this is only what the default one works out to.
  databaseURL: "https://demo-koryta-pl-default-rtdb.firebaseio.com",
};

const PROD: FirebaseTarget = {
  firestoreDatabase: PROD_FIRESTORE_DATABASE_ID,
  usersDatabase: "(default)",
  // What the client SDK derives from the project id when no URL is given,
  // which is how this app addressed the instance before the URL was explicit.
  databaseURL: "https://koryta-pl-default-rtdb.firebaseio.com",
};

// Created by scripts/setup-preview-env.sh. Every field differs from PROD,
// which is the property assertFirebaseTarget checks.
const PREVIEW: FirebaseTarget = {
  firestoreDatabase: "koryta-pl-preview",
  usersDatabase: "koryta-pl-preview",
  databaseURL: "https://koryta-pl-preview.firebaseio.com",
};

export const FIREBASE_TARGETS: Record<KorytaEnv, FirebaseTarget> = {
  local: LOCAL,
  preview: PREVIEW,
  prod: PROD,
};

/**
 * The local target for whichever project is being emulated - `demo-koryta-pl`
 * normally, `koryta-pl` under USE_PROD_PROJECT.
 *
 * The Realtime Database namespace has to keep following the project id: that
 * is what the client SDK derived before the URL was written out, and it is the
 * namespace the emulator already has rules for.
 */
export function localTarget(projectId: string): FirebaseTarget {
  return {
    ...LOCAL,
    databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
  };
}

/**
 * The Firestore database id for the one-off scripts under scripts/ and the
 * e2e specs, which build their own admin app instead of going through Nuxt.
 *
 * Defaults to the production id, which the emulator also serves, so pointing a
 * migration at the preview copy is NUXT_PUBLIC_FIRESTORE_DATABASE away.
 */
export function firestoreDatabaseFromEnv(): string {
  return (
    process.env.NUXT_PUBLIC_FIRESTORE_DATABASE || PROD_FIRESTORE_DATABASE_ID
  );
}

export function isKorytaEnv(value: unknown): value is KorytaEnv {
  return KORYTA_ENVS.includes(value as KorytaEnv);
}

/**
 * Reads KORYTA_ENV, falling back to whether the caller looks local.
 *
 * An unrecognised value is an error rather than a fallback: "prod" spelled
 * wrong must not quietly select production.
 */
export function resolveKorytaEnv(
  raw: string | undefined,
  isLocal: boolean,
): KorytaEnv {
  if (raw === undefined || raw === "") return isLocal ? "local" : "prod";
  if (!isKorytaEnv(raw)) {
    throw new Error(
      `Unknown KORYTA_ENV ${JSON.stringify(raw)}; expected one of ${KORYTA_ENVS.join(", ")}`,
    );
  }
  return raw;
}

/**
 * Refuses a target that does not match the environment it claims to be.
 *
 * The failure this exists for: a preview deployment whose env vars did not
 * arrive (or arrived empty) falls back to the defaults baked into the build,
 * which are production's - so it would come up looking fine and write into the
 * live database. Preview must differ from production on both stores, and
 * production must be exactly production.
 */
export function assertFirebaseTarget(
  env: KorytaEnv,
  target: FirebaseTarget,
): void {
  const complain = (message: string) => {
    throw new Error(`Refusing to start: ${message}`);
  };

  if (env === "preview") {
    if (target.firestoreDatabase === PROD.firestoreDatabase) {
      complain(
        `KORYTA_ENV=preview but Firestore database is production's (${PROD.firestoreDatabase}). ` +
          "Set NUXT_PUBLIC_FIRESTORE_DATABASE to the preview database.",
      );
    }
    if (target.usersDatabase === PROD.usersDatabase) {
      complain(
        `KORYTA_ENV=preview but the users database is production's (${PROD.usersDatabase}). ` +
          "Set NUXT_PUBLIC_USERS_DATABASE to the preview database.",
      );
    }
    if (target.databaseURL === PROD.databaseURL) {
      complain(
        `KORYTA_ENV=preview but the Realtime Database URL is production's (${PROD.databaseURL}). ` +
          "Set NUXT_PUBLIC_DATABASE_URL to the preview instance.",
      );
    }
    return;
  }

  if (env === "prod") {
    if (
      target.firestoreDatabase !== PROD.firestoreDatabase ||
      target.usersDatabase !== PROD.usersDatabase ||
      target.databaseURL !== PROD.databaseURL
    ) {
      complain(
        "KORYTA_ENV=prod but the Firebase target is not production's. " +
          "Production reads no overrides; drop them or set KORYTA_ENV=preview.",
      );
    }
  }
}
