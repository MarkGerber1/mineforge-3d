import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessOpeningAirflow } from "../opening-airflow.ts";
import { componentLossAtFlow, resolvedVentComponents } from "../pressure.ts";
import { emptyRectangularProject } from "../../project/factory.ts";

function base() {
  const p = emptyRectangularProject({ widthM: 4, depthM: 5, heightM: 2.7 });
  p.ventilation.openingCriteriaEnabled = true;
  p.ventilation.openingCriteria = { maxFaceVelocityMs: 5, freeAreaRatio: 0.5, source: "test criterion" };
  p.openings = [
    { id: "in", type: "INTAKE", wallId: "west", widthM: 2, heightM: 1, bottomElevationM: 0, offsetFromWallStartM: 1 },
    { id: "out", type: "EXHAUST", wallId: "east", widthM: 2, heightM: 1, bottomElevationM: 0, offsetFromWallStartM: 1 },
  ];
  return p;
}

describe("OPEN V2 opening duty model", () => {
  it("OPEN-01 valid large opening passes", () => {
    const r = assessOpeningAirflow(base(), 10_000);
    assert.equal(r.valid, true);
    assert.equal(r.exhaust[0]!.status, "PASS");
  });

  it("OPEN-02 small opening reports excessive velocity/undersized", () => {
    const p = base();
    p.openings = p.openings.map((o) => ({ ...o, widthM: 0.4, heightM: 0.4 }));
    const r = assessOpeningAirflow(p, 10_000);
    assert.equal(r.valid, false);
    assert.ok(["UNDERSIZED", "EXCESSIVE_FACE_VELOCITY"].includes(r.exhaust[0]!.status));
  });

  it("OPEN-03 required gross area follows Q/(3600 v ratio)", () => {
    const r = assessOpeningAirflow(base(), 18_000);
    assert.ok(Math.abs(r.exhaust[0]!.requiredGrossAreaM2 - 2) < 1e-9);
  });

  it("OPEN-04 free-area ratio changes effective area", () => {
    const p = base();
    const a = assessOpeningAirflow(p, 10_000).exhaust[0]!;
    p.ventilation.openingCriteria = { ...p.ventilation.openingCriteria!, freeAreaRatio: 0.25 };
    const b = assessOpeningAirflow(p, 10_000).exhaust[0]!;
    assert.ok(b.faceVelocityMs > a.faceVelocityMs);
    assert.ok(b.requiredGrossAreaM2 === a.requiredGrossAreaM2 * 2);
  });

  it("OPEN-05 linked opening local K contributes deterministic pressure loss", () => {
    const p = base();
    p.ventilation.components = [{
      id: "open-component", kind: "opening", name: "Exhaust grille", shape: "rect", widthM: 2, heightM: 1,
      lengthM: 0, frictionFactor: 0, kLocal: 2, extraPressurePa: 0, openingId: "out",
    }];
    const a = assessOpeningAirflow(p, 10_000).exhaust[0]!;
    assert.ok(a.localLossPa > 0);
    assert.equal(a.localLossPa, 2 * a.dynamicPressurePa);
  });

  it("OPEN-06 fan/system network uses the same effective opening area", () => {
    const p = base();
    p.openings = p.openings.map((o) => ({ ...o, widthM: 1, heightM: 1 }));
    p.ventilation.components = [{
      id: "open-component", kind: "opening", name: "Exhaust grille", shape: "rect", widthM: 1, heightM: 1,
      lengthM: 0, frictionFactor: 0, kLocal: 2, extraPressurePa: 0, openingId: "out",
    }];
    const opening = assessOpeningAirflow(p, 3600).exhaust[0]!;
    const component = componentLossAtFlow(resolvedVentComponents(p)[0]!, 3600);
    assert.equal(component.velocityMs, opening.faceVelocityMs);
    assert.equal(component.localPa, opening.localLossPa);
  });
});
