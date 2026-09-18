/**
 * What the addon does to a mob it has decided to stop.
 *
 * remove() rather than kill(): the spawn event fires before an entity is always
 * fully initialised, and a removal leaves no loot or experience behind for a mob
 * that never reached the village.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { at, loadAddon, placeVillagers, spawn, state } from "./harness.mjs";

const hostiles = [
  "minecraft:zombie",
  "minecraft:creeper",
  "minecraft:hoglin",
  "minecraft:sulfur_cube",
  "minecraft:wither",
];

describe("removal", () => {
  test("mobs are removed, never killed", async () => {
    await loadAddon();
    placeVillagers([at(5, 64, 0)]);

    for (const typeId of hostiles) {
      spawn(typeId);
    }

    assert.deepEqual(state.removed, hostiles);
    assert.deepEqual(state.killed, [], "kill() must not be called: it drops loot and can throw here");
  });

  test("each spawn is handled exactly once", async () => {
    await loadAddon();
    placeVillagers([at(5, 64, 0)]);

    spawn("minecraft:zombie");

    assert.deepEqual(state.removed, ["minecraft:zombie"]);
  });

  test("an entity that is already gone is left alone", async () => {
    await loadAddon();
    placeVillagers([at(5, 64, 0)]);
    state.entitiesInvalid = true;

    // The addon asks isValid() first; node:test would fail this on a throw.
    const outcome = spawn("minecraft:zombie");

    assert.equal(outcome.removed, false);
    assert.equal(outcome.killed, false);
    assert.deepEqual(state.removed, []);
  });

  test("a removal that throws does not escape the spawn handler", async () => {
    await loadAddon();
    placeVillagers([at(5, 64, 0)]);
    state.removeThrows = true;

    const outcome = spawn("minecraft:zombie");

    assert.equal(outcome.removed, false);
    assert.deepEqual(state.removed, []);
  });

  test("the addon subscribes to the spawn event once", async () => {
    await loadAddon();

    assert.equal(state.spawnHandlers.length, 1);
  });
});
