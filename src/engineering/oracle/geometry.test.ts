import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TEST_ASIC_A } from "../../equipment/asic-catalog.ts";
import { TEST_RACK_A, emptyRectangularProject } from "../../project/factory.ts";
import {
  aabbOverlap,
  analyzeGeometry,
  canPlaceOpening,
  openingAreaM2,
  openingTopElevation,
  rackAabb,
  resizeRectangularRoom,
  roomMetrics,
  validateOpening,
} from "../geometry.ts";
import { asicsPerShelf, rackAsicCapacity } from "../racks.ts";
import type { Opening, Rack } from "../types.ts";

function room(w: number, d: number, h: number) {
  return emptyRectangularProject({ widthM: w, depthM: d, heightM: h });
}

describe("GEO-01 basic room geometry", () => {
  it("6 × 4 × 2.8 m", () => {
    const m = roomMetrics(6, 4, 2.8);
    assert.equal(m.floorAreaM2, 24);
    assert.ok(Math.abs(m.volumeM3 - 67.2) < 0.001);
    assert.equal(m.perimeterM, 20);
    const g = analyzeGeometry(room(6, 4, 2.8));
    assert.equal(g.valid, true);
  });
});

describe("GEO-02 live wall resize", () => {
  it("east wall → 7.510 m", () => {
    const p = resizeRectangularRoom(room(6, 4, 2.8), "east", 7.51);
    assert.equal(p.room.widthM, 7.51);
    assert.equal(p.room.depthM, 4);
    assert.equal(p.room.heightM, 2.8);
    const m = roomMetrics(p.room.widthM, p.room.depthM, p.room.heightM);
    assert.ok(Math.abs(m.floorAreaM2 - 30.04) < 0.001);
    assert.ok(Math.abs(m.volumeM3 - 84.112) < 0.001);
    assert.ok(Math.abs(m.perimeterM - 23.02) < 0.001);
  });
});

describe("GEO-03 exact opening", () => {
  it("1.400 × 0.900 on 8 m wall", () => {
    const p = room(8, 5, 2.8);
    const o: Opening = {
      id: "o1",
      type: "EXHAUST",
      wallId: "east",
      widthM: 1.4,
      heightM: 0.9,
      bottomElevationM: 0.4,
      offsetFromWallStartM: 2.0,
    };
    p.openings = [o];
    const v = validateOpening(p, o);
    assert.equal(v.ok, true);
    assert.ok(Math.abs(openingAreaM2(o) - 1.26) < 0.001);
    assert.ok(Math.abs(openingTopElevation(o) - 1.3) < 0.001);
    assert.equal(v.insideWall, true);
  });
});

describe("GEO-04 invalid opening", () => {
  it("rejects 4.5 m opening on 4 m wall without mutating", () => {
    const p = room(4, 4, 2.8);
    const original = structuredClone(p);
    const o: Opening = {
      id: "bad",
      type: "DOOR",
      wallId: "south",
      widthM: 4.5,
      heightM: 2.1,
      bottomElevationM: 0,
      offsetFromWallStartM: 0,
    };
    assert.equal(canPlaceOpening(p, o), false);
    const v = validateOpening(p, o);
    assert.equal(v.ok, false);
    assert.ok(v.errors.length > 0);
    assert.deepEqual(p, original);
  });
});

describe("GEO-05 rack ASIC capacity", () => {
  it("TEST_RACK_A holds 24 TEST_ASIC_A", () => {
    const rack: Rack = {
      id: "TEST_RACK_A",
      name: "TEST_RACK_A",
      x: 0,
      y: 0,
      ...TEST_RACK_A,
      rotationDeg: 0,
      asicCount: 0,
      airflowToward: "south",
    };
    assert.equal(asicsPerShelf(rack, TEST_ASIC_A, 0), 6);
    assert.equal(rackAsicCapacity(rack, TEST_ASIC_A, 0), 24);
  });
});

describe("GEO-06 collision integrity", () => {
  it("0.100 m overlap is a collision", () => {
    const a: Rack = {
      id: "A",
      name: "A",
      x: 1,
      y: 1,
      widthM: 1.6,
      depthM: 0.6,
      heightM: 2,
      rotationDeg: 0,
      shelves: 4,
      usableShelfWidthM: 1.5,
      usableShelfDepthM: 0.55,
      asicCount: 0,
      airflowToward: "south",
    };
    const b: Rack = { ...a, id: "B", name: "B", x: 2.5, y: 1 };
    const o = aabbOverlap(rackAabb(a), rackAabb(b));
    assert.ok(Math.abs(o - 0.1) < 0.001);
    assert.equal(o > 0, true);
  });
});
