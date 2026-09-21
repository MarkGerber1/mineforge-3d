import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ASIC_S21_PRO, TEST_ASIC_A } from "../../equipment/asic-catalog.ts";
import { emptyRectangularProject, officialTestAsicA, TEST_RACK_A, verifiedAcceptanceProject } from "../../project/factory.ts";
import { defaultCatalogs } from "../catalogs.ts";
import { calculateAll } from "../pipeline.ts";
import { analyzeRacks, frontServiceAabb, rackAsicCapacity } from "../racks.ts";
import type { AsBuiltObject, AsicSpec, Project, Rack } from "../types.ts";

const catalogs = defaultCatalogs();

function assertFixtureFanPreliminary(r: ReturnType<typeof calculateAll>): void {
  assert.equal(r.fan.trust, "TEST_FIXTURE");
  assert.equal(r.fan.finalSafeEligible, false);
  assert.equal(r.capacity.verified, false);
  assert.equal(r.capacity.confidence, "PRELIMINARY");
  assert.equal(r.capacity.safety, "PRELIMINARY");
}

function rackAt(x: number, y: number, id = "r1"): Rack {
  return {
    id,
    name: id,
    ...TEST_RACK_A,
    x,
    y,
    rotationDeg: 0,
    asicCount: 0,
    airflowToward: "south",
  };
}

function column(id: string, x: number, y: number): AsBuiltObject {
  return {
    id,
    kind: "column",
    name: id,
    x,
    y,
    z: 0,
    widthM: 0.1,
    depthM: 0.1,
    heightM: 2,
    provenance: "USER_CONFIRMED",
    confidence: "HIGH",
  };
}

function useImported(p: Project, asic: AsicSpec): Project {
  p.fleet = { ...p.fleet, asicId: asic.id, imported: asic };
  return p;
}

describe("QX-FAN-TRUST migration contract", () => {
  it("QX-FAN-TRUST-01 synthetic FAN_STRONG preserves numeric SAFE but not global VERIFIED", () => {
    const r = calculateAll(verifiedAcceptanceProject(), catalogs);
    assert.equal(r.capacity.safe, 24);
    assertFixtureFanPreliminary(r);
    assert.deepEqual(r.warnings.filter((w) => w.severity === "BLOCKER" || w.severity === "CRITICAL"), []);
  });

  it("QX-FAN-TRUST-02 TEST_FIXTURE fan is never final-safe", () => {
    const r = calculateAll(verifiedAcceptanceProject(), catalogs);
    assert.equal(r.fan.trust, "TEST_FIXTURE");
    assert.equal(r.fan.finalSafeEligible, false);
  });

  it("QX-FAN-TRUST-03 service envelope still blocks a 1 mm intrusion", () => {
    const rack = rackAt(3, 2, "qx-fan-rack");
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.racks = [rack];
    p.constraints.frontServiceClearanceM = 0.8;
    p.constraints.rearServiceClearanceM = 0.6;
    p.constraints.minAisleM = 0;

    const clean = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(clean.usableCapacity, rackAsicCapacity(rack, TEST_ASIC_A));

    const front = frontServiceAabb(rack, p.constraints.frontServiceClearanceM)!;
    p.reality = {
      photos: [],
      videos: [],
      findings: [],
      compareMode: "as-built",
      interview: [],
      asBuilt: [column("qx-fan-1mm", (front.x1 + front.x2) / 2 - 0.05, front.y2 - 0.001)],
    };

    const blocked = analyzeRacks(p, TEST_ASIC_A);
    assert.ok(blocked.clearanceHits.some((h) => h.reason.includes("front service")));
    assert.equal(blocked.usableCapacity, 0);
  });

  it("QX-FAN-TRUST-04 exact trusted ASIC match does not override untrusted fan provenance", () => {
    const p = verifiedAcceptanceProject();
    const clone: AsicSpec = {
      ...ASIC_S21_PRO,
      source: { label: "owner copy", trust: "USER_ENTERED" },
    };
    useImported(p, clone);
    const r = calculateAll(p, catalogs);
    assert.equal(r.asicTrust.level, "OFFICIAL_VERIFIED");
    assert.equal(r.asicTrust.finalSafeEligible, true);
    assertFixtureFanPreliminary(r);
  });

  it("QX-FAN-TRUST-05 forged imported ASIC cannot self-authorize", () => {
    const p = verifiedAcceptanceProject();
    useImported(p, {
      ...TEST_ASIC_A,
      id: "qx-fan-forged",
      manufacturer: "FORGED CO",
      model: "QX-FAN-FORGED",
      source: { label: "forged", trust: "OFFICIAL_VERIFIED" },
    });
    const r = calculateAll(p, catalogs);
    assert.equal(r.asicTrust.finalSafeEligible, false);
    assert.equal(r.fan.finalSafeEligible, false);
    assert.equal(r.capacity.verified, false);
  });

  it("QX-FAN-TRUST-06 persisted JSON round-trip upgrades neither ASIC nor fan trust", () => {
    const p = verifiedAcceptanceProject();
    useImported(p, officialTestAsicA({ source: { label: "owner", trust: "USER_ENTERED" } }));
    const round = JSON.parse(JSON.stringify(p)) as Project;
    assert.equal(round.fleet.imported?.source.trust, "USER_ENTERED");
    const r = calculateAll(round, catalogs);
    assert.equal(r.asicTrust.finalSafeEligible, false);
    assert.equal(r.fan.trust, "TEST_FIXTURE");
    assert.equal(r.fan.finalSafeEligible, false);
    assert.equal(r.capacity.verified, false);
  });
});
