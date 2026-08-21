import {
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import { computedAsync } from "@vueuse/core";
import {
  useCurrentUser,
  useFirebaseApp,
  useFirebaseAuth,
  useIsCurrentUserLoaded,
} from "vuefire";
import { collection, doc, getFirestore } from "firebase/firestore";
import type { NotificationPreferences } from "~~/shared/notifications";

export type NewsletterPreferences = {
  /** Notify about recently found people. */
  recentPeople?: boolean;
  /** Notify about calls to action. */
  callsToAction?: boolean;
};

export type UserConfig = {
  photoURL?: string;
  displayName?: string;
  newsletter?: NewsletterPreferences;
  /** Mail about what happened to this user's own contributions. Separate from
   * `newsletter`, which is broadcast to whoever asked for it: these default to
   * on and are read by the server before it queues anything. */
  notifications?: NotificationPreferences;
};

export function useAuthState() {
  const router = useRouter();
  // Named explicitly, like every other client call site (votes.ts, notes.ts,
  // useMyContributions.ts). `useFirestore()` is `getFirestore(app)` with no
  // database id, i.e. `(default)` - a database this project does not use, whose
  // rules are not deployed, and which the emulator plugin never connects. The
  // server reads this same document to decide whether to email somebody
  // (server/utils/notifications.ts), so a config written to the wrong database
  // is an opt-out that silently does nothing.
  const db = getFirestore(useFirebaseApp(), "koryta-pl");

  const user = useCurrentUser();
  const isAdmin = computedAsync(
    async () =>
      await user.value?.getIdTokenResult().then((r) => !!r.claims.admin),
  );
  const idToken = computed(() => user.value?.getIdToken());
  const auth = useFirebaseAuth()!;

  const userConfigRef = computed(() =>
    user.value ? doc(collection(db, "users"), user.value.uid) : null,
  );
  const userConfig = useDocument<UserConfig>(userConfigRef);

  const logout = async () => {
    try {
      await signOut(auth);
      console.debug("User logged out successfully!");
      router.push("/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const login = async (email: string, pass: string) => {
    return await signInWithEmailAndPassword(auth, email, pass);
  };

  const register = async (email: string, pass: string) => {
    return await createUserWithEmailAndPassword(auth, email, pass);
  };

  /** Sends the "set a new password" link to `email`.
   *
   * Firebase's email enumeration protection makes this succeed even for an
   * address with no account, so the caller must not report back whether the
   * address is known.
   */
  const resetPassword = async (email: string) => {
    return await sendPasswordResetEmail(auth, email);
  };

  return {
    user,
    isAdmin,
    idToken,
    userConfig,
    logout,
    login,
    register,
    resetPassword,
  };
}

/** Resolves once firebase has restored (or ruled out) the signed in user. */
async function waitForAuthReady() {
  const isAuthReady = useIsCurrentUserLoaded();
  if (isAuthReady.value) return;

  await new Promise<void>((resolve) => {
    const unwatch = watch(
      isAuthReady,
      (ready) => {
        if (ready) {
          unwatch();
          resolve(); // Release the pause!
        }
      },
      { immediate: true },
    );
  });
}

/** One off authenticated request, for event handlers such as form submits.
 *
 * Use this instead of `authFetch` for anything that is not setup time data
 * loading: `authFetch` wraps `useFetch`, which registers async data keyed by
 * the url. A second call for the same key aborts the first one, and the
 * caller of the aborted request is left awaiting a promise that never
 * settles, so a submit button would spin forever even though the request
 * itself went through.
 */
export async function authRequest<T>(
  url: string,
  options: { method?: string; body?: unknown; query?: unknown } = {},
): Promise<T> {
  await waitForAuthReady();

  const user = useCurrentUser();
  const headers = new Headers();
  if (user.value) {
    headers.set("Authorization", `Bearer ${await user.value.getIdToken()}`);
  }

  return await $fetch<T>(url, {
    method: (options.method || "POST") as "POST",
    body: options.body as Record<string, unknown>,
    query: options.query as Record<string, unknown>,
    headers,
  });
}

export const authFetch = createUseFetch({
  onRequest: async function ({ options }) {
    if (import.meta.server) {
      return;
    }

    const user = useCurrentUser();
    await waitForAuthReady();

    if (user.value) {
      // TODO don't auto add latest here
      options.query = { ...options.query, latest: true };

      // Attach auth token to requests that are not GET or HEAD.
      const method = (unref(options.method) || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        const token = await user.value.getIdToken();
        const headers = new Headers(unref(options.headers) || {});
        headers.set("Authorization", `Bearer ${token}`);
        options.headers = headers;
      }
    }
  },
});
