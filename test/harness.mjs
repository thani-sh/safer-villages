/**
 * Shared setup for the tests.
 *
 * The addon keeps module-level caches (discovered village markers, scanned chunk
 * columns), so each test gets a fresh copy of scripts/main.js rather than the
 * same instance other tests have already warmed up. The test double is a single
 * module, so its record of what the addon did survives those reloads.
 */
import { readFileSync } from "node:fs";

import { entity, raiseSpawn, reset, state } from "./stub/minecraft-server.mjs";

export { state };

const mobFamilies = JSON.parse(readFileSync(new URL("./families.json", import.meta.url), "utf8"));
const overworld = "minecraft:overworld";

let instances = 0;

/** Load a fresh copy of the addon, with the real family data in place. */
export async function loadAddon({ withFamilies = true } = {}) {
  reset();

  if (withFamilies) {
    for (const [typeId, families] of Object.entries(mobFamilies)) {
      if (!typeId.startsWith("_")) {
        state.families[typeId] = families;
      }
    }
  }

  await import(`../scripts/main.js?instance=${(instances += 1)}`);
}

/** Raise a spawn event for a mob and report what the addon did about it. */
export function spawn(typeId, { quiet = true, ...options } = {}) {
  const spawned = entity({ typeId, ...options });
  const logs = [];
  const write = console.log;
  if (quiet) {
    console.log = (...args) => logs.push(args.join(" "));
  }

  try {
    raiseSpawn(spawned);
  } finally {
    console.log = write;
  }

  return { ...spawned.result, logs };
}

/** Village entities in a dimension: villagers by default, golems on request. */
export function placeVillagers(locations, { dimensionId = overworld, typeId = "minecraft:villager" } = {}) {
  state.villagers[dimensionId] = locations.map((location) => ({ typeId, location }));
}

/** Village marker blocks (beds and bells) in a dimension. */
export function placeMarkers(markers, { dimensionId = overworld } = {}) {
  state.markers[dimensionId] = markers;
}

export function bed(x, y = 64, z = 0) {
  return { typeId: "minecraft:bed", x, y, z };
}

export function bell(x, y = 68, z = 0) {
  return { typeId: "minecraft:bell", x, y, z };
}

export function at(x, y = 64, z = 0) {
  return { x, y, z };
}
