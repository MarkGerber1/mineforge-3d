import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateCapacity } from "../capacity.ts";

function pack(partial: {
  requested: number;
  elec: number;
  vent: number;
  space: number;
  rack: number;
}) {
  return calculateCapacity({
    requested: partial.requested,
    maxByElectrical: partial.elec,
    electricalKnown: true,
    electricalDetail: "",
    electricalTrace: [],
    maxByVentilation: partial.vent,
    ventilationKnown: true,
    ventilationDetail: "",
    ventilationTrace: [],
    maxBySpace: partial.space,
    spaceKnown: true,
    spaceDetail: "",
    spaceTrace: [],
    maxByRack: partial.rack,
    rackKnown: true,
    rackDetail: "",
    rackTrace: [],
    maxByUser: null,
    userKnown: false,
    geometryValid: true,
    asicKnown: true,
    exhaustKnown: true,
    fanKnown: true,
    floorUnknown: false,
  });
}

describe("CAP-01 single bottleneck", () => {
  it("30 requested / 24 safe / ventilation", () => {
    const r = pack({ requested: 30, elec: 40, vent: 24, space: 36, rack: 32 });
    assert.equal(r.safe, 24);
    assert.deepEqual(r.bottlenecks, ["VENTILATION"]);
  });
});

describe("CAP-02 multiple bottlenecks", () => {
  it("shows both electrical and ventilation at 29", () => {
    const r = pack({ requested: 32, elec: 29, vent: 29, space: 40, rack: 35 });
    assert.equal(r.safe, 29);
    assert.ok(r.bottlenecks.includes("ELECTRICAL"));
    assert.ok(r.bottlenecks.includes("VENTILATION"));
    assert.equal(r.bottlenecks.length, 2);
  });
});

describe("CAP-03 bottleneck migration", () => {
  it("ventilation 24 → 29 then electrical 27", () => {
    const a = pack({ requested: 30, elec: 27, vent: 24, space: 40, rack: 40 });
    assert.equal(a.safe, 24);
    assert.deepEqual(a.bottlenecks, ["VENTILATION"]);
    const b = pack({ requested: 30, elec: 27, vent: 29, space: 40, rack: 40 });
    assert.equal(b.safe, 27);
    assert.deepEqual(b.bottlenecks, ["ELECTRICAL"]);
  });
});

describe("CAP-04 useless upgrade", () => {
  it("raising electrical 40 → 60 does not raise SAFE", () => {
    const a = pack({ requested: 30, elec: 40, vent: 24, space: 36, rack: 32 });
    const b = pack({ requested: 30, elec: 60, vent: 24, space: 36, rack: 32 });
    assert.equal(a.safe, 24);
    assert.equal(b.safe, 24);
    assert.deepEqual(b.bottlenecks, ["VENTILATION"]);
  });
});
