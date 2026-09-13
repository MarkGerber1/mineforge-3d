import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TEST_ASIC_A } from "../../equipment/asic-catalog.ts";
import { emptyRectangularProject } from "../../project/factory.ts";
import { calculateElectrical, designCurrentA, distributePhases, maxByPower, typicalCurrentA, usableElectricalW } from "../electrical.ts";
import { roundTo } from "../units.ts";

describe("ELEC-01 single ASIC current", () => {
  it("3510 / 230", () => {
    const I = typicalCurrentA(TEST_ASIC_A, 230);
    assert.ok(Math.abs(I - 15.260869565) < 1e-9);
    assert.equal(roundTo(I, 3).toFixed(3), "15.261");
  });
});

describe("ELEC-02 30 ASIC total load", () => {
  it("power, hashrate, weight", () => {
    const p = emptyRectangularProject();
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 30 };
    p.electrical.known = true;
    p.electrical.availablePowerW = 200000;
    const r = calculateElectrical(p, TEST_ASIC_A);
    assert.equal(r.typicalTotalW, 105300);
    assert.ok(Math.abs(r.hashrateThs - 7020) < 0.01);
    assert.ok(Math.abs(r.totalWeightKg - 426) < 0.01);
  });
});

describe("ELEC-03 perfect three-phase", () => {
  it("30 → 10/10/10", () => {
    const d = distributePhases(30);
    assert.deepEqual(d, { l1: 10, l2: 10, l3: 10 });
    const p = emptyRectangularProject();
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 30 };
    p.electrical.known = true;
    p.electrical.availablePowerW = 200000;
    const r = calculateElectrical(p, TEST_ASIC_A);
    const iPu = typicalCurrentA(TEST_ASIC_A, 230);
    assert.ok(Math.abs(iPu - 15.260869565217391) < 1e-9);
    assert.ok(Math.abs(r.calculatedLineCurrentA - iPu) < 1e-9);
    assert.equal(r.currentProvenance, "MANUFACTURER_NAMEPLATE");
    assert.equal(r.nameplateCurrentA, TEST_ASIC_A.currentA);
    assert.ok(Math.abs(r.l1CurrentA - 10 * (TEST_ASIC_A.currentA ?? 0)) < 1e-9);
    assert.ok(Math.abs(r.l2CurrentA - 10 * (TEST_ASIC_A.currentA ?? 0)) < 1e-9);
    assert.ok(Math.abs(r.l3CurrentA - 10 * (TEST_ASIC_A.currentA ?? 0)) < 1e-9);
    assert.ok(Math.abs(10 * iPu - 152.608695652) < 1e-9);
    assert.equal(r.imbalanceAsic, 0);
    assert.equal(roundTo(r.l1CurrentA, 2).toFixed(2), "152.61");
  });
});

describe("ELEC-04 31 ASIC phase balancing", () => {
  it("11/10/10 not 12/10/9", () => {
    const d = distributePhases(31);
    const counts = [d.l1, d.l2, d.l3].sort((a, b) => b - a);
    assert.deepEqual(counts, [11, 10, 10]);
    const p = emptyRectangularProject();
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 31 };
    p.electrical.known = true;
    p.electrical.availablePowerW = 200000;
    const r = calculateElectrical(p, TEST_ASIC_A);
    assert.equal(r.typicalTotalW, 108810);
    const eleven = 11 * typicalCurrentA(TEST_ASIC_A, 230);
    assert.ok(Math.abs(eleven - 167.869565217) < 1e-9);
  });
});

describe("ELEC-05 typical passes, design fails", () => {
  it("110 kW / 30 ASIC", () => {
    const p = emptyRectangularProject();
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 30 };
    p.electrical.known = true;
    p.electrical.availablePowerW = 110000;
    p.electrical.reservePct = 0;
    p.electrical.policy = "design";
    const r = calculateElectrical(p, TEST_ASIC_A);
    assert.equal(r.typicalTotalW, 105300);
    assert.equal(r.typicalPass, true);
    assert.equal(r.designTotalW, 110565);
    assert.equal(r.designPass, false);
    assert.equal(r.maxByDesign, 29);
    assert.equal(Math.floor(110000 / 3685.5), 29);
  });
});

describe("ELEC-06 design reserve", () => {
  it("120 kW with 15% reserve → 27", () => {
    const p = emptyRectangularProject();
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 30 };
    p.electrical.known = true;
    p.electrical.availablePowerW = 120000;
    p.electrical.reservePct = 15;
    p.electrical.policy = "design";
    const r = calculateElectrical(p, TEST_ASIC_A);
    const usable = usableElectricalW(p.electrical);
    assert.equal(usable, 102000);
    assert.equal(r.maxByDesign, 27);
    assert.equal(maxByPower(102000, designCurrentA(TEST_ASIC_A) * 230), 27);
  });
});
