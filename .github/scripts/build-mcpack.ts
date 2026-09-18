#!/usr/bin/env bun
/**
 * Build the addon .mcpack from this repository and verify what went into it.
 *
 * A .mcpack is a ZIP archive whose members sit at the archive root: manifest.json
 * and the pack's own directories, with no wrapper folder and nothing from the
 * repository that is not part of the pack (README, LICENSE, .github, ...).
 *
 * Bun built-ins only — Bun.deflateSync / Bun.inflateSync for the entry data and
 * Bun.hash.crc32 for the checksums — so the release pipeline needs no
 * dependencies and no external zip binary. Entry timestamps are fixed at the
 * ZIP epoch (1980-01-01) so the same tree always produces the same archive.
 *
 * Usage:
 *   bun run .github/scripts/build-mcpack.ts --version 1.2.3 --out dist/safe-villages-v1.2.3.mcpack
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

// Directories that belong to a Bedrock pack. Only those present are included, so
// this stays correct as the pack grows without having to list files by hand.
const PACK_DIRS = [
  "scripts",
  "entities",
  "textures",
  "blocks",
  "items",
  "recipes",
  "loot_tables",
  "functions",
  "structures",
  "sounds",
  "ui",
  "models",
  "animations",
  "animation_controllers",
  "spawn_rules",
  "features",
  "feature_rules",
  "particles",
  "dialogue",
  "trading",
  "render_controllers",
] as const;

const REQUIRED_ROOT_FILES = ["manifest.json"] as const;

type ModuleEntry = { entry?: string; version?: number[] };
type Manifest = { header?: { version?: number[] }; modules?: ModuleEntry[] };

const encoder = new TextEncoder();

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const isDir = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Archive names are always POSIX, whatever the host separator is. */
const posix = (path: string): string => path.split(sep).join("/");

/** Reject a name that would escape the archive root when a tool unpacks it. */
function assertSafeName(name: string): void {
  const parts = name.split("/");
  if (name.startsWith("/") || parts.includes("..")) {
    fail(`unsafe path in archive: ${name}`);
  }
}

function walk(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (isDir(path)) walk(path, found);
    else if (isFile(path)) found.push(path);
  }
  return found;
}

/** Every file that belongs in the pack, as POSIX paths relative to the repo root. */
function packMembers(root: string, manifest: Manifest): string[] {
  const members: string[] = [];

  for (const name of REQUIRED_ROOT_FILES) {
    if (!isFile(join(root, name))) fail(`${name} is missing from the repository`);
    members.push(name);
  }

  if (isFile(join(root, "pack_icon.png"))) members.push("pack_icon.png");

  for (const dirName of PACK_DIRS) {
    const directory = join(root, dirName);
    if (!isDir(directory)) continue;
    const found = walk(directory)
      .map((path) => posix(relative(root, path)))
      .sort();
    members.push(...found);
  }

  // A module entry that lives outside the known directories still ships.
  for (const module of manifest.modules ?? []) {
    const entry = module.entry;
    if (!entry) continue;
    const clean = posix(entry);
    if (!isFile(join(root, clean))) fail(`module entry ${JSON.stringify(entry)} does not exist`);
    if (!members.includes(clean)) members.push(clean);
  }

  for (const member of members) assertSafeName(member);
  return members;
}

// --- a minimal ZIP writer -----------------------------------------------------------
// Local file header (30 bytes) + data, then the central directory, then the EOCD.
// Deflate is used when it actually shrinks the entry, otherwise the entry is stored.

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP_EPOCH_DATE = 0x0021; // 1980-01-01, so archives are reproducible

function writeZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const deflated = Bun.deflateSync(entry.data);
    const useDeflate = deflated.length < entry.data.length;
    const body = useDeflate ? deflated : entry.data;
    const method = useDeflate ? 8 : 0;
    const crc = Bun.hash.crc32(entry.data) >>> 0;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, 20, true); // version needed to extract
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, ZIP_EPOCH_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true); // mod time
    cv.setUint16(14, ZIP_EPOCH_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra length
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk number
    cv.setUint16(36, 0, true); // internal attributes
    cv.setUint32(38, 0, true); // external attributes
    cv.setUint32(42, offset, true); // offset of the local header
    central.set(nameBytes, 46);

    localChunks.push(local, body);
    centralChunks.push(central);
    offset += local.length + body.length;
  }

  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(4, 0, true); // this disk
  ev.setUint16(6, 0, true); // disk with the central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true); // comment length

  const parts = [...localChunks, ...centralChunks, eocd];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const archive = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    archive.set(part, cursor);
    cursor += part.length;
  }
  return archive;
}

// --- read it back -------------------------------------------------------------------

type ReadEntry = { name: string; method: number; crc: number; usize: number; data: Uint8Array };

/** Parse the central directory and pull each entry's bytes out of the archive. */
function readZip(archive: Uint8Array): ReadEntry[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

  let eocd = -1;
  for (let i = archive.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail("the archive has no end-of-central-directory record");

  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries: ReadEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== CENTRAL_SIG) fail("malformed central directory");
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const csize = view.getUint32(cursor + 20, true);
    const usize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(archive.subarray(cursor + 46, cursor + 46 + nameLength));

    if (view.getUint32(localOffset, true) !== LOCAL_SIG) fail(`malformed local header for ${name}`);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const stored = archive.subarray(dataStart, dataStart + csize);

    let data: Uint8Array;
    if (method === 0) data = stored;
    else if (method === 8) data = Bun.inflateSync(stored);
    else fail(`entry ${name} uses unsupported compression method ${method}`);

    entries.push({ name, method, crc, usize, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Read the archive back: a pack that does not open is not a release. */
function verify(archivePath: string, version: string, members: string[]): void {
  const entries = readZip(readFileSync(archivePath));
  const names = entries.map((entry) => entry.name);

  for (const entry of entries) {
    assertSafeName(entry.name);
    if (entry.data.length !== entry.usize) {
      fail(`${entry.name} decompressed to ${entry.data.length} bytes, expected ${entry.usize}`);
    }
    const crc = Bun.hash.crc32(entry.data) >>> 0;
    if (crc !== entry.crc) {
      fail(`${entry.name} fails its checksum: ${crc.toString(16)} != ${entry.crc.toString(16)}`);
    }
  }

  if (!names.includes("manifest.json")) {
    fail("manifest.json is not at the archive root - the game will not load this pack");
  }

  const packed = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === "manifest.json")!.data));
  const packedVersion = (packed?.header?.version ?? []).join(".");
  if (packedVersion !== version) {
    fail(`the packed manifest declares ${packedVersion || "no version"}, expected ${version}`);
  }

  const missing = members.filter((member) => !names.includes(member));
  if (missing.length > 0) fail(`archive is missing ${JSON.stringify(missing)}`);
}

// --- cli ----------------------------------------------------------------------------

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const version = readFlag("version");
  const out = readFlag("out");
  const root = readFlag("root") ?? ".";

  if (!version || !out) {
    console.error("usage: bun run .github/scripts/build-mcpack.ts --version <x.y.z> --out <path.mcpack> [--root <dir>]");
    process.exit(2);
  }

  const manifestPath = join(root, "manifest.json");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`manifest.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const declared = (manifest.header?.version ?? []).join(".");
  if (declared !== version) {
    fail(`manifest.json declares ${declared || "no version"}, expected ${version}`);
  }

  const members = packMembers(root, manifest);

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    writeZip(members.map((member) => ({ name: member, data: readFileSync(join(root, member)) }))),
  );

  verify(out, version, members);
  console.log(`built ${out} with ${members.length} files:\n  ${members.join("\n  ")}`);
}

main();
