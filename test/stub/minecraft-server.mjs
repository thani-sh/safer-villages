/**
 * Test double for the Bedrock Script API.
 *
 * The addon is a single file that subscribes to `world.afterEvents.entitySpawn`
 * and then asks the engine questions -- does this entity carry the "monster"
 * family, are there villagers nearby, are there beds or bells within the
 * radius. Running it under Node with this module in place of
 * "@minecraft/server" exercises the real code and lets a test assert what the
 * addon *did* (removed, killed, queried) rather than what it logged.
 *
 * Only the surface the addon touches is implemented, and the knobs below exist
 * so tests can reproduce the engine's awkward cases: unreadable families, an
 * entity whose location is not available, a block scan that throws.
 */

export const state = {
  /** Handlers the addon registered via world.afterEvents.entitySpawn.subscribe */
  spawnHandlers: [],
  /** Every `remove()` / `kill()` the addon performed, in order */
  removed: [],
  killed: [],
  /** Engine calls, recorded so tests can assert what was asked of the engine */
  entityQueries: [],
  blockQueries: [],
  matchesCalls: 0,

  /** type id -> families it declares (see families.json) */
  families: {},
  /** per dimension: village entities, each { typeId, location } */
  villagers: {},
  /** per dimension: marker blocks, each { typeId, x, y, z } */
  markers: {},
  /** dimensions whose getBlocks() throws, to exercise the failure path */
  blockQueryFails: false,
  /** dimensions whose getEntities() throws */
  entityQueryFails: false,
  /** entities report matches() unreadable, as a just-spawned mob sometimes is */
  familiesUnreadable: false,
  /** entities report isValid() false, i.e. already gone */
  entitiesInvalid: false,
  /** remove() throws, reproducing the failure the addon's try/catch covers */
  removeThrows: false,

  currentTick: 0,
};

/** Reset everything between tests. */
export function reset() {
  state.spawnHandlers = [];
  state.removed = [];
  state.killed = [];
  state.entityQueries = [];
  state.blockQueries = [];
  state.matchesCalls = 0;
  state.families = {};
  state.villagers = {};
  state.markers = {};
  state.blockQueryFails = false;
  state.entityQueryFails = false;
  state.familiesUnreadable = false;
  state.entitiesInvalid = false;
  state.removeThrows = false;
  state.currentTick = 0;
}

export class BlockVolume {
  constructor(from, to) {
    this.from = from;
    this.to = to;
  }
}

export const system = {
  get currentTick() {
    return state.currentTick;
  },
};

export const world = {
  afterEvents: {
    entitySpawn: {
      subscribe: (handler) => state.spawnHandlers.push(handler),
    },
  },
  getDimension: (id) => dimension(id),
};

export function dimension(id = "minecraft:overworld") {
  return {
    id,
    getEntities: (options) => {
      state.entityQueries.push({ dimension: id, ...options });
      if (state.entityQueryFails) {
        throw new Error("cannot read entities in this dimension right now");
      }
      if (!options?.location) {
        throw new Error("location is required");
      }
      return (state.villagers[id] ?? []).filter(
        (candidate) =>
          candidate.typeId === options.type &&
          within(candidate.location, options.location, options.maxDistance ?? Infinity),
      );
    },
    getBlocks: (volume, filter, _allowUnloadedChunks) => {
      state.blockQueries.push({ dimension: id, volume, includeTypes: filter?.includeTypes });
      if (state.blockQueryFails) {
        throw new Error("block volume straddles unloaded chunks");
      }
      const types = filter?.includeTypes ?? [];
      const hits = (state.markers[id] ?? []).filter(
        (marker) => types.includes(marker.typeId) && inside(marker, volume),
      );
      return {
        getBlockLocationIterator: () => hits.map(({ x, y, z }) => ({ x, y, z })),
      };
    },
  };
}

function within(a, b, maxDistance) {
  return distanceSquared(a, b) <= maxDistance * maxDistance;
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function inside(point, volume) {
  const between = (value, a, b) => value >= Math.min(a, b) && value <= Math.max(a, b);
  return (
    between(point.x, volume.from.x, volume.to.x) &&
    between(point.y, volume.from.y, volume.to.y) &&
    between(point.z, volume.from.z, volume.to.z)
  );
}

/**
 * An entity shaped like the engine's, wired to record what the addon does to it.
 *
 * `matches({ families })` is true when any requested family is one the entity
 * declares; the addon only ever asks about one family.
 */
export function entity({
  typeId,
  location = { x: 0, y: 64, z: 0 },
  dimensionId = "minecraft:overworld",
  unreadableLocation = false,
}) {
  const result = { typeId, removed: false, killed: false };
  const families = state.families[typeId] ?? [];

  return {
    typeId,
    location: unreadableLocation ? undefined : location,
    dimension: dimension(dimensionId),
    matches: (options) => {
      state.matchesCalls++;
      if (state.familiesUnreadable) {
        throw new Error("type families are not readable for this entity yet");
      }
      return (options?.families ?? []).some((family) => families.includes(family));
    },
    isValid: () => !state.entitiesInvalid,
    remove: () => {
      if (state.removeThrows) {
        throw new Error("this entity cannot be removed right now");
      }
      result.removed = true;
      state.removed.push(typeId);
    },
    kill: () => {
      result.killed = true;
      state.killed.push(typeId);
    },
    result,
  };
}

/** Raise the spawn event the addon listens for, as the engine would. */
export function raiseSpawn(spawned) {
  for (const handler of state.spawnHandlers) {
    handler({ entity: spawned });
  }
}
