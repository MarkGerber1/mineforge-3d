import assert from "node:assert/strict";
import test from "node:test";
import { ventRoomTest01 } from "../../project/factory.ts";

test("VENT-ROOM-TEST-01 controlled fixture has only measured room context", () => {
  const p = ventRoomTest01();
  assert.equal(p.name, "VENT-ROOM-TEST-01");
  assert.deepEqual(p.room, { kind: "rectangular", widthM: 4, depthM: 5, heightM: 2.7, wallThicknessM: 0.2 });
  assert.equal(p.openings.length, 1);
  assert.equal(p.openings[0]?.type, "DOOR");
  assert.equal(p.openings[0]?.wallId, "south");
  assert.equal(p.reality?.asBuilt.length, 3);
  assert.equal(p.fleet.requestedCount, 0);
  assert.equal(p.racks.length, 0);
  assert.equal(p.fans.length, 0);
  assert.equal(p.ventilation.openingCriteriaEnabled, true);
});
