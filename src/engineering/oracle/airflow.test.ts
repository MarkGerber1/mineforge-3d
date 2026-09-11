import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crossSectionAreaM2, dynamicPressurePa, frictionLossPa, hydraulicDiameterM, localLossPa, velocityMs } from "../airflow.ts";
import type { VentComponent } from "../types.ts";

function duct(w: number, h: number): VentComponent {
  return {
    id: "d",
    kind: "duct",
    name: "d",
    shape: "rect",
    widthM: w,
    heightM: h,
    lengthM: 20,
    frictionFactor: 0.02,
    kLocal: 0,
    extraPressurePa: 0,
  };
}

describe("AIR-01 area and Dh", () => {
  it("1.000 × 0.500", () => {
    const c = duct(1, 0.5);
    assert.equal(crossSectionAreaM2(c), 0.5);
    assert.ok(Math.abs(hydraulicDiameterM(c) - 0.666666667) < 1e-9);
  });
});

describe("AIR-02 velocity and dynamic pressure", () => {
  it("18000 m³/h through 0.5 m²", () => {
    const v = velocityMs(18000, 0.5);
    assert.equal(v, 10);
    const pv = dynamicPressurePa(10);
    assert.ok(Math.abs(pv - 60.205) < 0.0005);
  });
});

describe("AIR-03 friction loss", () => {
  it("f=0.020 L=20", () => {
    const pv = dynamicPressurePa(10);
    const dh = 0.666666667;
    const dp = frictionLossPa(0.02, 20, dh, pv);
    assert.ok(Math.abs(dp - 36.123) < 0.001);
  });
});

describe("AIR-04 local + total", () => {
  it("K=1.5", () => {
    const pv = dynamicPressurePa(10);
    const dh = 0.666666667;
    const fr = frictionLossPa(0.02, 20, dh, pv);
    const loc = localLossPa(1.5, pv);
    assert.ok(Math.abs(loc - 90.3075) < 0.001);
    assert.ok(Math.abs(fr + loc - 126.4305) < 0.002);
  });
});

describe("AIR-05 small vs large 75 m shaft", () => {
  it("larger shaft reduces friction", () => {
    const Q = 40000;
    const f = 0.02;
    const L = 75;
    const caseA = duct(0.9, 0.9);
    const caseB = duct(1.4, 0.9);
    const run = (c: VentComponent) => {
      const A = crossSectionAreaM2(c);
      const Dh = hydraulicDiameterM(c);
      const v = velocityMs(Q, A);
      const pv = dynamicPressurePa(v);
      const fr = frictionLossPa(f, L, Dh, pv);
      return { A, Dh, v, pv, fr };
    };
    const a = run(caseA);
    const b = run(caseB);
    assert.ok(Math.abs(a.A - 0.81) < 1e-9);
    assert.ok(Math.abs(a.v - 13.717421) < 0.00001);
    assert.ok(Math.abs(a.pv - 113.286329) < 0.001);
    assert.ok(Math.abs(a.Dh - 0.9) < 1e-9);
    assert.ok(Math.abs(a.fr - 188.810548) < 0.001);
    assert.ok(Math.abs(b.A - 1.26) < 1e-9);
    assert.ok(Math.abs(b.v - 8.818342) < 0.00001);
    assert.ok(Math.abs(b.pv - 46.817309) < 0.001);
    assert.ok(Math.abs(b.Dh - 1.095652) < 0.000001);
    assert.ok(Math.abs(b.fr - 64.095126) < 0.001);
    assert.ok(b.fr < a.fr);
  });
});
