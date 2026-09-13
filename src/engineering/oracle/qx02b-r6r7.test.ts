import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ASIC_S21_PRO, TEST_ASIC_A } from "../../equipment/asic-catalog.ts";
import { emptyRectangularProject, undergroundParkingFarm, withKnownFloor, TEST_RACK_A, verifiedAcceptanceProject } from "../../project/factory.ts";
import { parseProject } from "../../project/schema.ts";
import { saveScheduler } from "../../project/save-scheduler.ts";
import { useProjectStore } from "../../project/store.ts";
import { defaultCatalogs } from "../catalogs.ts";
import { validateAsicSpecRelations, supplyVoltageCompatible } from "../asic-spec.ts";
import { validateCanonicalProjectDomains } from "../canonical.ts";
import { STANDARD_NET_FLOOR_PAYLOAD_PA } from "../constants.ts";
import { maxAsicByFloorOnRack, rackPlanFootprintM2 } from "../floor.ts";
import { calculateAll } from "../pipeline.ts";
import { applyPatchValidated } from "../upgrade.ts";
import type { AsicSpec, Project, Rack } from "../types.ts";

saveScheduler.setSave(async () => undefined);

const catalogs = defaultCatalogs();

function live() {
  return useProjectStore.getState();
}

function rackAt(x: number, y: number, id = "r1", extra: Partial<Rack> = {}): Rack {
  return {
    id,
    name: id,
    ...TEST_RACK_A,
    x,
    y,
    rotationDeg: 0,
    asicCount: 0,
    airflowToward: "south",
    ...extra,
  };
}

function verifiedBase(): Project {
  return verifiedAcceptanceProject();
}

function imported(asic: AsicSpec): Project {
  const p = verifiedBase();
  p.fleet = { asicId: asic.id, requestedCount: 24, imported: asic };
  return p;
}

function cloneAsic(extra: Partial<AsicSpec> = {}): AsicSpec {
  return { ...TEST_ASIC_A, ...extra };
}

describe("ASIC-REL-01 typical=3510 design=3685.5 valid", () => {
  it("ok", () => {
    assert.equal(validateAsicSpecRelations(TEST_ASIC_A).ok, true);
    assert.equal(validateCanonicalProjectDomains(imported(TEST_ASIC_A), catalogs).ok, true);
  });
});

describe("ASIC-REL-02 design == typical valid", () => {
  it("ok", () => {
    const a = cloneAsic({ designPowerW: 3510, typicalPowerW: 3510 });
    assert.equal(validateAsicSpecRelations(a).ok, true);
    assert.equal(validateCanonicalProjectDomains(imported(a), catalogs).ok, true);
  });
});

describe("ASIC-REL-03 design < typical imported rejected", () => {
  it("reject", () => {
    const a = cloneAsic({ typicalPowerW: 3510, designPowerW: 1000 });
    assert.equal(validateAsicSpecRelations(a).ok, false);
    const p = imported(a);
    assert.equal(validateCanonicalProjectDomains(p, catalogs).ok, false);
    assert.throws(() => parseProject(JSON.parse(JSON.stringify(p))));
  });
});

describe("ASIC-REL-04 design < typical APPLY rejected, canonical unchanged", () => {
  it("APPLY", () => {
    const p = verifiedBase();
    const before = p.fleet.imported;
    const bad = cloneAsic({ id: TEST_ASIC_A.id, typicalPowerW: 3510, designPowerW: 1000 });
    const res = applyPatchValidated(p, { fleet: { asicId: bad.id, imported: bad } }, catalogs);
    assert.equal(res.ok, false);
    assert.equal(res.project.fleet.imported, before);
  });
});

describe("ASIC-REL-05 design < typical load/import rejected", () => {
  it("load", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const beforeImported = live().project.fleet.imported;
    const bad = imported(cloneAsic({ typicalPowerW: 3510, designPowerW: 1000 }));
    assert.equal(live().loadProject(bad, false).ok, false);
    assert.equal(live().project.fleet.asicId, TEST_ASIC_A.id);
    assert.equal(live().project.fleet.imported, beforeImported);
    assert.equal(live().project.fleet.imported?.source.trust, "OFFICIAL_VERIFIED");
  });
});

describe("ASIC-REL-06 synthetic invalid catalog ASIC is BLOCKER", () => {
  it("never VERIFIED, no crash", () => {
    const cats = defaultCatalogs();
    cats.asics[TEST_ASIC_A.id] = cloneAsic({ typicalPowerW: 3510, designPowerW: 1000 });
    const p = verifiedBase();
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: p.fleet.requestedCount };
    const r = calculateAll(p, cats);
    assert.ok(r.warnings.some((w) => w.id === "asic-spec-invalid" && w.severity === "BLOCKER"));
    assert.equal(r.capacity.verified, false);
    assert.notEqual(r.capacity.safety, "VERIFIED");
  });
});

describe("ASIC-REL-07 existing catalog remains valid", () => {
  it("all catalog specs pass relations", () => {
    for (const a of Object.values(catalogs.asics)) {
      assert.equal(validateAsicSpecRelations(a).ok, true, a.id);
    }
  });
});

describe("R6-C malformed imported cannot raise electrical SAFE", () => {
  it("design 1000 < typical 3510 never becomes Engineering source", () => {
    const p = verifiedBase();
    p.electrical.policy = "design";
    const baseline = calculateAll(p, catalogs);
    const bad = cloneAsic({ typicalPowerW: 3510, designPowerW: 1000 });
    const patched = applyPatchValidated(p, { fleet: { asicId: bad.id, imported: bad } }, catalogs);
    assert.equal(patched.ok, false);
    live().loadProject(p, false);
    live().propose({
      id: "bad-asic",
      summary: "low design",
      detail: "",
      patch: { fleet: { asicId: bad.id, imported: bad } },
      fromGrok: true,
    });
    assert.equal(live().applyProposed().ok, false);
    assert.equal(live().project.fleet.imported, p.fleet.imported);
    assert.equal(live().project.fleet.imported?.source.trust, "OFFICIAL_VERIFIED");
    const after = calculateAll(live().project, catalogs);
    assert.ok((after.electrical.maxByDesign ?? 0) <= (baseline.electrical.maxByDesign ?? 0) + 1e-9);
    assert.equal(after.capacity.verified, baseline.capacity.verified);
  });
});

describe("VOLT-01 TEST_ASIC_A + 230 V compatible", () => {
  it("ok", () => {
    const p = verifiedBase();
    p.electrical.voltageV = 230;
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.supplyVoltageCompatible, true);
    assert.equal(supplyVoltageCompatible(TEST_ASIC_A, 230), true);
    assert.equal(r.warnings.some((w) => w.id === "asic-voltage-mismatch"), false);
    assert.equal(r.capacity.verified, true);
  });
});

describe("VOLT-02 229.99 V incompatible", () => {
  it("CRITICAL not VERIFIED", () => {
    const p = verifiedBase();
    p.electrical.voltageV = 229.99;
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.supplyVoltageCompatible, false);
    assert.ok(r.warnings.some((w) => w.id === "asic-voltage-mismatch" && w.severity === "CRITICAL"));
    assert.equal(r.capacity.verified, false);
    assert.equal(r.capacity.safety, "CRITICAL");
  });
});

describe("VOLT-03 230.01 V incompatible", () => {
  it("CRITICAL not VERIFIED", () => {
    const p = verifiedBase();
    p.electrical.voltageV = 230.01;
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.supplyVoltageCompatible, false);
    assert.equal(r.capacity.verified, false);
  });
});

describe("VOLT-04 1 V no positive VERIFIED electrical capacity", () => {
  it("maxByElectrical 0, project still canonical", () => {
    const p = verifiedBase();
    p.electrical.voltageV = 1;
    assert.equal(validateCanonicalProjectDomains(p, catalogs).ok, true);
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.maxByTypical, 0);
    assert.equal(r.electrical.maxByDesign, 0);
    const elec = r.capacity.slots.find((s) => s.kind === "ELECTRICAL");
    assert.equal(elec?.value, 0);
    assert.equal(r.capacity.verified, false);
    assert.ok(r.warnings.some((w) => w.id === "asic-voltage-mismatch"));
  });
});

describe("VOLT-05 S21 Pro minimum boundary", () => {
  it("220 V compatible", () => {
    const p = verifiedBase();
    p.fleet = { asicId: ASIC_S21_PRO.id, requestedCount: 24 };
    p.electrical.voltageV = ASIC_S21_PRO.voltageMin;
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.supplyVoltageCompatible, true);
    assert.equal(r.warnings.some((w) => w.id === "asic-voltage-mismatch"), false);
  });
});

describe("VOLT-06 S21 Pro maximum boundary", () => {
  it("277 V compatible", () => {
    const p = verifiedBase();
    p.fleet = { asicId: ASIC_S21_PRO.id, requestedCount: 24 };
    p.electrical.voltageV = ASIC_S21_PRO.voltageMax;
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.supplyVoltageCompatible, true);
  });
});

describe("VOLT-07 just outside S21 Pro bounds", () => {
  it("incompatible", () => {
    const p = verifiedBase();
    p.fleet = { asicId: ASIC_S21_PRO.id, requestedCount: 24 };
    p.electrical.voltageV = ASIC_S21_PRO.voltageMin - 0.01;
    assert.equal(calculateAll(p, catalogs).electrical.supplyVoltageCompatible, false);
    p.electrical.voltageV = ASIC_S21_PRO.voltageMax + 0.01;
    assert.equal(calculateAll(p, catalogs).electrical.supplyVoltageCompatible, false);
  });
});

describe("VOLT-08 electrical known=false is not fake CRITICAL", () => {
  it("UNKNOWN/PRELIMINARY", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.electrical.known = false;
    p.electrical.voltageV = 1;
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 0 };
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.supplyVoltageCompatible, null);
    assert.equal(r.warnings.some((w) => w.id === "asic-voltage-mismatch"), false);
  });
});

describe("VOLT-09 CRITICAL → SAFE invariant", () => {
  it("voltage mismatch cannot be VERIFIED", () => {
    const p = verifiedBase();
    p.electrical.voltageV = 1;
    const r = calculateAll(p, catalogs);
    assert.ok(r.warnings.some((w) => w.severity === "CRITICAL"));
    assert.equal(r.capacity.verified, false);
    assert.notEqual(r.capacity.safety, "VERIFIED");
  });
});

describe("VOLT-10 restoring valid voltage removes voltage CRITICAL", () => {
  it("deterministic", () => {
    const p = verifiedBase();
    p.electrical.voltageV = 1;
    const bad = calculateAll(p, catalogs);
    assert.ok(bad.warnings.some((w) => w.id === "asic-voltage-mismatch"));
    p.electrical.voltageV = 230;
    const good = calculateAll(p, catalogs);
    assert.equal(good.warnings.some((w) => w.id === "asic-voltage-mismatch"), false);
    assert.equal(good.electrical.supplyVoltageCompatible, true);
    assert.equal(good.capacity.verified, true);
  });
});

describe("FLOOR-REL-01 unknown=true, no limit", () => {
  it("valid Project, not VERIFIED", () => {
    const p = emptyRectangularProject();
    assert.equal(p.constraints.floorLoadingUnknown, true);
    assert.equal(p.constraints.maxFloorLoadPa, undefined);
    assert.equal(validateCanonicalProjectDomains(p, catalogs).ok, true);
    const parsed = parseProject(JSON.parse(JSON.stringify(p)));
    assert.equal(parsed.constraints.floorLoadingUnknown, true);
    const r = calculateAll(p, catalogs);
    assert.equal(r.capacity.verified, false);
    assert.equal(r.floor.known, false);
  });
});

describe("FLOOR-REL-02 unknown=false, no limit rejected", () => {
  it("commit/load/import/APPLY", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const hostile = structuredClone(p) as Project;
    hostile.constraints.floorLoadingUnknown = false;
    delete hostile.constraints.maxFloorLoadPa;
    assert.equal(validateCanonicalProjectDomains(hostile, catalogs).ok, false);
    assert.throws(() => parseProject(JSON.parse(JSON.stringify(hostile))));
    assert.equal(live().loadProject(hostile, false).ok, false);
    assert.equal(live().commit(hostile, "bad floor"), false);
    const res = applyPatchValidated(p, { constraints: { floorLoadingUnknown: false, maxFloorLoadPa: undefined } }, catalogs);
    assert.equal(res.ok, false);
  });
});

describe("FLOOR-REL-03 invalid limit values rejected", () => {
  it("NaN/Infinity/0/negative", () => {
    const p = verifiedBase();
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      const n = structuredClone(p) as Project;
      n.constraints.floorLoadingUnknown = false;
      n.constraints.maxFloorLoadPa = v;
      assert.equal(validateCanonicalProjectDomains(n, catalogs).ok, false, String(v));
    }
  });
});

describe("FLOOR-REL-04 unknown=false + valid limit eligible", () => {
  it("floor analysis runs", () => {
    const p = verifiedBase();
    assert.equal(p.constraints.maxFloorLoadPa, STANDARD_NET_FLOOR_PAYLOAD_PA);
    const r = calculateAll(p, catalogs);
    assert.equal(r.floor.known, true);
    assert.equal(r.floor.model, "NET_EQUIPMENT_PAYLOAD");
    assert.ok((r.floor.maxByFloor ?? 0) > 0);
    assert.ok(r.capacity.slots.some((s) => s.kind === "FLOOR" && s.known));
  });
});

describe("FLOOR-SAFE-01 floor unknown PRELIMINARY", () => {
  it("not VERIFIED", () => {
    const p = verifiedBase();
    p.constraints.floorLoadingUnknown = true;
    const r = calculateAll(p, catalogs);
    assert.equal(r.capacity.confidence, "PRELIMINARY");
    assert.equal(r.capacity.verified, false);
    assert.equal(r.floor.known, false);
  });
});

describe("FLOOR-SAFE-02 floor known without limit rejected", () => {
  it("setFloorLoading", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const res = live().setFloorLoading(false, undefined);
    assert.equal(res.ok, false);
    assert.equal(live().project.constraints.maxFloorLoadPa, STANDARD_NET_FLOOR_PAYLOAD_PA);
  });
});

describe("FLOOR-SAFE-03 very low floor limit is limiting", () => {
  it("SAFE / bottleneck FLOOR", () => {
    const p = verifiedBase();
    withKnownFloor(p, 1);
    const r = calculateAll(p, catalogs);
    assert.equal(r.floor.maxByFloor, 0);
    assert.equal(r.capacity.slots.find((s) => s.kind === "FLOOR")?.value, 0);
    assert.ok(r.capacity.bottlenecks.includes("FLOOR"));
    assert.equal(r.capacity.safe, 0);
    assert.equal(r.capacity.verified, false);
  });
});

describe("FLOOR-SAFE-04 adequate floor is not bottleneck", () => {
  it("10 kPa net payload not limiting below requested", () => {
    const p = verifiedBase();
    const r = calculateAll(p, catalogs);
    assert.ok((r.floor.maxByFloor ?? 0) >= 24);
    assert.equal(r.floor.pass, true);
    assert.equal(r.floor.known, true);
    assert.ok(r.capacity.slots.some((s) => s.kind === "FLOOR" && s.known && (s.value ?? 0) >= 24));
    assert.equal(r.capacity.verified, true);
    // Compact INV-14 layout (placed === requested on one rack) makes FLOOR
    // share the RACK cap via maxAsicByFloorOnRack. That is not a floor-pressure
    // failure; do not require FLOOR to be absent from bottlenecks.
  });
});

describe("FLOOR-SAFE-05 reduce floor limit never increases maxByFloor", () => {
  it("monotonic", () => {
    const p = verifiedBase();
    const high = calculateAll(withKnownFloor(structuredClone(p), 20_000), catalogs).floor.maxByFloor ?? 0;
    const mid = calculateAll(withKnownFloor(structuredClone(p), 10_000), catalogs).floor.maxByFloor ?? 0;
    const low = calculateAll(withKnownFloor(structuredClone(p), 1), catalogs).floor.maxByFloor ?? 0;
    assert.ok(mid <= high);
    assert.ok(low <= mid);
  });
});

describe("FLOOR-SAFE-06 heavier ASIC never increases maxByFloor", () => {
  it("imported mass", () => {
    const light = imported(cloneAsic({ id: "w1", weightKg: 14.2 }));
    const heavy = imported(cloneAsic({ id: "w2", weightKg: 28.4 }));
    const a = calculateAll(light, catalogs).floor.maxByFloor ?? 0;
    const b = calculateAll(heavy, catalogs).floor.maxByFloor ?? 0;
    assert.ok(b <= a);
  });
});

describe("FLOOR-SAFE-07 placed racks use physically usable set", () => {
  it("matches placed usable", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    withKnownFloor(p);
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.electrical.known = true;
    p.electrical.availablePowerW = 150000;
    p.constraints.frontServiceClearanceM = 0;
    p.constraints.rearServiceClearanceM = 0;
    p.constraints.minAisleM = 0;
    p.racks = [rackAt(1, 1, "a"), rackAt(3.5, 1, "b")];
    const r = calculateAll(p, catalogs);
    const used = r.floor.racksUsed.filter((x) => !x.blocked);
    assert.ok(used.length >= 1);
    assert.equal(
      r.floor.maxByFloor,
      used.reduce((s, x) => s + x.maxAsic, 0),
    );
  });
});

describe("FLOOR-SAFE-08 empty room uses feasible packing", () => {
  it("candidate arrangement", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    withKnownFloor(p);
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.racks = [];
    const r = calculateAll(p, catalogs);
    assert.equal(r.floor.known, true);
    assert.ok(r.floor.reason.includes("feasible-space"));
    assert.ok((r.floor.maxByFloor ?? 0) >= 0);
    assert.ok(r.floor.racksUsed.length >= 1);
  });
});

describe("FLOOR-SAFE-09 blocked rack does not contribute", () => {
  it("collision", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    withKnownFloor(p);
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 1 };
    p.constraints.frontServiceClearanceM = 0;
    p.constraints.rearServiceClearanceM = 0;
    p.racks = [rackAt(2, 2, "a"), rackAt(2.2, 2, "b")];
    const r = calculateAll(p, catalogs);
    assert.ok(r.racks.collisions.length >= 1);
    assert.equal(r.floor.racksUsed.every((x) => x.blocked), true);
    assert.equal(r.floor.maxByFloor, 0);
  });
});

describe("FLOOR-SAFE-10 FLOOR bottleneck when smallest", () => {
  it("includes FLOOR", () => {
    const p = verifiedBase();
    withKnownFloor(p, 1);
    const r = calculateAll(p, catalogs);
    assert.ok(r.capacity.bottlenecks.includes("FLOOR"));
    assert.equal(r.capacity.safe, r.floor.maxByFloor);
  });
});

describe("FLOOR-SAFE-11 HUD not VERIFIED if floor model fails", () => {
  it("overload", () => {
    const p = verifiedBase();
    withKnownFloor(p, 1);
    const r = calculateAll(p, catalogs);
    assert.equal(r.floor.pass, false);
    assert.equal(r.capacity.verified, false);
    assert.notEqual(r.capacity.safety, "VERIFIED");
  });
});

describe("FLOOR-SAFE-12 unknown returns PRELIMINARY", () => {
  it("setFloorLoading true", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    assert.equal(live().result.capacity.verified, true);
    const res = live().setFloorLoading(true);
    assert.equal(res.ok, true);
    assert.equal(live().project.constraints.floorLoadingUnknown, true);
    assert.equal(live().result.capacity.safety, "PRELIMINARY");
    assert.equal(live().result.capacity.verified, false);
  });
});

describe("FLOOR model OPTION A footprint", () => {
  it("plan area width×depth, screening formula", () => {
    assert.equal(rackPlanFootprintM2(TEST_RACK_A), 1.6 * 0.6);
    const n = maxAsicByFloorOnRack(
      rackAt(0, 0),
      TEST_ASIC_A,
      STANDARD_NET_FLOOR_PAYLOAD_PA,
    );
    assert.ok(n > 0);
    assert.ok(n <= 24);
    const tiny = maxAsicByFloorOnRack(rackAt(0, 0), TEST_ASIC_A, 1);
    assert.equal(tiny, 0);
  });
});
