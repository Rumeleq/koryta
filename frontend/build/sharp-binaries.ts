import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { useLogger } from "nuxt/kit";
import type { Nitro } from "nitropack";

/**
 * Copy sharp's native binaries into the server bundle.
 *
 * App Hosting ships `.output` and nothing else, so everything the server needs
 * has to be traced into `.output/server/node_modules`. `@vercel/nft` knows how
 * to emit the `@img/sharp-*` packages — the prebuilt `.node` addon and the
 * libvips shared objects it links against — but only when it recognises the
 * file it is tracing as `sharp/lib/index.js`.
 *
 * sharp 0.35 moved that entry to `dist/index.mjs`, so the special case never
 * fires. @nuxt/image 2 pulls in ipx 4, ipx 4 needs sharp ^0.35.3, and the
 * bundle then holds sharp with no binding at all: every `/_ipx/**` URL dies on
 * "Cannot read properties of undefined (reading 'output')" and Nitro turns
 * that into a 500. Locally it looks fine, because there the whole
 * `node_modules` is on disk.
 *
 * @nuxt/image's own post-build check does not catch it. It only asserts that
 * `node_modules/@img` is non-empty, and `@img/colour` — plain JavaScript, so
 * traced normally — is enough to satisfy that.
 *
 * So do what nft would have done: read the optional dependencies off the sharp
 * that actually got traced, and copy those package directories in whole.
 * Delete this once nft handles sharp 0.35's layout (the special case is keyed
 * on the path, in `@vercel/nft/out/utils/special-cases.js`).
 *
 * Directories are searched by path rather than resolved. Neither sharp nor the
 * binary packages list `./package.json` in their `exports`, so `require.resolve`
 * cannot reach the manifests these decisions are made from.
 */
export function bundleSharpBinaries(nitro: Nitro) {
  if (nitro.options.dev) {
    return;
  }

  nitro.hooks.hook("compiled", () => {
    const logger = useLogger("sharp-binaries");
    const modules = join(nitro.options.rootDir, "node_modules");
    const serverModules = join(nitro.options.output.serverDir, "node_modules");

    const bundled = readPackage(join(serverModules, "sharp"));
    if (!bundled) {
      return;
    }

    // ipx nests its own sharp, so prefer that one: the root copy is held at
    // a different version by Dependabot, and a binary package only works
    // with the sharp it was published alongside.
    const roots = [join(modules, "ipx/node_modules"), modules];
    const sharpDir = roots
      .map((root) => join(root, "sharp"))
      .find((dir) => readPackage(dir)?.version === bundled.version);
    if (!sharpDir) {
      logger.warn(
        `No source tree for sharp ${bundled.version}; /_ipx will fail at runtime.`,
      );
      return;
    }

    // The binaries are `@img/sharp-<platform>-<arch>`, one of which is
    // installed for this machine, plus the `@img/sharp-libvips-*` package
    // it links against. Both are optional dependencies, so walking them and
    // skipping whatever is absent picks out our platform.
    // libvips is an optional dependency of both sharp and the binary
    // package, so the walk reaches it twice.
    const copied = new Set<string>();
    const copy = (name: string, version: string): string | undefined => {
      const dir = roots
        .map((root) => join(root, name))
        .find((candidate) => readPackage(candidate)?.version === version);
      if (!dir) {
        return undefined;
      }
      if (!copied.has(name)) {
        cpSync(dir, join(serverModules, name), {
          recursive: true,
          dereference: true,
        });
        copied.add(name);
      }
      return dir;
    };

    for (const [name, version] of optionalDeps(readPackage(sharpDir))) {
      const dir = copy(name, version);
      if (!dir) {
        continue;
      }
      for (const [inner, innerVersion] of optionalDeps(readPackage(dir))) {
        copy(inner, innerVersion);
      }
    }

    if (copied.size === 0) {
      logger.warn(
        `No @img binaries matched sharp ${bundled.version}; /_ipx will fail at runtime.`,
      );
    } else {
      logger.info(`Bundled sharp binaries: ${[...copied].join(", ")}`);
    }
  });
}

interface Manifest {
  version: string;
  // The binary packages are pinned to an exact version, so the range doubles as
  // the version to check a candidate directory against.
  optionalDependencies?: Record<string, string>;
}

function readPackage(dir: string): Manifest | undefined {
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) {
    return undefined;
  }
  return JSON.parse(readFileSync(manifest, "utf8"));
}

function optionalDeps(pkg: Manifest | undefined): [string, string][] {
  return Object.entries(pkg?.optionalDependencies || {});
}
