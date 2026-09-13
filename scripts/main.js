import { world } from "@minecraft/server";

/**
 * An array of entity ID prefixes for hostile mobs. Used to quickly identify hostile entities.
 *
 * These are Bedrock identifiers, as returned by entity.typeId, and several differ from the
 * Java names: the evoker is "minecraft:evocation_illager" and the zombie piglin is
 * "minecraft:zombie_pigman" (already covered by the "minecraft:zombie" prefix). Prefixes are
 * compared with startsWith, so variants need their own entries -- "minecraft:spider" does not
 * cover "minecraft:cave_spider", and "minecraft:guardian" does not cover
 * "minecraft:elder_guardian".
 *
 * Deliberately excluded: the wither and the ender dragon, which are player-summoned bosses
 * rather than nuisance spawns, and the tamable jockey mounts (camel husk, zombie nautilus).
 */
const HOSTILE_MOB_PREFIXES = [
  "minecraft:blaze",
  "minecraft:bogged",
  "minecraft:breeze",
  "minecraft:cave_spider",
  "minecraft:creaking",
  "minecraft:creeper",
  "minecraft:drowned",
  "minecraft:elder_guardian",
  "minecraft:enderman",
  "minecraft:endermite",
  "minecraft:evocation_illager",
  "minecraft:ghast",
  "minecraft:guardian",
  "minecraft:hoglin",
  "minecraft:husk",
  "minecraft:magma_cube",
  "minecraft:parched",
  "minecraft:phantom",
  "minecraft:piglin",
  "minecraft:pillager",
  "minecraft:ravager",
  "minecraft:shulker",
  "minecraft:silverfish",
  "minecraft:skeleton",
  "minecraft:slime",
  "minecraft:spider",
  "minecraft:stray",
  "minecraft:vex",
  "minecraft:vindicator",
  "minecraft:warden",
  "minecraft:witch",
  "minecraft:wither_skeleton",
  "minecraft:zoglin",
  "minecraft:zombie",
];

/**
 * An array of entity IDs for villager mobs. Used to quickly identify villager entities.
 */
const VILLAGER_MOB_NAMES = [
  "minecraft:villager",
  "minecraft:villager_v2",
  "minecraft:iron_golem",
];

/**
 * The radius (in blocks) within which hostile mobs are prevented from spawning near villages.
 */
const VILLAGE_RADIUS_BLOCKS = 16;

/**
 * Checks if an entity is a hostile mob based on its type ID.
 */
function isEntityHostileMob(entity) {
  const entityId = entity.typeId;
  for (const prefix of HOSTILE_MOB_PREFIXES) {
    if (entityId.startsWith(prefix)) {
      console.log("SafeVillage: mob is hostile:", entity.typeId);
      return true;
    }
  }
  console.log("SafeVillage: mob is not hostile:", entity.typeId);
  return false;
}

/**
 * Checks if an entity is within VILLAGE_RADIUS_BLOCKS of a village.
 */
function isEntityNearVillage(entity) {
  try {
    for (const entityType of VILLAGER_MOB_NAMES) {
      const villagers = world.getDimension("overworld").getEntities({
        type: entityType,
        location: entity.location,
        maxDistance: VILLAGE_RADIUS_BLOCKS,
      });
      console.log(
        "SafeVillage: found villagers of type:",
        entityType,
        villagers.length
      );
      return true;
    }
    console.log("SafeVillage: did not find any villagers nearby:");
    return false;
  } catch (err) {
    console.log(
      "SafeVillage: failed to check if near village:",
      entity.typeId,
      err
    );
    // TODO: Figure out why entity.location is undefined sometimes
    return true;
  }
}

/**
 * Checks if an entity is within VILLAGE_RADIUS_BLOCKS of a village.
 */
function killHostileMob(entity) {
  try {
    console.log("SafeVillage: kiling hostile near village:", entity.typeId);
    entity.kill();
  } catch (err) {
    console.log("SafeVillage: failed to kill hostile mob:", entity.typeId, err);
    // TODO: Figure out why it sometimes throw errors when killing mobs
  }
}

/**
 * Subscribes to the entitySpawn event to kill hostile mobs near villages.
 */
world.afterEvents.entitySpawn.subscribe((e) => {
  console.log("SafeVillage: checking spawned entity:", e.entity.typeId);

  if (isEntityHostileMob(e.entity) && isEntityNearVillage(e.entity)) {
    killHostileMob(e.entity);
  }
});
