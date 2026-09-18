#!/usr/bin/env bun
/**
 * Build the addon .mcpack from this repository and verify what went into it.
 *
 * A .mcpack is a ZIP archive whose members sit at the archive root: manifest.json
 * and the pack's own files, with no wrapper folder and nothing from the
 * repository that is not part of the pack.
 *
 * Usage:
 *   bun run .github/scripts/build-mcpack.ts --version 1.2.3 --out dist/safe-villages-v1.2.3.mcpack
 */

import { Glob } from "bun";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { unzipSync, zipSync } from "fflate";

// What ships, relative to the repository root. Deliberately explicit: a new pack
// directory (entities/, textures/, blocks/, ...) is added here by hand, and nothing
// that is not named can reach a release - README, LICENSE, .github and node_modules
// stay out even if they exist. The build fails if manifest.json declares a module
// entry that this list does not cover.
const PACK_PATHS = ["manifest.json", "pack_icon.png", "scripts/**/*"];

type Manifest = { header?: { version?: number[] }; modules?: { entry?: string }[] };

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function packMembers(): string[] {
  const members = new Set<string>();
  for (const pattern of PACK_PATHS) {
    for (const path of new Glob(pattern).scanSync({ onlyFiles: true })) members.add(path);
  }
  return [...members].sort();
}

/**
 * Read the archive back: a pack that does not open is not a release. This proves the
 * archive is well formed, holds the version it claims, and contains exactly the
 * intended files - nothing missing and nothing extra. Because it reads with the same
 * library that wrote, the workflow also runs `unzip -t` on the artifact: only a
 * foreign reader can see a library-wide incompatibility.
 */
function verify(path: string, version: string, manifest: Manifest, expected: string[]): string[] {
  const entries = unzipSync(readFileSync(path));
  const names = Object.keys(entries);

  for (const name of names) {
    // A name that escapes the root, or one a Windows unpacker would read as a
    // path (backslash, drive prefix), must never leave this script.
    if (name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split("/").includes("..")) {
      fail(`unsafe path in archive: ${name}`);
    }
  }

  if (!names.includes("manifest.json")) {
    fail("manifest.json is not at the archive root - the game will not load this pack");
  }

  let packed: Manifest;
  try {
    packed = JSON.parse(new TextDecoder().decode(entries["manifest.json"]));
  } catch (error) {
    fail(`the packed manifest is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const declared = (packed.header?.version ?? []).join(".");
  if (declared !== version) {
    fail(`the packed manifest declares ${declared || "no version"}, expected ${version}`);
  }

  for (const module of manifest.modules ?? []) {
    if (module.entry && !names.includes(module.entry)) {
      fail(`module entry ${JSON.stringify(module.entry)} is missing from the archive`);
    }
  }

  // Exactly the intended members: nothing missing, and nothing extra.
  const missing = expected.filter((member) => !names.includes(member));
  if (missing.length > 0) fail(`archive is missing ${JSON.stringify(missing)}`);
  if (names.length !== expected.length) {
    fail(`archive holds ${names.length} files, expected ${expected.length}`);
  }

  return names;
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const version = readFlag("version");
const out = readFlag("out");

if (!version || !out) {
  console.error("usage: bun run .github/scripts/build-mcpack.ts --version <x.y.z> --out <path.mcpack>");
  process.exit(2);
}

let manifest: Manifest;
try {
  manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
} catch (error) {
  fail(`manifest.json is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
}

const inManifest = (manifest.header?.version ?? []).join(".");
if (inManifest !== version) {
  fail(`manifest.json declares ${inManifest || "no version"}, expected ${version}`);
}

const members = packMembers();
const files = Object.fromEntries(members.map((member) => [member, readFileSync(member)]));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, zipSync(files, { level: 9 }));

const names = verify(out, version, manifest, members);
console.log(`built ${out} with ${names.length} files:\n  ${names.join("\n  ")}`);
