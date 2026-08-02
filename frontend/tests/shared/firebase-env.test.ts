import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  assertFirebaseTarget,
  FIREBASE_TARGETS,
  resolveKorytaEnv,
} from "../../shared/firebase-env";

describe("resolveKorytaEnv", () => {
  it("falls back to how the caller was built", () => {
    expect(resolveKorytaEnv(undefined, true)).toBe("local");
    expect(resolveKorytaEnv(undefined, false)).toBe("prod");
    expect(resolveKorytaEnv("", false)).toBe("prod");
  });

  it("takes an explicit environment over the fallback", () => {
    expect(resolveKorytaEnv("preview", false)).toBe("preview");
    expect(resolveKorytaEnv("prod", true)).toBe("prod");
  });

  it("rejects a value it does not recognise rather than guessing", () => {
    expect(() => resolveKorytaEnv("production", false)).toThrow(/Unknown/);
    expect(() => resolveKorytaEnv("Preview", false)).toThrow(/Unknown/);
  });
});

describe("assertFirebaseTarget", () => {
  it("accepts each environment paired with its own target", () => {
    for (const env of ["local", "preview", "prod"] as const) {
      expect(() =>
        assertFirebaseTarget(env, FIREBASE_TARGETS[env]),
      ).not.toThrow();
    }
  });

  // The failure this guards: a preview deployment whose environment variables
  // did not arrive falls back to the build's defaults, which are production's.
  it("refuses a preview pointed at any production store", () => {
    expect(() =>
      assertFirebaseTarget("preview", {
        ...FIREBASE_TARGETS.preview,
        firestoreDatabase: FIREBASE_TARGETS.prod.firestoreDatabase,
      }),
    ).toThrow(/Firestore database is production's/);

    expect(() =>
      assertFirebaseTarget("preview", {
        ...FIREBASE_TARGETS.preview,
        usersDatabase: FIREBASE_TARGETS.prod.usersDatabase,
      }),
    ).toThrow(/users database is production's/);

    expect(() =>
      assertFirebaseTarget("preview", {
        ...FIREBASE_TARGETS.preview,
        databaseURL: FIREBASE_TARGETS.prod.databaseURL,
      }),
    ).toThrow(/Realtime Database URL is production's/);
  });

  it("refuses production pointed anywhere else", () => {
    expect(() =>
      assertFirebaseTarget("prod", FIREBASE_TARGETS.preview),
    ).toThrow(/not production's/);
  });

  it("keeps every preview store distinct from production's", () => {
    const { preview, prod } = FIREBASE_TARGETS;
    expect(preview.firestoreDatabase).not.toBe(prod.firestoreDatabase);
    expect(preview.usersDatabase).not.toBe(prod.usersDatabase);
    expect(preview.databaseURL).not.toBe(prod.databaseURL);
  });
});

describe("apphosting.preview.yaml", () => {
  // The deployment only ever sees the yaml, and the boot check only asks
  // whether the values differ from production - a typo in a database id would
  // get past both and serve an empty site. This is what ties the two together.
  const yaml = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../apphosting.preview.yaml",
    ),
    "utf8",
  );

  const envVar = (name: string) =>
    yaml.match(
      new RegExp(`- variable: ${name}\\s*\\n\\s*value: "?([^"\\n]+)"?`),
    )?.[1];

  it("declares the ids that shared/firebase-env.ts calls preview", () => {
    expect(envVar("KORYTA_ENV")).toBe("preview");
    expect(envVar("NUXT_PUBLIC_KORYTA_ENV")).toBe("preview");
    expect(envVar("NUXT_PUBLIC_FIRESTORE_DATABASE")).toBe(
      FIREBASE_TARGETS.preview.firestoreDatabase,
    );
    expect(envVar("NUXT_PUBLIC_USERS_DATABASE")).toBe(
      FIREBASE_TARGETS.preview.usersDatabase,
    );
    expect(envVar("NUXT_PUBLIC_DATABASE_URL")).toBe(
      FIREBASE_TARGETS.preview.databaseURL,
    );
  });

  it("keeps the preview out of search results", () => {
    expect(envVar("NUXT_PUBLIC_SITE_INDEXABLE")).toBe("false");
  });
});

describe("no hardcoded database ids", () => {
  const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

  // A call site that names the database itself is a call site that ignores
  // KORYTA_ENV, which in a preview deployment means writing to production.
  // Everything goes through appFirestore/appDatabase instead.
  it("routes every Firestore and RTDB handle through the helpers", () => {
    const hits = grep(
      String.raw`getFirestore\([^)]*"(koryta-pl|\(default\))"|useDatabase\(\)|useFirestore\(\)`,
      ["app", "server", "scripts", "tests"],
    ).filter(
      (line) =>
        // The helpers themselves, the module that defines the ids, and the
        // mocks in unit tests are where the names are allowed to appear.
        !line.startsWith("app/utils/firebase.ts") &&
        !line.startsWith("server/utils/firebase.ts") &&
        !line.startsWith("shared/firebase-env.ts") &&
        !line.includes(".test.ts"),
    );
    expect(hits).toEqual([]);
  });

  function grep(pattern: string, dirs: string[]): string[] {
    try {
      return execFileSync(
        "grep",
        ["-rnE", pattern, "--include=*.ts", "--include=*.vue", ...dirs],
        { cwd: frontend, encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter(Boolean);
    } catch (error) {
      // grep exits 1 when it matches nothing, which is the passing case.
      if ((error as { status?: number }).status === 1) return [];
      throw error;
    }
  }
});
