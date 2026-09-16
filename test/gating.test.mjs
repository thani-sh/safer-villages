/**
 * When is a spawn close enough to a village to be stopped?
 *
 * These are the cases the addon got wrong before: it removed mobs anywhere once
 * a villager check returned early, and it looked for villagers in the overworld
 * no matter which dimension the mob spawned in.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { at, loadAddon, placeVillagers, spawn, state } from "./harness.mjs";

describe("gating on a nearby village", () => {
  test("nothing happens when there is no village anywhere", async () => {
    await loadAddon();
    placeVillagers([]);

    const outcome = spawn("minecraft:zombie");

    assert.equal(outcome.removed, false, "a mob far from any village must survive");
    assert.equal(state.removed.length, 0);
    assert.equal(state.killed.length, 0);
  });

  test("a villager inside the radius", async () => {
    await loadAddon();
    placeVillagers([at(5, 64, 0)]);

    assert.equal(spawn("minecraft:zombie").removed, true);
  });

  test("a villager exactly on the radius", async () => {
    await loadAddon();
    placeVillagers([at(32, 64, 0)]);

    assert.equal(spawn("minecraft:zombie").removed, true);
  });

  test("a villager just outside the radius", async () => {
    await loadAddon();
    placeVillagers([at(33, 64, 0)]);

    assert.equal(spawn("minecraft:zombie").removed, false);
  });

  test("an iron golem is a village too", async () => {
    await loadAddon();
    placeVillagers([at(6, 64, 0)], { typeId: "minecraft:iron_golem" });

    assert.equal(spawn("minecraft:zombie").removed, true);
  });

  test("the distance is measured in three dimensions", async () => {
    await loadAddon();
    // Directly above the mob, 36 blocks up: a flat x/z check would call this
    // "here", the engine's 3D distance correctly does not.
    placeVillagers([at(0, 100, 0)]);

    assert.equal(spawn("minecraft:zombie", { location: at(0, 64, 0) }).removed, false);
  });
});

describe("gating on the entity's own dimension", () => {
  test("a mob spawning in the nether is not judged by overworld villagers", async () => {
    await loadAddon();
    placeVillagers([at(0, 64, 0)]);

    const outcome = spawn("minecraft:zombie", {
      location: at(0, 64, 0),
      dimensionId: "minecraft:the_nether",
    });

    assert.equal(outcome.removed, false);
  });

  test("the villagers are looked for in the dimension the mob spawned in", async () => {
    await loadAddon();

    spawn("minecraft:zombie", { dimensionId: "minecraft:the_nether" });

    assert.ok(state.entityQueries.length > 0);
    for (const query of state.entityQueries) {
      assert.equal(query.dimension, "minecraft:the_nether");
      assert.equal(query.maxDistance, 32);
    }
  });
});

describe("incomplete information", () => {
  test("an entity with no readable location is left alone", async () => {
    await loadAddon();
    placeVillagers([at(5, 64, 0)]);

    // Throwing here would be the bug; node:test fails the test on a throw.
    const outcome = spawn("minecraft:zombie", { unreadableLocation: true });

    assert.equal(outcome.removed, false);
  });

  test("a failed entity query does not remove anything", async () => {
    await loadAddon();
    placeVillagers([at(5, 64, 0)]);
    state.entityQueryFails = true;

    const outcome = spawn("minecraft:zombie");

    assert.equal(outcome.removed, false);
  });
});
