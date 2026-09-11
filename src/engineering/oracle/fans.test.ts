import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FAN_STRONG, FAN_WEAK } from "../../equipment/fan-catalog.ts";
import { combinedFanPressure, quadraticOperatingPoint } from "../fans.ts";

const kSys = 720 / 40000 ** 2;

describe("FAN-01 high free-air trap", () => {
  it("FAN_WEAK fails 40000 m³/h system", () => {
    const op = quadraticOperatingPoint(700, 60000, kSys, 0);
    assert.ok(op);
    assert.ok(Math.abs(op.q - 32957.653) < 10);
    assert.ok(Math.abs(op.p - 488.793) < 0.5);
    assert.equal(op.q >= 40000, false);
    assert.equal(FAN_WEAK.freeAirM3h > 40000, true);
  });
});

describe("FAN-02 strong fan pass", () => {
  it("FAN_STRONG intersects above required", () => {
    const op = quadraticOperatingPoint(1600, 60000, kSys, 0);
    assert.ok(op);
    assert.ok(Math.abs(op.q - 42294.443) < 10);
    assert.ok(Math.abs(op.p - 804.969) < 0.5);
    assert.equal(op.q >= 40000, true);
    assert.ok(Math.abs(op.q - 40000 - 2294.443) < 10);
  });
});

describe("FAN-03 two weak fans in parallel", () => {
  it("does not double free-air into a fake PASS", () => {
    const op = quadraticOperatingPoint(700, 120000, kSys, 0);
    assert.ok(op);
    assert.ok(Math.abs(op.q - 37468.65) < 10);
    assert.ok(Math.abs(op.p - 631.755) < 0.5);
    assert.equal(op.q >= 40000, false);
    const pAt37k = combinedFanPressure(
      FAN_WEAK,
      { id: "x", specId: FAN_WEAK.id, name: "x", x: 0, y: 0, arrangement: "parallel", count: 2, dirtyFilter: false },
      op.q,
    );
    assert.ok(Math.abs(pAt37k - op.p) < 1);
  });
});

describe("FAN-04 clean / dirty filter", () => {
  it("clean PASS, dirty FAIL", () => {
    const clean = quadraticOperatingPoint(1600, 60000, kSys, 0);
    const dirty = quadraticOperatingPoint(1600, 60000, kSys, 200);
    assert.ok(clean && dirty);
    assert.ok(Math.abs(clean.q - 42294.443) < 10);
    assert.equal(clean.q >= 40000, true);
    assert.ok(Math.abs(dirty.q - 39562.828) < 10);
    assert.ok(Math.abs(dirty.p - 904.348) < 0.5);
    assert.equal(dirty.q >= 40000, false);
  });
});
