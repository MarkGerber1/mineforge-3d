import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ASIC_S21, ASIC_S21_PRO, ASIC_T21, ASIC_M60S, TEST_ASIC_A } from "../../equipment/asic-catalog.ts";
import {
  emptyRectangularProject,
  officialTestAsicA,
  TEST_RACK_A,
  undergroundParkingFarm,
  verifiedAcceptanceProject,
  withKnownFloor,
} from "../../project/factory.ts";
import { parseProject } from "../../project/schema.ts";
import { saveScheduler } from "../../project/save-scheduler.ts";
import { useProjectStore } from "../../project/store.ts";
import { defaultCatalogs } from "../catalogs.ts";
import { asicFrequencyRangeKnown, asicTopologyKnown, supplyFrequencyCompatible, validateAsicSpecRelations } from "../asic-spec.ts";
import { asicTrustDecision, grokImportedAsic } from "../asic-trust.ts";
import { validateCanonicalProjectDomains } from "../canonical.ts";
import { calculateElectrical, distributePhases } from "../electrical.ts";
import { placedAsicCount } from "../inventory.ts";
import { generateAutoLayout } from "../layout.ts";
import { calculateAll } from "../pipeline.ts";
import { applyPatchValidated } from "../upgrade.ts";
import type { AsicSpec, Project, Rack } from "../types.ts";

saveScheduler.setSave(async () => undefined);

const catalogs = defaultCatalogs();

function live() {
  return useProjectStore.getState();
}

function useImported(p: Project, asic: AsicSpec): Project {
  p.fleet = { ...p.fleet, asicId: asic.id, imported: asic };
  return p;
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

function assertFixtureFanPreliminary(r: ReturnType<typeof calculateAll>): void {
  assert.equal(r.fan.trust, "TEST_FIXTURE");
  assert.equal(r.fan.finalSafeEligible, false);
  assert.equal(r.capacity.verified, false);
  assert.equal(r.capacity.confidence, "PRELIMINARY");
  assert.equal(r.capacity.safety, "PRELIMINARY");
}

describe("catalog electrical identity R8-R10", () => {
  it("matrix", () => {
    assert.equal(ASIC_S21_PRO.inputPhases, 1);
    assert.equal(ASIC_S21_PRO.frequencyMinHz, 50);
    assert.equal(ASIC_S21_PRO.frequencyMaxHz, 60);
    assert.equal(ASIC_S21_PRO.source.trust, "OFFICIAL_VERIFIED");
    assert.equal(ASIC_S21.inputPhases, 1);
    assert.equal(ASIC_S21.frequencyMinHz, 47);
    assert.equal(ASIC_S21.frequencyMaxHz, 63);
    assert.equal(ASIC_T21.inputPhases, 3);
    assert.equal(ASIC_T21.frequencyMinHz, 50);
    assert.equal(ASIC_T21.frequencyMaxHz, 60);
    assert.equal(ASIC_M60S.frequencyMinHz, undefined);
    assert.equal(ASIC_M60S.frequencyMaxHz, undefined);
    assert.equal(ASIC_M60S.inputPhases, undefined);
    assert.equal(TEST_ASIC_A.source.trust, "TEST_FIXTURE");
    assert.equal(TEST_ASIC_A.inputPhases, 1);
    assert.equal(TEST_ASIC_A.frequencyMinHz, 50);
    for (const a of Object.values(catalogs.asics)) {
      assert.equal(validateAsicSpecRelations(a).ok, true, a.id);
    }
  });
});

describe("FREQ-01 ASIC 50-60 + 50 Hz", () => {
  it("compatible", () => {
    const p = verifiedAcceptanceProject();
    p.electrical.frequencyHz = 50;
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.supplyFrequencyCompatible, true);
    assert.equal(supplyFrequencyCompatible(officialTestAsicA(), 50), true);
    assert.equal(r.warnings.some((w) => w.id === "asic-frequency-mismatch"), false);
  });
});

describe("FREQ-02 60 Hz", () => {
  it("compatible", () => {
    const p = verifiedAcceptanceProject();
    p.electrical.frequencyHz = 60;
    assert.equal(calculateAll(p, catalogs).electrical.supplyFrequencyCompatible, true);
  });
});

describe("FREQ-03 49.99 Hz", () => {
  it("incompatible CRITICAL", () => {
    const p = verifiedAcceptanceProject();
    p.electrical.frequencyHz = 49.99;
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.supplyFrequencyCompatible, false);
    assert.ok(r.warnings.some((w) => w.id === "asic-frequency-mismatch" && w.severity === "CRITICAL"));
    assert.equal(r.capacity.verified, false);
    assert.equal(r.capacity.safety, "CRITICAL");
  });
});

describe("FREQ-04 60.01 Hz", () => {
  it("incompatible", () => {
    const p = verifiedAcceptanceProject();
    p.electrical.frequencyHz = 60.01;
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.supplyFrequencyCompatible, false);
    assert.equal(r.capacity.verified, false);
  });
});

describe("FREQ-05 1 Hz", () => {
  it("no positive VERIFIED electrical", () => {
    const p = verifiedAcceptanceProject();
    p.electrical.frequencyHz = 1;
    assert.equal(validateCanonicalProjectDomains(p, catalogs).ok, true);
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.maxByTypical, 0);
    assert.equal(r.electrical.maxByDesign, 0);
    assert.equal(r.capacity.verified, false);
  });
});

describe("FREQ-06 electrical known=false", () => {
  it("not fake CRITICAL", () => {
    const p = emptyRectangularProject();
    p.electrical.known = false;
    p.electrical.frequencyHz = 1;
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 0 };
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.supplyFrequencyCompatible, null);
    assert.equal(r.warnings.some((w) => w.id === "asic-frequency-mismatch"), false);
  });
});

describe("FREQ-07 ASIC frequency unknown", () => {
  it("PRELIMINARY", () => {
    const p = verifiedAcceptanceProject();
    const asic = officialTestAsicA({ frequencyMinHz: undefined, frequencyMaxHz: undefined });
    delete asic.frequencyMinHz;
    delete asic.frequencyMaxHz;
    useImported(p, asic);
    assert.equal(asicFrequencyRangeKnown(asic), false);
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.supplyFrequencyCompatible, null);
    assert.ok(r.warnings.some((w) => w.id === "asic-frequency-unknown"));
    assert.equal(r.capacity.confidence, "PRELIMINARY");
    assert.equal(r.capacity.verified, false);
  });
});

describe("FREQ-08 mismatch then restore", () => {
  it("CRITICAL disappears", () => {
    const p = verifiedAcceptanceProject();
    p.electrical.frequencyHz = 1;
    const bad = calculateAll(p, catalogs);
    assert.ok(bad.warnings.some((w) => w.id === "asic-frequency-mismatch"));
    p.electrical.frequencyHz = 50;
    const good = calculateAll(p, catalogs);
    assert.equal(good.warnings.some((w) => w.id === "asic-frequency-mismatch"), false);
    assertFixtureFanPreliminary(good);
  });
});

describe("FREQ-09 APPLY incompatible frequency stays canonical", () => {
  it("engineering fail-closed", () => {
    const p = verifiedAcceptanceProject();
    const patched = applyPatchValidated(p, { electrical: { frequencyHz: 1 } }, catalogs);
    assert.equal(patched.ok, true);
    const r = calculateAll(patched.project, catalogs);
    assert.equal(r.electrical.supplyFrequencyCompatible, false);
    assert.equal(r.capacity.verified, false);
  });
});

describe("FREQ-10 CRITICAL → SAFE", () => {
  it("mismatch cannot be VERIFIED", () => {
    const p = verifiedAcceptanceProject();
    p.electrical.frequencyHz = 1;
    const r = calculateAll(p, catalogs);
    assert.ok(r.warnings.some((w) => w.severity === "CRITICAL"));
    assert.notEqual(r.capacity.safety, "VERIFIED");
  });
});

describe("TRUST-01 OFFICIAL_VERIFIED eligible", () => {
  it("ok", () => {
    const p = verifiedAcceptanceProject();
    assert.equal(p.fleet.imported, undefined);
    assert.equal(catalogs.asics[p.fleet.asicId]?.source.trust, "OFFICIAL_VERIFIED");
    const r = calculateAll(p, catalogs);
    assert.equal(r.asicTrust.finalSafeEligible, true);
    assertFixtureFanPreliminary(r);
  });
});

describe("TRUST-02 VERIFIED_SECONDARY eligible", () => {
  it("ok", () => {
    const p = verifiedAcceptanceProject();
    p.fleet = { asicId: ASIC_M60S.id, requestedCount: p.fleet.requestedCount };
    const r = calculateAll(p, catalogs);
    assert.equal(r.asicTrust.finalSafeEligible, true);
    assert.equal(r.asicTrust.level, "VERIFIED_SECONDARY");
  });
});

describe("TRUST-03 USER_ENTERED not VERIFIED", () => {
  it("PRELIMINARY", () => {
    const p = verifiedAcceptanceProject();
    useImported(p, officialTestAsicA({ source: { label: "user", trust: "USER_ENTERED" } }));
    const r = calculateAll(p, catalogs);
    assert.equal(r.asicTrust.finalSafeEligible, false);
    assert.equal(r.capacity.verified, false);
    assert.equal(r.capacity.confidence, "PRELIMINARY");
  });
});

describe("TRUST-04 AI_FOUND_UNVERIFIED not VERIFIED", () => {
  it("PRELIMINARY", () => {
    const p = verifiedAcceptanceProject();
    useImported(p, officialTestAsicA({ source: { label: "ai", trust: "AI_FOUND_UNVERIFIED" } }));
    const r = calculateAll(p, catalogs);
    assert.equal(r.capacity.verified, false);
    assert.equal(r.capacity.confidence, "PRELIMINARY");
  });
});

describe("TRUST-05 ESTIMATED not VERIFIED", () => {
  it("PRELIMINARY", () => {
    const p = verifiedAcceptanceProject();
    useImported(p, officialTestAsicA({ source: { label: "est", trust: "ESTIMATED" } }));
    assert.equal(calculateAll(p, catalogs).capacity.verified, false);
  });
});

describe("TRUST-06 TEST_FIXTURE not final-safe", () => {
  it("production semantics", () => {
    assert.equal(asicTrustDecision(TEST_ASIC_A).finalSafeEligible, false);
    const p = verifiedAcceptanceProject();
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: p.fleet.requestedCount };
    const r = calculateAll(p, catalogs);
    assert.equal(r.asicTrust.level, "TEST_FIXTURE");
    assert.equal(r.capacity.verified, false);
    assert.equal(r.capacity.confidence, "PRELIMINARY");
  });
});

describe("TRUST-07 same numbers different trust", () => {
  it("diagnostics equal, confidence differs", () => {
    const a = verifiedAcceptanceProject();
    const b = verifiedAcceptanceProject();
    useImported(b, officialTestAsicA({ source: { label: "ai", trust: "AI_FOUND_UNVERIFIED" } }));
    const ra = calculateAll(a, catalogs);
    const rb = calculateAll(b, catalogs);
    assert.equal(ra.electrical.typicalTotalW, rb.electrical.typicalTotalW);
    assert.equal(ra.thermal.totalHeatW, rb.thermal.totalHeatW);
    assert.equal(ra.asicTrust.finalSafeEligible, true);
    assert.equal(rb.asicTrust.finalSafeEligible, false);
    assert.equal(ra.capacity.verified, false);
    assert.equal(rb.capacity.verified, false);
    assert.equal(rb.capacity.confidence, "PRELIMINARY");
    assertFixtureFanPreliminary(ra);
  });
});

describe("TRUST-08 AI_FOUND_UNVERIFIED never verified=true", () => {
  it("invariant", () => {
    const p = verifiedAcceptanceProject();
    useImported(p, officialTestAsicA({ source: { label: "ai", trust: "AI_FOUND_UNVERIFIED" } }));
    assert.equal(calculateAll(p, catalogs).capacity.verified, false);
  });
});

describe("TRUST-09 unverified → official restores", () => {
  it("deterministic", () => {
    const p = verifiedAcceptanceProject();
    useImported(p, officialTestAsicA({ source: { label: "ai", trust: "AI_FOUND_UNVERIFIED" } }));
    assert.equal(calculateAll(p, catalogs).capacity.verified, false);
    p.fleet = { asicId: ASIC_S21_PRO.id, requestedCount: p.fleet.requestedCount };
    const restored = calculateAll(p, catalogs);
    assert.equal(restored.asicTrust.finalSafeEligible, true);
    assertFixtureFanPreliminary(restored);
  });
});

describe("TRUST-10 Grok cannot mint OFFICIAL_VERIFIED", () => {
  it("downgrades", () => {
    const hostile = officialTestAsicA({ source: { label: "spoof", trust: "OFFICIAL_VERIFIED" } });
    const sanitized = grokImportedAsic(hostile);
    assert.equal(sanitized.source.trust, "AI_FOUND_UNVERIFIED");
    const p = verifiedAcceptanceProject();
    live().loadProject(p, false);
    live().propose({
      id: "spoof-asic",
      summary: "official spoof",
      detail: "",
      patch: { fleet: { asicId: hostile.id, imported: hostile } },
      fromGrok: true,
    });
    assert.equal(live().applyProposed().ok, true);
    assert.equal(live().project.fleet.imported?.source.trust, "AI_FOUND_UNVERIFIED");
    assert.equal(live().result.capacity.verified, false);
  });
});

describe("PHASE-01 single-phase 1 unit", () => {
  it("one facility phase", () => {
    const p = verifiedAcceptanceProject(1);
    const r = calculateElectrical(p, officialTestAsicA());
    assert.equal(r.phaseModel, "SINGLE_PHASE_DISTRIBUTED");
    assert.equal(r.l1Count + r.l2Count + r.l3Count, 1);
    assert.equal([r.l1Count, r.l2Count, r.l3Count].filter((c) => c > 0).length, 1);
  });
});

describe("PHASE-02 single-phase 3 units", () => {
  it("1/1/1", () => {
    const p = verifiedAcceptanceProject(3);
    const r = calculateElectrical(p, officialTestAsicA());
    assert.deepEqual({ l1: r.l1Count, l2: r.l2Count, l3: r.l3Count }, distributePhases(3));
    assert.equal(r.l1Count, 1);
    assert.equal(r.l2Count, 1);
    assert.equal(r.l3Count, 1);
  });
});

describe("PHASE-03 single-phase 4 units", () => {
  it("2/1/1", () => {
    const p = verifiedAcceptanceProject(4);
    const r = calculateElectrical(p, officialTestAsicA());
    const counts = [r.l1Count, r.l2Count, r.l3Count].sort((a, b) => b - a);
    assert.deepEqual(counts, [2, 1, 1]);
  });
});

describe("PHASE-04 three-phase 1 unit", () => {
  it("all lines equal", () => {
    const p = verifiedAcceptanceProject(1);
    const r = calculateElectrical(p, ASIC_T21);
    assert.equal(r.phaseModel, "THREE_PHASE_BALANCED");
    assert.equal(r.l1Count, 1);
    assert.equal(r.l2Count, 1);
    assert.equal(r.l3Count, 1);
    assert.equal(r.l1CurrentA, r.l2CurrentA);
    assert.equal(r.l2CurrentA, r.l3CurrentA);
    assert.equal(r.imbalanceAsic, 0);
  });
});

describe("PHASE-05 three-phase multiple units", () => {
  it("no fake per-unit assignment", () => {
    const p = verifiedAcceptanceProject(4);
    const r = calculateElectrical(p, ASIC_T21);
    assert.equal(r.l1Count, 4);
    assert.equal(r.l2Count, 4);
    assert.equal(r.l3Count, 4);
    assert.notDeepEqual([r.l1Count, r.l2Count, r.l3Count].sort((a, b) => b - a), [2, 1, 1]);
    assert.equal(r.imbalanceAsic, 0);
  });
});

describe("PHASE-06 T21 inputPhases=3", () => {
  it("catalog", () => {
    assert.equal(ASIC_T21.inputPhases, 3);
    assert.equal(asicTopologyKnown(ASIC_T21), true);
  });
});

describe("PHASE-07 S21 Pro inputPhases=1", () => {
  it("catalog", () => {
    assert.equal(ASIC_S21_PRO.inputPhases, 1);
  });
});

describe("PHASE-08 three-phase does not use distributePhases", () => {
  it("T21 4 ≠ 2/1/1", () => {
    const dist = distributePhases(4);
    const p = verifiedAcceptanceProject(4);
    const r = calculateElectrical(p, ASIC_T21);
    assert.notEqual(r.l1Count, dist.l1);
    assert.equal(r.phaseModel, "THREE_PHASE_BALANCED");
  });
});

describe("PHASE-09 unknown topology", () => {
  it("no fabricated currents, not VERIFIED", () => {
    const p = verifiedAcceptanceProject();
    const asic = officialTestAsicA({ inputPhases: undefined });
    delete asic.inputPhases;
    useImported(p, asic);
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.phaseModel, "UNKNOWN");
    assert.equal(r.electrical.l1Count, 0);
    assert.equal(r.electrical.l2Count, 0);
    assert.equal(r.electrical.l3Count, 0);
    assert.ok(r.warnings.some((w) => w.id === "asic-topology-unknown"));
    assert.equal(r.capacity.verified, false);
  });
});

describe("PHASE-10 voltage semantics 1p vs 3p", () => {
  it("230 vs 400", () => {
    const p = verifiedAcceptanceProject();
    p.electrical.voltageV = 230;
    p.fleet = { asicId: ASIC_S21_PRO.id, requestedCount: 24 };
    assert.equal(calculateAll(p, catalogs).electrical.supplyVoltageCompatible, true);
    p.fleet = { asicId: ASIC_T21.id, requestedCount: 24 };
    assert.equal(calculateAll(p, catalogs).electrical.supplyVoltageCompatible, false);
    p.electrical.voltageV = 400;
    assert.equal(calculateAll(p, catalogs).electrical.supplyVoltageCompatible, true);
  });
});

describe("PHASE-11 manufacturer currentA provenance", () => {
  it("nameplate preserved", () => {
    const p = verifiedAcceptanceProject();
    const r = calculateElectrical(p, ASIC_S21_PRO);
    assert.equal(r.nameplateCurrentA, 20);
    assert.equal(r.currentProvenance, "MANUFACTURER_NAMEPLATE");
    assert.equal(r.typicalCurrentA, 20);
    assert.ok(Math.abs(r.calculatedLineCurrentA - ASIC_S21_PRO.typicalPowerW / 230) < 1e-9);
    const t = calculateElectrical(p, ASIC_T21);
    assert.equal(t.nameplateCurrentA, 12);
    assert.equal(t.currentProvenance, "MANUFACTURER_NAMEPLATE");
  });
});

describe("PHASE-12 topology does not change real-power arithmetic", () => {
  it("same P × N", () => {
    const p = verifiedAcceptanceProject(4);
    const one = officialTestAsicA({ inputPhases: 1 });
    const three = officialTestAsicA({ inputPhases: 3, currentA: undefined });
    const a = calculateElectrical(p, one);
    const b = calculateElectrical(p, three);
    assert.equal(a.typicalTotalW, b.typicalTotalW);
    assert.equal(a.designTotalW, b.designTotalW);
    assert.equal(a.hashrateThs, b.hashrateThs);
  });
});

describe("INV-01 requested=30 placed=30", () => {
  it("valid", () => {
    const p = undergroundParkingFarm();
    assert.equal(p.fleet.requestedCount, 30);
    assert.equal(placedAsicCount(p), 30);
    assert.equal(validateCanonicalProjectDomains(p, catalogs).ok, true);
  });
});

describe("INV-02 requested=30 placed=24", () => {
  it("partial valid", () => {
    const p = verifiedAcceptanceProject(30);
    p.racks = generateAutoLayout({ ...p, fleet: { ...p.fleet, requestedCount: 24 } }, officialTestAsicA());
    p.fleet.requestedCount = 30;
    assert.ok(placedAsicCount(p) <= 30);
    assert.equal(validateCanonicalProjectDomains(p, catalogs).ok, true);
  });
});

describe("INV-03 requested=24 placed=30 reject", () => {
  it("canonical", () => {
    const p = undergroundParkingFarm();
    p.fleet.requestedCount = 24;
    assert.ok(placedAsicCount(p) > 24);
    assert.equal(validateCanonicalProjectDomains(p, catalogs).ok, false);
    assert.throws(() => parseProject(JSON.parse(JSON.stringify(p))));
  });
});

describe("INV-04 setFleet 30→24 while placed=30", () => {
  it("REJECT unchanged", () => {
    const p = undergroundParkingFarm();
    live().loadProject(p, false);
    const before = live().project.fleet.requestedCount;
    const res = live().setFleet(p.fleet.asicId, 24);
    assert.equal(res.ok, false);
    assert.ok(res.reason?.includes("30"));
    assert.equal(live().project.fleet.requestedCount, before);
  });
});

describe("INV-05 increase rack ASIC past requested", () => {
  it("REJECT", () => {
    const p = verifiedAcceptanceProject(1);
    p.racks = [rackAt(1, 1, "a", { asicCount: 1 })];
    live().loadProject(p, false);
    const res = live().setRackAsicCount("a", 2);
    assert.equal(res.ok, false);
    assert.equal(live().project.racks[0].asicCount, 1);
  });
});

describe("INV-06 import/load placed>requested", () => {
  it("REJECT", () => {
    const p = undergroundParkingFarm();
    p.fleet.requestedCount = 24;
    live().loadProject(verifiedAcceptanceProject(), false);
    assert.equal(live().loadProject(p, false).ok, false);
  });
});

describe("INV-07 APPLY placed>requested", () => {
  it("REJECT", () => {
    const p = verifiedAcceptanceProject(1);
    p.racks = [rackAt(1, 1, "a", { asicCount: 1 })];
    const res = applyPatchValidated(p, { racks: [rackAt(1, 1, "a", { asicCount: 5 })] }, catalogs);
    assert.equal(res.ok, false);
  });
});

describe("INV-08 Grok proposal placed>requested", () => {
  it("cannot enter canonical", () => {
    const p = verifiedAcceptanceProject(1);
    p.racks = [rackAt(1, 1, "a", { asicCount: 1 })];
    live().loadProject(p, false);
    live().propose({
      id: "over-place",
      summary: "too many",
      detail: "",
      patch: { racks: [rackAt(1, 1, "a", { asicCount: 8 })] },
      fromGrok: true,
    });
    assert.equal(live().applyProposed().ok, false);
    assert.equal(live().project.racks[0].asicCount, 1);
  });
});

describe("INV-09 Auto Layout target=30", () => {
  it("placed exactly 30", () => {
    const p = undergroundParkingFarm();
    assert.equal(placedAsicCount(p), 30);
    live().loadProject(p, false);
    assert.equal(live().autoLayout().ok, true);
    assert.equal(placedAsicCount(live().project), 30);
  });
});

describe("INV-10 Auto Layout target=0", () => {
  it("placed 0", () => {
    const p = verifiedAcceptanceProject(0);
    assert.equal(p.fleet.requestedCount, 0);
    assert.equal(placedAsicCount(p), 0);
    live().loadProject(p, false);
    assert.equal(live().autoLayout().ok, true);
    assert.equal(live().project.racks.length, 0);
  });
});

describe("INV-11 malformed direct calculateAll", () => {
  it("demand 30 not 24", () => {
    const p = undergroundParkingFarm();
    p.fleet.requestedCount = 24;
    assert.equal(placedAsicCount(p), 30);
    const r = calculateAll(p, catalogs);
    assert.equal(r.inventory.engineeringDemandCount, 30);
    assert.equal(r.electrical.typicalTotalW, 30 * ASIC_S21_PRO.typicalPowerW);
    assert.equal(r.electrical.demandCount, 30);
  });
});

describe("INV-12 raising placed never reduces demand", () => {
  it("24 → 30", () => {
    const low = undergroundParkingFarm();
    low.fleet.requestedCount = 24;
    for (const r of low.racks) r.asicCount = 0;
    low.racks[0] && (low.racks[0].asicCount = 24);
    const high = structuredClone(low);
    high.racks[0].asicCount = 30;
    const a = calculateAll(low, catalogs);
    const b = calculateAll(high, catalogs);
    assert.ok(b.electrical.typicalTotalW >= a.electrical.typicalTotalW);
    assert.ok(b.thermal.totalHeatW >= a.thermal.totalHeatW);
    assert.equal(a.inventory.engineeringDemandCount, 24);
    assert.equal(b.inventory.engineeringDemandCount, 30);
  });
});

describe("INV-13 blocked rack still counts as placed", () => {
  it("collision", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    withKnownFloor(p);
    p.fleet = { asicId: officialTestAsicA().id, requestedCount: 8, imported: officialTestAsicA() };
    p.racks = [rackAt(2, 2, "a", { asicCount: 4 }), rackAt(2.2, 2, "b", { asicCount: 4 })];
    const r = calculateAll(p, catalogs);
    assert.ok(r.racks.collisions.length >= 1);
    assert.equal(r.inventory.placedAsicCount, 8);
    assert.equal(r.inventory.engineeringDemandCount, 8);
    assert.equal(r.electrical.typicalTotalW, 8 * TEST_ASIC_A.typicalPowerW);
  });
});

describe("INV-14 verified fixtures have placed ≤ requested", () => {
  it("verifiedAcceptanceProject", () => {
    const p = verifiedAcceptanceProject();
    assert.ok(placedAsicCount(p) <= p.fleet.requestedCount);
    assert.equal(validateCanonicalProjectDomains(p, catalogs).ok, true);
    const r = calculateAll(p, catalogs);
    assert.equal(r.capacity.safe, 24);
    assertFixtureFanPreliminary(r);
  });
});

describe("ADV-ELEC-01 official 1-phase compatible while fan keeps global PRELIMINARY", () => {
  it("subject to other constraints", () => {
    const r = calculateAll(verifiedAcceptanceProject(), catalogs);
    assert.equal(r.asicTrust.finalSafeEligible, true);
    assert.equal(r.electrical.supplyVoltageCompatible, true);
    assert.equal(r.electrical.supplyFrequencyCompatible, true);
    assert.equal(r.electrical.phaseModel, "SINGLE_PHASE_DISTRIBUTED");
    assertFixtureFanPreliminary(r);
  });
});

describe("ADV-ELEC-02 frequency 1 Hz", () => {
  it("not VERIFIED", () => {
    const p = verifiedAcceptanceProject();
    p.electrical.frequencyHz = 1;
    assert.equal(calculateAll(p, catalogs).capacity.verified, false);
  });
});

describe("ADV-ELEC-03 same numeric trust split", () => {
  it("diagnostics vs confidence", () => {
    const a = verifiedAcceptanceProject();
    const b = verifiedAcceptanceProject();
    useImported(b, officialTestAsicA({ source: { label: "ai", trust: "AI_FOUND_UNVERIFIED" } }));
    const ra = calculateAll(a, catalogs);
    const rb = calculateAll(b, catalogs);
    assert.equal(ra.electrical.typicalTotalW, rb.electrical.typicalTotalW);
    assert.equal(ra.asicTrust.finalSafeEligible, true);
    assert.equal(rb.asicTrust.finalSafeEligible, false);
    assert.equal(ra.capacity.verified, false);
    assert.equal(rb.capacity.verified, false);
  });
});

describe("ADV-ELEC-04 T21 not 1-phase distribute", () => {
  it("balanced", () => {
    const r = calculateElectrical(verifiedAcceptanceProject(5), ASIC_T21);
    assert.equal(r.phaseModel, "THREE_PHASE_BALANCED");
    assert.equal(r.l1Count, r.l2Count);
    assert.equal(r.l2Count, r.l3Count);
  });
});

describe("ADV-ELEC-05 malformed placed 30 requested 24", () => {
  it("never optimistic 24", () => {
    const p = undergroundParkingFarm();
    p.fleet.requestedCount = 24;
    const r = calculateAll(p, catalogs);
    assert.ok(r.electrical.typicalTotalW >= 30 * ASIC_S21_PRO.typicalPowerW - 1e-9);
    assert.equal(r.inventory.engineeringDemandCount, 30);
  });
});

describe("ADV-ELEC-06 unverified + compatible still PRELIMINARY", () => {
  it("provenance wins", () => {
    const p = verifiedAcceptanceProject();
    useImported(p, officialTestAsicA({ source: { label: "ai", trust: "AI_FOUND_UNVERIFIED" } }));
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.supplyVoltageCompatible, true);
    assert.equal(r.electrical.supplyFrequencyCompatible, true);
    assert.equal(r.capacity.confidence, "PRELIMINARY");
    assert.equal(r.capacity.verified, false);
  });
});

describe("ADV-ELEC-07 official + frequency unknown", () => {
  it("not VERIFIED", () => {
    const p = verifiedAcceptanceProject();
    const asic = officialTestAsicA();
    delete asic.frequencyMinHz;
    delete asic.frequencyMaxHz;
    useImported(p, asic);
    assert.equal(calculateAll(p, catalogs).capacity.verified, false);
  });
});

describe("ADV-ELEC-08 official + topology unknown", () => {
  it("not VERIFIED", () => {
    const p = verifiedAcceptanceProject();
    const asic = officialTestAsicA();
    delete asic.inputPhases;
    useImported(p, asic);
    assert.equal(calculateAll(p, catalogs).capacity.verified, false);
  });
});

describe("M60S unknown frequency/topology cannot VERIFIED", () => {
  it("source gap", () => {
    assert.equal(asicFrequencyRangeKnown(ASIC_M60S), false);
    assert.equal(asicTopologyKnown(ASIC_M60S), false);
    const p = verifiedAcceptanceProject();
    p.fleet = { asicId: ASIC_M60S.id, requestedCount: 24 };
    const r = calculateAll(p, catalogs);
    assert.equal(r.capacity.verified, false);
  });
});
