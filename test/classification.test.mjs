/**
 * Which mobs count as hostile?
 *
 * The addon asks the engine for the "monster" type family and falls back to its
 * type-id list when families cannot be read. The family data in families.json
 * comes from Mojang's behaviour pack, so these cases are the game's own answer
 * rather than a list written by hand.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { at, loadAddon, placeVillagers, spawn, state } from "./harness.mjs";

/** A village is always in range here, so each case is about classification only. */
async function spawnNearVillage(typeId) {
  await loadAddon();
  placeVillagers([at(5)]);
  return spawn(typeId);
}

describe("mobs that declare the monster family", () => {
  const hostiles = [
    "minecraft:zombie",
    "minecraft:creeper",
    "minecraft:blaze",
    "minecraft:husk",
    "minecraft:phantom",
    "minecraft:silverfish",
    "minecraft:ravager",
    "minecraft:witch",
    "minecraft:creaking",
    "minecraft:cave_spider",
    "minecraft:elder_guardian",
    "minecraft:evocation_illager",
    "minecraft:warden",
    // The wither declares the family, so it is treated like any other monster.
    "minecraft:wither",
    // A monster-family mob that is also tamable: kept in scope deliberately.
    "minecraft:zombie_nautilus",
  ];

  for (const typeId of hostiles) {
    test(`${typeId} is removed`, async () => {
      const outcome = await spawnNearVillage(typeId);
      assert.equal(outcome.removed, true, `${typeId} should be removed near a village`);
    });
  }
});

describe("mobs the family check cannot see", () => {
  // Neither declares "monster" in Mojang's data, so only the type-id list can
  // catch them - the hoglin is the known case, the sulfur cube the one a review
  // of all 44 monster-category entities turned up.
  for (const typeId of ["minecraft:hoglin", "minecraft:sulfur_cube"]) {
    test(`${typeId} is removed via the fallback list`, async () => {
      const outcome = await spawnNearVillage(typeId);
      assert.equal(outcome.removed, true, `${typeId} should be caught by the list`);
    });
  }
});

describe("when families cannot be read", () => {
  test("a known hostile is still caught by the list", async () => {
    await loadAddon();
    placeVillagers([at(5)]);
    state.familiesUnreadable = true;

    assert.equal(spawn("minecraft:zombie").removed, true);
  });

  test("the mobs whose monster family arrives with a component group are still caught", async () => {
    await loadAddon();
    placeVillagers([at(5)]);
    state.familiesUnreadable = true;

    // Their "monster" family comes from a component group, which may not be
    // applied yet when the spawn event fires - the reason detection is a union.
    for (const typeId of [
      "minecraft:drowned",
      "minecraft:piglin",
      "minecraft:zoglin",
      "minecraft:zombie_pigman",
      "minecraft:zombie_villager",
      "minecraft:zombie_villager_v2",
    ]) {
      assert.equal(spawn(typeId).removed, true, `${typeId} should still be caught`);
    }
  });

  test("a mob no list could know about is left alone", async () => {
    await loadAddon();
    placeVillagers([at(5)]);
    state.familiesUnreadable = true;

    assert.equal(spawn("minecraft:future_beast").removed, false);
  });
});

describe("mobs that must never be touched", () => {
  const untouched = [
    // Deliberate exclusions: no monster family, or a tamable mount.
    "minecraft:ender_dragon",
    "minecraft:camel_husk",
    // The village itself.
    "minecraft:villager",
    "minecraft:villager_v2",
    "minecraft:iron_golem",
    // Ordinary animals.
    "minecraft:cow",
    "minecraft:pig",
    "minecraft:wolf",
    "minecraft:camel",
    "minecraft:nautilus",
  ];

  for (const typeId of untouched) {
    test(`${typeId} survives`, async () => {
      const outcome = await spawnNearVillage(typeId);
      assert.equal(outcome.removed, false, `${typeId} should be left alone`);
      assert.equal(outcome.killed, false, `${typeId} should not be killed either`);
    });
  }
});

describe("mobs this pack cannot know about until it meets them", () => {
  test("an addon mob declaring the monster family is removed", async () => {
    const outcome = await spawnNearVillage("custom:troll");
    assert.equal(outcome.removed, true);
  });

  test("a mob from a future game update is removed", async () => {
    const outcome = await spawnNearVillage("minecraft:future_beast");
    assert.equal(outcome.removed, true);
  });
});
