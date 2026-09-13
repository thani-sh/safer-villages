import { BlockVolume, system, world } from "@minecraft/server";

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
const VILLAGE_RADIUS_BLOCKS = 32;

/**
 * Blocks that mark village ground, matched by exact type id. A Bedrock village
 * needs at least one bed and every village has a bell -- and a house can stand
 * empty of villagers while still being part of the village, which is why a
 * radius check against villagers alone leaves gaps.
 *
 * Matched exactly, not by prefix: "minecraft:bed" is a prefix of
 * "minecraft:bedrock".
 */
const VILLAGE_MARKER_BLOCKS = [
  "minecraft:bed",
  "minecraft:bell",
  "minecraft:straw_bed",
];

/**
 * Village marker positions discovered so far, keyed by dimension id. Exact
 * coordinates, so the distance test stays honest: a spawn is killed only when a
 * marker really is inside the radius.
 */
const knownVillageMarkers = new Map();

/**
 * Chunk columns (per dimension and 16-block Y band) already scanned and found to
 * hold no marker, mapped to the tick of that scan. A block scan costs far more
 * than an entity query, so an empty column is not rescanned until
 * MARKER_RESCAN_TICKS have passed.
 */
const scannedChunkColumns = new Map();

/** A 16x16 chunk's half-diagonal is ~11.3 blocks, rounded up so that one scan
 * covers every position in the column -- which is what makes caching the
 * "nothing here" result valid. */
const MARKER_SCAN_PADDING = 12;

/** Vertical reach of a marker scan: beds sit on the ground mobs spawn on, bells
 * hang a few blocks above it. */
const MARKER_SCAN_Y_RANGE = 8;

/** How long a "no markers here" result is trusted, in ticks (2 minutes). */
const MARKER_RESCAN_TICKS = 2400;

/** Per-dimension cap, so a long session cannot grow the marker set without bound. */
const MARKER_CACHE_LIMIT = 1024;

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

/** Squared-distance test, so no square root is needed. */
function isWithinRadius(a, b, radius) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

function markerKeyAt(location) {
  return `${Math.floor(location.x)},${Math.floor(location.y)},${Math.floor(
    location.z
  )}`;
}

/** True when a previously discovered village marker is inside the radius. */
function isNearKnownVillageMarker(dimensionId, location) {
  const markers = knownVillageMarkers.get(dimensionId);
  if (!markers) {
    return false;
  }

  for (const key of markers) {
    const [x, y, z] = key.split(",").map(Number);
    if (isWithinRadius({ x, y, z }, location, VILLAGE_RADIUS_BLOCKS)) {
      return true;
    }
  }
  return false;
}

/**
 * Scans the chunk column containing `location` for marker blocks and remembers
 * what it finds. The volume is anchored on the chunk centre and padded by the
 * chunk's half-diagonal, so a single scan is valid for every position in that
 * column.
 */
function scanChunkColumnForMarkers(dimension, location) {
  const anchorX = Math.floor(location.x / 16) * 16 + 8;
  const anchorZ = Math.floor(location.z / 16) * 16 + 8;
  const reach = VILLAGE_RADIUS_BLOCKS + MARKER_SCAN_PADDING;

  const volume = new BlockVolume(
    {
      x: anchorX - reach,
      y: Math.floor(location.y) - MARKER_SCAN_Y_RANGE,
      z: anchorZ - reach,
    },
    {
      x: anchorX + reach,
      y: Math.floor(location.y) + MARKER_SCAN_Y_RANGE,
      z: anchorZ + reach,
    }
  );

  let markers = knownVillageMarkers.get(dimension.id);
  if (!markers) {
    markers = new Set();
    knownVillageMarkers.set(dimension.id, markers);
  }

  try {
    // allowUnloadedChunks: report what can be read rather than throwing when the
    // scan straddles the edge of the loaded area.
    const found = dimension.getBlocks(
      volume,
      { includeTypes: VILLAGE_MARKER_BLOCKS },
      true
    );
    for (const blockLocation of found.getBlockLocationIterator()) {
      markers.add(markerKeyAt(blockLocation));
    }
    if (markers.size > MARKER_CACHE_LIMIT) {
      markers.clear();
    }
  } catch (err) {
    console.log("SafeVillage: village marker scan failed:", dimension.id, err);
  }
}

/** True when a village marker block (bed or bell) is within the radius. */
function isNearVillageMarker(dimension, location) {
  if (isNearKnownVillageMarker(dimension.id, location)) {
    return true;
  }

  const columnKey = `${dimension.id}:${Math.floor(
    location.x / 16
  )},${Math.floor(location.y / 16)},${Math.floor(location.z / 16)}`;
  const lastScan = scannedChunkColumns.get(columnKey);
  if (
    lastScan !== undefined &&
    system.currentTick - lastScan < MARKER_RESCAN_TICKS
  ) {
    return false;
  }

  scannedChunkColumns.set(columnKey, system.currentTick);
  scanChunkColumnForMarkers(dimension, location);
  return isNearKnownVillageMarker(dimension.id, location);
}

/** Villagers and iron golems inside the radius, queried by the engine. */
function isNearVillagerOrGolem(dimension, location) {
  for (const entityType of VILLAGER_MOB_NAMES) {
    try {
      const villagers = dimension.getEntities({
        type: entityType,
        location,
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
        entityType,
        err
      );
    }
  }
  return false;
}

/**
 * Checks if an entity is within VILLAGE_RADIUS_BLOCKS of a village: near a
 * villager or an iron golem, or near a village marker block (a bed or a bell).
 *
 * Returns true only when something is actually found. If the entity's position
 * cannot be read the check is inconclusive and returns false -- killing a mob we
 * cannot even place would be a false positive.
 */
function isEntityNearVillage(entity) {
  if (!entity.location) {
    console.log("SafeVillage: entity has no readable location:", entity.typeId);
    return false;
  }

  const dimension = entity.dimension ?? world.getDimension("overworld");
  return (
    isNearVillagerOrGolem(dimension, entity.location) ||
    isNearVillageMarker(dimension, entity.location)
  );
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
