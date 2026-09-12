import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TEST_ASIC_A } from "../../equipment/asic-catalog.ts";
import { TEST_RACK_A, emptyRectangularProject } from "../../project/factory.ts";
import {
  aabb3,
  aabb3Intersects,
  aabb3OverlapX,
  aabb3OverlapY,
  aabb3OverlapZ,
  asBuiltAabb3,
  ceilingAabb3,
  exceedsCeiling,
  openingAabb3,
  rackAabb3,
  roomEnvelope3,
} from "../aabb3.ts";
import { calculateAll } from "../pipeline.ts";
import { defaultCatalogs } from "../catalogs.ts";
import { emptyReality, type Opening, type Rack } from "../types.ts";

function floorRack(partial: Partial<Rack> & Pick<Rack, "id" | "heightM">): Rack {
  return {
    name: partial.name ?? partial.id,
    x: partial.x ?? 1,
    y: partial.y ?? 1,
    widthM: partial.widthM ?? TEST_RACK_A.widthM,
    depthM: partial.depthM ?? TEST_RACK_A.depthM,
    rotationDeg: 0,
    shelves: TEST_RACK_A.shelves,
    usableShelfWidthM: TEST_RACK_A.usableShelfWidthM,
    usableShelfDepthM: TEST_RACK_A.usableShelfDepthM,
    asicCount: 0,
    airflowToward: "south",
    ...partial,
  };
}

describe("GEO-3D-01 XY overlap + Z separation → no collision", () => {
  it("rack top 1.80 m under beam bottom 2.30 m is not a collision", () => {
    const rack = rackAabb3(floorRack({ id: "r", heightM: 1.8, x: 1, y: 1 }));
    const beam = aabb3(1, 1 + TEST_RACK_A.widthM, 1, 1 + TEST_RACK_A.depthM, 2.3, 2.6);
    assert.ok(aabb3OverlapX(rack, beam) > 0);
    assert.ok(aabb3OverlapY(rack, beam) > 0);
    assert.ok(aabb3OverlapZ(rack, beam) <= 0);
    assert.equal(aabb3Intersects(rack, beam), false);

    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.racks = [floorRack({ id: "r", heightM: 1.8, x: 1, y: 1 })];
    p.reality = {
      ...emptyReality(),
      asBuilt: [
        {
          id: "beam_above",
          kind: "beam",
          name: "Beam",
          x: 1,
          y: 1,
          z: 2.3,
          widthM: TEST_RACK_A.widthM,
          depthM: TEST_RACK_A.depthM,
          heightM: 0.3,
          provenance: "USER_CONFIRMED",
          confidence: "HIGH",
        },
      ],
    };
    const r = calculateAll(p, defaultCatalogs());
    assert.equal(r.racks.asBuiltHits.length, 0);
    assert.equal(r.racks.perRackCapacity[0]?.blocked, false);
  });
});

describe("GEO-3D-02 XYZ overlap → collision", () => {
  it("rack top 2.45 m through beam bottom 2.30 m is a collision", () => {
    const rack = rackAabb3(floorRack({ id: "r", heightM: 2.45, x: 1, y: 1 }));
    const beam = aabb3(1, 1 + TEST_RACK_A.widthM, 1, 1 + TEST_RACK_A.depthM, 2.3, 2.6);
    assert.ok(aabb3Intersects(rack, beam));

    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.racks = [floorRack({ id: "r", heightM: 2.45, x: 1, y: 1 })];
    p.reality = {
      ...emptyReality(),
      asBuilt: [
        {
          id: "beam_hit",
          kind: "beam",
          name: "Beam",
          x: 1,
          y: 1,
          z: 2.3,
          widthM: TEST_RACK_A.widthM,
          depthM: TEST_RACK_A.depthM,
          heightM: 0.3,
          provenance: "USER_CONFIRMED",
          confidence: "HIGH",
        },
      ],
    };
    const r = calculateAll(p, defaultCatalogs());
    assert.ok(r.racks.asBuiltHits.length >= 1);
    assert.equal(r.racks.asBuiltHits[0]?.id, "r");
    assert.equal(r.racks.asBuiltHits[0]?.objectId, "beam_hit");
    assert.equal(r.racks.perRackCapacity[0]?.blocked, true);
    assert.equal(r.racks.usableCapacity, 0);
    assert.ok(r.warnings.some((w) => w.id.startsWith("asbuilt-")));
  });
});

describe("GEO-3D-03 rack crosses ceiling → warning", () => {
  it("room 2.80 m / rack 2.95 m is a ceiling envelope hit", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.racks = [floorRack({ id: "r", heightM: 2.95, x: 1, y: 1 })];
    const box = rackAabb3(p.racks[0]);
    assert.equal(exceedsCeiling(box, 2.8), true);
    const valid = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    valid.racks = [floorRack({ id: "ok", heightM: 2.6, x: 1, y: 1 })];
    assert.equal(exceedsCeiling(rackAabb3(valid.racks[0]), 2.8), false);

    const r = calculateAll(p, defaultCatalogs());
    assert.ok(r.racks.ceilingHits.some((h) => h.id === "r"));
    assert.equal(r.racks.perRackCapacity[0]?.blocked, true);
    assert.ok(r.warnings.some((w) => w.id.startsWith("ceil-")));
  });
});

describe("GEO-3D-04 room height change moves engineering ceiling", () => {
  it("2.80 → 2.45 m relocates ceiling AABB z", () => {
    const a = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    const b = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.45 });
    const ca = ceilingAabb3(a);
    const cb = ceilingAabb3(b);
    assert.equal(ca.z1, 2.8);
    assert.equal(cb.z1, 2.45);
    assert.equal(roomEnvelope3(a).z2, 2.8);
    assert.equal(roomEnvelope3(b).z2, 2.45);
    assert.notEqual(ca.z1, cb.z1);

    const o: Opening = {
      id: "o1",
      type: "TECHNICAL",
      wallId: "south",
      widthM: 1.2,
      heightM: 1.2,
      bottomElevationM: 0.8,
      offsetFromWallStartM: 1,
    };
    const hole = openingAabb3(a, o);
    assert.equal(hole.z1, 0.8);
    assert.equal(hole.z2, 2.0);

    const beam = {
      id: "b",
      kind: "beam" as const,
      name: "B",
      x: 0,
      y: 0,
      z: 2.5,
      widthM: 1,
      heightM: 0.3,
      depthM: 0.3,
      provenance: "USER_CONFIRMED" as const,
      confidence: "HIGH" as const,
    };
    const bb = asBuiltAabb3(beam);
    assert.equal(bb.z1, beam.z);
    assert.equal(bb.z2, beam.z + beam.heightM);
  });
});
