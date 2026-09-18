#!/usr/bin/env bun
/**
 * Set the pack version in manifest.json for a release.
 *
 * Written back with the file's own tab indentation, so the release commit shows
 * the version fields changing and nothing else. TypeScript/Bun replacement for
 * the inline python3 heredoc this workflow used to run.
 *
 * Usage:
 *   bun run .github/scripts/bump-manifest.ts 1.2.3
 */

import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2];
if (!target) {
  console.error("usage: bun run .github/scripts/bump-manifest.ts <major.minor.patch>");
  process.exit(2);
}

const version = target.split(".").map((part) => Number(part));
if (version.length !== 3 || version.some((part) => !Number.isInteger(part) || part < 0)) {
  console.error(`error: ${JSON.stringify(target)} is not a major.minor.patch version`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.header.version = version;
for (const module of manifest.modules ?? []) {
  module.version = version;
}

writeFileSync("manifest.json", `${JSON.stringify(manifest, null, "\t")}\n`);
console.log("manifest.json now declares", version.join("."));
