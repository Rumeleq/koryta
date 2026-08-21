import { describe, it, expect, vi, beforeEach } from "vitest";
import { getFirestore } from "firebase/firestore";
import { useAuthState } from "../../app/composables/auth";

/** The database id every Firestore handle in this app must name.
 *
 * `useFirestore()` from vuefire does not: it is `getFirestore(app)`, which is
 * the `(default)` database. This project stores everything in `koryta-pl`,
 * deploys its rules only there, and connects only that one to the emulator - so
 * a handle that omits the id reads and writes a database nothing else touches.
 * The notification opt-out is the case that made this matter: the server checks
 * `users/{uid}` in `koryta-pl` before sending mail, so a preference saved to
 * `(default)` is a switch that silently does nothing.
 */
const DATABASE = "koryta-pl";

vi.mock("firebase/firestore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/firestore")>();
  return {
    ...actual,
    getFirestore: vi.fn(() => ({ type: "firestore" })),
    collection: vi.fn(() => ({ type: "collection" })),
    doc: vi.fn(() => ({ type: "doc" })),
  };
});

vi.mock("vuefire", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vuefire")>();
  return {
    ...actual,
    useFirebaseApp: vi.fn(() => ({ name: "[DEFAULT]" })),
    useFirebaseAuth: vi.fn(() => ({ currentUser: null })),
    useCurrentUser: vi.fn(() => ref(null)),
    useIsCurrentUserLoaded: vi.fn(() => ref(true)),
    useDocument: vi.fn(() => ({ data: ref(undefined) })),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("user config storage", () => {
  it("reads the user document from the database the server writes mail from", () => {
    useAuthState();

    expect(getFirestore).toHaveBeenCalledWith(expect.anything(), DATABASE);
  });
});
