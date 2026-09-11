import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TEST_ASIC_A } from "../../equipment/asic-catalog.ts";
import { emptyRectangularProject } from "../../project/factory.ts";
import { calculateThermal, thermalAirflowM3s } from "../thermal.ts";
import { m3sToM3h } from "../units.ts";

function load(n: number, dT: number, aux = 0) {
  const p = emptyRectangularProject();
  p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: n };
  p.thermal.deltaTK = dT;
  p.electrical.auxiliaryW = aux;
  const typical = n * TEST_ASIC_A.typicalPowerW;
  return calculateThermal(p, TEST_ASIC_A, typical);
}

describe("THERM-01 ASIC heat load", () => {
  it("30 × 3510 W", () => {
    const r = load(30, 10);
    assert.equal(r.asicHeatW, 105300);
    assert.equal(r.totalHeatW, 105300);
  });
});

describe("THERM-02 ΔT = 10°C", () => {
  it("Q = P/(ρ Cp ΔT)", () => {
    const q = thermalAirflowM3s(105300, 10);
    assert.ok(Math.abs(q - 8.701612773) < 1e-8);
    const qh = m3sToM3h(q);
    assert.ok(Math.abs(qh - 31325.805984) < 1e-5);
    const r = load(30, 10);
    assert.ok(Math.abs(r.thermalAirflowM3h - 31325.805984) < 1e-4);
  });
});

describe("THERM-03 ΔT = 5°C", () => {
  it("approximately 2× of 10°C", () => {
    const r = load(30, 5);
    assert.ok(Math.abs(r.thermalAirflowM3s - 17.403225547) < 1e-8);
    assert.ok(Math.abs(r.thermalAirflowM3h - 62651.611968) < 1e-4);
  });
});

describe("THERM-04 ΔT = 15°C", () => {
  it("matches oracle", () => {
    const r = load(30, 15);
    assert.ok(Math.abs(r.thermalAirflowM3s - 5.801075182) < 1e-8);
    assert.ok(Math.abs(r.thermalAirflowM3h - 20883.870656) < 1e-4);
  });
});

describe("THERM-05 thermal vs equipment", () => {
  it("thermal dominates at 10°C", () => {
    const r = load(30, 10);
    assert.equal(r.equipmentAirflowM3h, 27000);
    assert.ok(Math.abs(r.designAirflowM3h - 31325.805984) < 0.01);
    assert.equal(r.dominant, "thermal");
  });
});

describe("THERM-06 equipment dominates at 15°C", () => {
  it("design = 27000", () => {
    const r = load(30, 15);
    assert.ok(Math.abs(r.thermalAirflowM3h - 20883.871) < 0.01);
    assert.equal(r.equipmentAirflowM3h, 27000);
    assert.equal(r.designAirflowM3h, 27000);
    assert.equal(r.dominant, "equipment");
  });
});

describe("THERM-07 auxiliary heat", () => {
  it("5000 W extra", () => {
    const r = load(30, 10, 5000);
    assert.equal(r.totalHeatW, 110300);
    assert.ok(Math.abs(r.thermalAirflowM3h - 32813.261159) < 1e-4);
  });
});
