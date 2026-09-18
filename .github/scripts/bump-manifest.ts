#!/usr/bin/env bun
/**
 * Set the pack version in manifest.json for a release.
 *
 * Written back with the file's own tab indentation, so the release commit shows
 * the version fields changing and nothing else.
 *
 * Usage:
 *   bun run .github/scripts/bump-manifest.ts 1.2.3
 */

import { readFileSync, writeFileSync } from "node:fs";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

const target = process.argv[2];
if (!target) {
  console.error("usage: bun run .github/scripts/bump-manifest.ts <major.minor.patch>");
  process.exit(2);
}

// Strict on purpose: Number() would accept "" as 0, "0x10" as 16 and "1e2" as 100.
const parts = target.split(".");
if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) {
  fail(`${JSON.stringify(target)} is not a major.minor.patch version`);
}
const version = parts.map(Number);

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
if (!manifest?.header || typeof manifest.header !== "object") {
  fail("manifest.json has no header object to version");
}
if (manifest.modules !== undefined && !Array.isArray(manifest.modules)) {
  fail("manifest.json has a malformed modules list");
}

manifest.header.version = version;
for (const module of manifest.modules ?? []) {
  if (!module || typeof module !== "object") fail("manifest.json has a malformed module entry");
  module.version = version;
}

writeFileSync("manifest.json", `${JSON.stringify(manifest, null, "\t")}\n`);
console.log("manifest.json now declares", version.join("."));
