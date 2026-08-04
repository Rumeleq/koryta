import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { ref } from "vue";
import { useAuthState } from "@/composables/auth";

// Hoisted variables for mocks
const {
  mockIdTokenFn,
  mockAuth,
  mockUseFetchSpy,
  mockUseDocumentSpy,
  mockSendPasswordResetEmail,
} = vi.hoisted(() => {
  const fn = vi.fn();
  const tokenFn = vi.fn();
  const docFn = vi.fn();
  return {
    mockUseFetchSpy: fn,
    mockIdTokenFn: tokenFn,
    mockUseDocumentSpy: docFn,
    mockSendPasswordResetEmail: vi.fn(),
    mockAuth: {
      currentUser: {
        uid: "test-uid",
        getIdToken: tokenFn,
        getIdTokenResult: vi
          .fn()
          .mockResolvedValue({ claims: { admin: false }, token: "token" }),
      },
    },
  };
});

// Mock firebase/auth used by the composable
vi.mock("firebase/auth", async () => {
  return {
    getAuth: vi.fn(() => mockAuth),
    onIdTokenChanged: vi.fn(),
    signOut: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    sendPasswordResetEmail: mockSendPasswordResetEmail,
    GoogleAuthProvider: vi.fn(),
    Auth: {},
  };
});

// Mock firebase/firestore
vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(),
  collection: vi.fn(),
  doc: vi.fn(),
}));

// Mock vuefire to prevent initialization errors and provide useDocument
vi.mock("vuefire", () => ({
  useFirebaseAuth: () => mockAuth,
  useFirestore: vi.fn(),
  useDocument: mockUseDocumentSpy,
  useIsCurrentUserLoaded: () => ref(true),
  useCurrentUser: () => ref(mockAuth.currentUser),
}));
vi.mock("nuxt-vuefire", () => ({}));

// `useAuthState` reaches these through Nuxt's auto-imports, which re-export
// them from vuefire (see .nuxt/imports.d.ts). Mocking the `vuefire` module
// alone only covers an explicit import, and whether the auto-import chain had
// already been evaluated against the real module varied with which test file
// booted the Nuxt environment first - so `useCurrentUser` threw "called before
// the VueFireAuth module was added" in a full run and passed on its own. Every
// vuefire composable the code under test calls is mocked here as well, so the
// file no longer depends on that order.
mockNuxtImport("useFirebaseAuth", () => {
  return () => mockAuth;
});

mockNuxtImport("useDocument", () => {
  return mockUseDocumentSpy;
});

mockNuxtImport("useCurrentUser", () => {
  return () => ref(mockAuth.currentUser);
});

mockNuxtImport("useFirestore", () => {
  return () => undefined;
});

describe("useAuthState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFetchSpy.mockClear();
    mockIdTokenFn.mockReset();
    mockIdTokenFn.mockResolvedValue("mock-token");
    mockAuth.currentUser.getIdToken = mockIdTokenFn;
  });

  it("returns expected properties", () => {
    const state = useAuthState();
    expect(state.user).toBeDefined();
    expect(state.isAdmin).toBeDefined();
    expect(state.logout).toBeTypeOf("function");
    expect(state.login).toBeTypeOf("function");
    expect(state.register).toBeTypeOf("function");
    expect(state.resetPassword).toBeTypeOf("function");
  });

  it("resetPassword sends the reset email for the given address", async () => {
    const state = useAuthState();
    await state.resetPassword("someone@example.com");
    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
      mockAuth,
      "someone@example.com",
    );
  });
});
