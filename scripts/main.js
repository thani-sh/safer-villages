import { world } from "@minecraft/server";

/**
 * Fallback list of hostile mob type-id prefixes, used when an entity's type
 * families cannot be read and for hostile mobs that do not declare the
 * "monster" family -- the hoglin is one, so it must stay here.
 *
 * These are Bedrock identifiers, as returned by entity.typeId, and several
 * differ from the Java names: the evoker is "minecraft:evocation_illager" and
 * the zombie piglin is "minecraft:zombie_pigman" (already covered by the
 * "minecraft:zombie" prefix). Prefixes are compared with startsWith, so
 * variants need their own entries -- "minecraft:spider" does not cover
 * "minecraft:cave_spider", and "minecraft:guardian" does not cover
 * "minecraft:elder_guardian".
 *
 * The ender dragon is deliberately not listed, and does not declare the
 * monster family either, so it is never touched. The wither does declare
 * "monster" and is therefore treated like any other hostile mob.
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
 * True when an entity declares the "monster" type family.
 *
 * Every vanilla hostile mob declares it (checked against Mojang's
 * behavior_pack/entities data), so this keeps up with mobs added by future game
 * updates -- and with mobs from other addons -- without maintaining a list.
 */
function isMonsterFamily(entity) {
  try {
    return entity.matches({ families: ["monster"] });
  } catch (err) {
    // Families are not always readable for a just-spawned entity; the type-id
    // list below is the fallback.
    console.log("SafeVillage: family check failed for:", entity.typeId, err);
    return false;
  }
}

/**
 * Checks if an entity is a hostile mob: either it belongs to the "monster" type
 * family, or its type id matches the fallback list below.
 */
function isEntityHostileMob(entity) {
  if (isMonsterFamily(entity)) {
    console.log("SafeVillage: mob is hostile (monster family):", entity.typeId);
    return true;
  }

  const entityId = entity.typeId;
  for (const prefix of HOSTILE_MOB_PREFIXES) {
    if (entityId.startsWith(prefix)) {
      console.log("SafeVillage: mob is hostile (known type):", entity.typeId);
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
  // Query the entity's own dimension: a mob spawning in the Nether or the End
  // was previously checked against overworld coordinates, which either missed
  // real villages or matched an unrelated location.
  const dimension = entity.dimension ?? world.getDimension("overworld");

  for (const entityType of VILLAGER_MOB_NAMES) {
    try {
      const villagers = dimension.getEntities({
        type: entityType,
        location: entity.location,
        maxDistance: VILLAGE_RADIUS_BLOCKS,
      });

      if (villagers.length > 0) {
        console.log(
          "SafeVillage: found villagers of type:",
          entityType,
          villagers.length
        );
        return true;
      }
    } catch (err) {
      console.log(
        "SafeVillage: failed to check if near village:",
        entity.typeId,
        err
      );
    }
  }

  // Nothing found inside the radius (or the check could not be completed):
  // leave the mob alone rather than killing something we cannot place.
  console.log("SafeVillage: did not find any villagers nearby:", entity.typeId);
  return false;
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
