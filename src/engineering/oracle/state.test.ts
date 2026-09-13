import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TEST_ASIC_A } from "../../equipment/asic-catalog.ts";
import { defaultCatalogs } from "../catalogs.ts";
import { emptyRectangularProject } from "../../project/factory.ts";
import { parseProject } from "../../project/schema.ts";
import { analyzeGeometry, resizeRectangularRoom, roomMetrics } from "../geometry.ts";
import { calculateAll } from "../pipeline.ts";
import { applyPatch } from "../upgrade.ts";
import { calculateCapacity } from "../capacity.ts";
import { frictionLossPa, hydraulicDiameterM, crossSectionAreaM2, velocityMs, dynamicPressurePa } from "../airflow.ts";
import type { VentComponent } from "../types.ts";

describe("STATE-01 canonical state synchronization", () => {
  it("project / derived geometry stay in lockstep at 7.510 m", () => {
    const p = resizeRectangularRoom(emptyRectangularProject({ widthM: 6, depthM: 4, heightM: 2.8 }), "east", 7.51);
    assert.equal(p.room.widthM, 7.51);
    const g = analyzeGeometry(p);
    const m = roomMetrics(p.room.widthM, p.room.depthM, p.room.heightM);
    assert.equal(g.floorAreaM2, m.floorAreaM2);
    assert.ok(Math.abs(g.floorAreaM2 - 30.04) < 0.001);
    assert.ok(Math.abs(g.volumeM3 - 84.112) < 0.001);
  });
});

describe("STATE-02 save / reload determinism", () => {
  it("JSON round-trip preserves numbers", () => {
    let p = emptyRectangularProject({ widthM: 7.51, depthM: 4, heightM: 2.8 });
    p.openings = [
      {
        id: "ex",
        type: "EXHAUST",
        wallId: "east",
        widthM: 1.4,
        heightM: 0.9,
        bottomElevationM: 0.4,
        offsetFromWallStartM: 1,
        name: "Exhaust",
      },
    ];
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 30 };
    const json = JSON.stringify(p);
    const loaded = parseProject(JSON.parse(json));
    assert.equal(loaded.room.widthM, 7.51);
    assert.equal(loaded.openings[0].widthM, 1.4);
    assert.equal(loaded.fleet.requestedCount, 30);
    const a = calculateAll(p, defaultCatalogs());
    const b = calculateAll(loaded, defaultCatalogs());
    assert.equal(a.geometry.floorAreaM2, b.geometry.floorAreaM2);
    assert.equal(a.electrical.typicalTotalW, b.electrical.typicalTotalW);
  });
});

describe("STATE-03 AI must obey engineering core", () => {
  it("electrical upgrade does not override ventilation bottleneck", () => {
    const r = calculateCapacity({
      requested: 30,
      maxByElectrical: 40,
      electricalKnown: true,
      electricalDetail: "",
      electricalTrace: [],
      maxByVentilation: 24,
      ventilationKnown: true,
      ventilationDetail: "",
      ventilationTrace: [],
      maxBySpace: 36,
      spaceKnown: true,
      spaceDetail: "",
      spaceTrace: [],
      maxByRack: 32,
      rackKnown: true,
      rackDetail: "",
      rackTrace: [],
      maxByFloor: null,
      floorKnown: false,
      floorDetail: "",
      floorTrace: [],
      maxByUser: null,
      userKnown: false,
      geometryValid: true,
      asicKnown: true,
      exhaustKnown: true,
      intakeKnown: true,
      openingsValid: true,
      fanKnown: true,
      floorUnknown: false,
      hasBlocker: false,
      hasCriticalConflict: false,
    });
    assert.equal(r.safe, 24);
    assert.deepEqual(r.bottlenecks, ["VENTILATION"]);
    const afterElec = calculateCapacity({
      requested: 36,
      maxByElectrical: 80,
      electricalKnown: true,
      electricalDetail: "",
      electricalTrace: [],
      maxByVentilation: 24,
      ventilationKnown: true,
      ventilationDetail: "",
      ventilationTrace: [],
      maxBySpace: 36,
      spaceKnown: true,
      spaceDetail: "",
      spaceTrace: [],
      maxByRack: 32,
      rackKnown: true,
      rackDetail: "",
      rackTrace: [],
      maxByFloor: null,
      floorKnown: false,
      floorDetail: "",
      floorTrace: [],
      maxByUser: null,
      userKnown: false,
      geometryValid: true,
      asicKnown: true,
      exhaustKnown: true,
      intakeKnown: true,
      openingsValid: true,
      fanKnown: true,
      floorUnknown: false,
      hasBlocker: false,
      hasCriticalConflict: false,
    });
    assert.equal(afterElec.safe, 24);
  });
});

describe("STATE-04 preview apply undo of opening", () => {
  it("opening 0.9 → 1.4 changes shaft friction then undo restores", () => {
    const shaft = (w: number, h: number): VentComponent => ({
      id: "s",
      kind: "duct",
      name: "shaft",
      shape: "rect",
      widthM: w,
      heightM: h,
      lengthM: 75,
      frictionFactor: 0.02,
      kLocal: 0,
      extraPressurePa: 0,
    });
    const loss = (c: VentComponent) => {
      const A = crossSectionAreaM2(c);
      const Dh = hydraulicDiameterM(c);
      const v = velocityMs(40000, A);
      return frictionLossPa(0.02, 75, Dh, dynamicPressurePa(v));
    };
    const before = loss(shaft(0.9, 0.9));
    const after = loss(shaft(1.4, 0.9));
    assert.ok(Math.abs(before - 188.811) < 0.01);
    assert.ok(Math.abs(after - 64.095) < 0.01);

    let p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.openings = [
      {
        id: "ex",
        type: "EXHAUST",
        wallId: "east",
        widthM: 0.9,
        heightM: 0.9,
        bottomElevationM: 0.4,
        offsetFromWallStartM: 1,
      },
    ];
    const proposed = applyPatch(p, {
      openings: p.openings.map((o) => (o.id === "ex" ? { ...o, widthM: 1.4 } : o)),
    });
    assert.equal(p.openings[0].widthM, 0.9);
    assert.equal(proposed.openings[0].widthM, 1.4);
    p = proposed;
    assert.equal(p.openings[0].widthM, 1.4);
    p = applyPatch(p, {
      openings: p.openings.map((o) => (o.id === "ex" ? { ...o, widthM: 0.9 } : o)),
    });
    assert.equal(p.openings[0].widthM, 0.9);
  });
});
