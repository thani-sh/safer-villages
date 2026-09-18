/**
 * Beds and bells mark village ground.
 *
 * A house can stand empty of villagers while still being part of the village,
 * so the addon also looks for the blocks a village cannot exist without. That
 * scan is the expensive part, so it is scanned per chunk column and the "nothing
 * here" answer is remembered for a while - both of which are worth pinning down.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { at, bed, bell, loadAddon, placeMarkers, spawn, state } from "./harness.mjs";

const overworld = "minecraft:overworld";

describe("marker blocks stand in for villagers", () => {
  test("a bed with nobody in sight still protects the area", async () => {
    await loadAddon();
    placeMarkers([bed(4, 64, 4)]);

    assert.equal(spawn("minecraft:zombie", { location: at(0, 64, 0) }).removed, true);
  });

  test("a bell counts too", async () => {
    await loadAddon();
    placeMarkers([bell(6, 68, 0)]);

    assert.equal(spawn("minecraft:zombie", { location: at(0, 64, 0) }).removed, true);
  });

  test("a bed just inside the radius", async () => {
    await loadAddon();
    placeMarkers([bed(32, 64, 0)]);

    assert.equal(spawn("minecraft:zombie", { location: at(0, 64, 0) }).removed, true);
  });

  test("a bed outside the radius is not enough", async () => {
    await loadAddon();
    placeMarkers([bed(33, 64, 0)]);

    assert.equal(spawn("minecraft:zombie", { location: at(0, 64, 0) }).removed, false);
  });

  test("a bed far above the mob falls outside the scanned band", async () => {
    await loadAddon();
    // The scan reaches 8 blocks up or down from the mob, so a bed 20 above is
    // not seen by this scan - noted because it is the band, not the radius.
    placeMarkers([bed(0, 84, 0)]);

    assert.equal(spawn("minecraft:zombie", { location: at(0, 64, 0) }).removed, false);
  });
});

describe("what the scan asks the engine for", () => {
  test("the marker type ids are matched exactly, not by prefix", async () => {
    await loadAddon();

    spawn("minecraft:zombie", { location: at(0, 64, 0) });

    const query = state.blockQueries.at(-1);
    assert.deepEqual(
      query.includeTypes,
      ["minecraft:bed", "minecraft:bell", "minecraft:straw_bed"],
      'a prefix match would treat "minecraft:bedrock" as a bed',
    );
  });

  test("the volume covers the whole chunk column, padded by its half-diagonal", async () => {
    await loadAddon();

    spawn("minecraft:zombie", { location: at(0, 64, 0) });

    const { volume } = state.blockQueries.at(-1);
    // The chunk containing (0, 64, 0) has its centre at x/z 8; the reach is the
    // 32-block radius plus 12 so that one scan is valid for every position in
    // the column, and the band is the mob's own y ± 8.
    assert.deepEqual(volume.from, { x: -36, y: 56, z: -36 });
    assert.deepEqual(volume.to, { x: 52, y: 72, z: 52 });
  });
});

describe("the marker cache", () => {
  test("an empty column is scanned once and then trusted", async () => {
    await loadAddon();

    spawn("minecraft:zombie", { location: at(0, 64, 0) });
    const scans = state.blockQueries.length;
    assert.equal(scans, 1);

    spawn("minecraft:zombie", { location: at(3, 64, 3) });
    assert.equal(state.blockQueries.length, scans, "the second spawn reused the column's answer");
  });

  test("the column is scanned again once the cached answer expires", async () => {
    await loadAddon();

    spawn("minecraft:zombie", { location: at(0, 64, 0) });
    const scans = state.blockQueries.length;

    state.currentTick += 2400;
    spawn("minecraft:zombie", { location: at(3, 64, 3) });

    assert.equal(state.blockQueries.length, scans + 1);
  });

  test("a marker that was found keeps applying without being scanned again", async () => {
    await loadAddon();
    placeMarkers([bed(4, 64, 4)]);

    assert.equal(spawn("minecraft:zombie", { location: at(0, 64, 0) }).removed, true);
    const scans = state.blockQueries.length;

    state.currentTick += 2400;
    assert.equal(spawn("minecraft:zombie", { location: at(1, 64, 1) }).removed, true);
    assert.equal(state.blockQueries.length, scans, "the marker was already known");
  });

  test("a scan that throws leaves the mob alone", async () => {
    await loadAddon();
    state.blockQueryFails = true;

    const outcome = spawn("minecraft:zombie", { location: at(0, 64, 0) });

    assert.equal(outcome.removed, false);
  });

  test("markers are remembered per dimension", async () => {
    await loadAddon();
    placeMarkers([bed(0, 64, 0)], { dimensionId: overworld });

    const outcome = spawn("minecraft:zombie", {
      location: at(0, 64, 0),
      dimensionId: "minecraft:the_nether",
    });

    assert.equal(outcome.removed, false, "a bed in the overworld is not a nether village");
  });
});
