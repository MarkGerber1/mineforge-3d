import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TEST_ASIC_A } from "../../equipment/asic-catalog.ts";
import { FAN_WEAK } from "../../equipment/fan-catalog.ts";
import { TEST_RACK_A, emptyRectangularProject, undergroundParkingFarm, withKnownFloor, verifiedAcceptanceProject } from "../../project/factory.ts";
import { parseProject } from "../../project/schema.ts";
import { saveScheduler } from "../../project/save-scheduler.ts";
import { useProjectStore } from "../../project/store.ts";
import { defaultCatalogs } from "../catalogs.ts";
import { validateCanonicalProjectDomains } from "../canonical.ts";
import { theoreticalSpaceCapacity } from "../capacity.ts";
import { MAX_AVAILABLE_POWER_W } from "../constants.ts";
import { calculateAll } from "../pipeline.ts";
import { analyzeRacks, facingAisleGapM, rackAsicCapacity } from "../racks.ts";
import { feasibleSpacePacking } from "../space-pack.ts";
import { applyPatchValidated, generateUpgradeOptions } from "../upgrade.ts";
import type { Project, Rack } from "../types.ts";

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

function perRack(): number {
  return rackAsicCapacity(
    { id: "t", name: "t", ...TEST_RACK_A, x: 0, y: 0, rotationDeg: 0, asicCount: 0, airflowToward: "south" },
    TEST_ASIC_A,
  );
}

describe("CANON-01 9 MW +25% proposal stays ≤ 10 MW", () => {
  it("caps or omits invalid electrical upgrade", () => {
    const p = verifiedBase();
    p.electrical.availablePowerW = 9_000_000;
    p.electrical.known = true;
    const opts = generateUpgradeOptions(p, catalogs);
    const more = opts.find((o) => o.id === "more-power");
    if (more) {
      assert.ok((more.patch.electrical?.availablePowerW ?? 0) <= MAX_AVAILABLE_POWER_W);
      assert.ok((more.patch.electrical?.availablePowerW ?? 0) >= 9_000_000);
    }
    const atMax = { ...p, electrical: { ...p.electrical, availablePowerW: MAX_AVAILABLE_POWER_W } };
    const none = generateUpgradeOptions(atMax, catalogs).find((o) => o.id === "more-power");
    assert.equal(none, undefined);
  });
});

describe("CANON-02 applyPatchValidated electrical 11.25 MW", () => {
  it("REJECT", () => {
    const p = verifiedBase();
    p.electrical.availablePowerW = 9_000_000;
    const res = applyPatchValidated(p, { electrical: { availablePowerW: 11_250_000 } }, catalogs);
    assert.equal(res.ok, false);
    assert.equal(res.project.electrical.availablePowerW, 9_000_000);
  });
});

describe("CANON-03 applyProposed invalid electrical", () => {
  it("canonical unchanged", () => {
    const p = verifiedBase();
    p.electrical.availablePowerW = 9_000_000;
    live().loadProject(p, false);
    live().propose({
      id: "bad-power",
      summary: "11.25 MW",
      detail: "invalid",
      patch: { electrical: { availablePowerW: 11_250_000 } },
      fromGrok: true,
    });
    const applied = live().applyProposed();
    assert.equal(applied.ok, false);
    assert.equal(live().project.electrical.availablePowerW, 9_000_000);
  });
});

describe("CANON-04 room.heightM = 0.2 through patch", () => {
  it("REJECT", () => {
    const p = verifiedBase();
    const res = applyPatchValidated(p, { room: { heightM: 0.2 } }, catalogs);
    assert.equal(res.ok, false);
    assert.equal(res.project.room.heightM, p.room.heightM);
  });
});

describe("CANON-05 room.heightM = 51 through patch", () => {
  it("REJECT", () => {
    const p = verifiedBase();
    const res = applyPatchValidated(p, { room: { heightM: 51 } }, catalogs);
    assert.equal(res.ok, false);
  });
});

describe("CANON-06 rack asicCount = -1 through patch", () => {
  it("REJECT", () => {
    const p = verifiedBase();
    const racks = p.racks.map((r, i) => (i === 0 ? { ...r, asicCount: -1 } : r));
    const res = applyPatchValidated(p, { racks }, catalogs);
    assert.equal(res.ok, false);
  });
});

describe("CANON-07 rack asicCount = 3.7 through patch", () => {
  it("REJECT", () => {
    const p = verifiedBase();
    const racks = p.racks.map((r, i) => (i === 0 ? { ...r, asicCount: 3.7 } : r));
    const res = applyPatchValidated(p, { racks }, catalogs);
    assert.equal(res.ok, false);
  });
});

describe("CANON-08 asicCount > per-rack through patch", () => {
  it("REJECT when ASIC resolvable", () => {
    const p = verifiedBase();
    const cap = perRack();
    const racks = p.racks.map((r, i) => (i === 0 ? { ...r, asicCount: cap + 1 } : r));
    const res = applyPatchValidated(p, { racks }, catalogs);
    assert.equal(res.ok, false);
  });
});

describe("CANON-09 requestedCount = -1", () => {
  it("REJECT", () => {
    const p = verifiedBase();
    const res = applyPatchValidated(p, { fleet: { requestedCount: -1 } }, catalogs);
    assert.equal(res.ok, false);
  });
});

describe("CANON-10 requestedCount = 3.7", () => {
  it("REJECT", () => {
    const p = verifiedBase();
    const res = applyPatchValidated(p, { fleet: { requestedCount: 3.7 } }, catalogs);
    assert.equal(res.ok, false);
  });
});

describe("CANON-11 persisted over-max power does not enter canonical", () => {
  it("parse + loadProject reject", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const before = live().project.electrical.availablePowerW;
    const hostile = structuredClone(p) as Project;
    hostile.electrical.availablePowerW = MAX_AVAILABLE_POWER_W + 1;
    hostile.electrical.known = true;
    assert.throws(() => parseProject(JSON.parse(JSON.stringify(hostile))));
    const loaded = live().loadProject(hostile, false);
    assert.equal(loaded.ok, false);
    assert.equal(live().project.electrical.availablePowerW, before);
  });
});

describe("CANON-12 persisted invalid height does not enter canonical", () => {
  it("reject", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const h = live().project.room.heightM;
    const hostile = structuredClone(p) as Project;
    hostile.room.heightM = 0.2;
    assert.throws(() => parseProject(JSON.parse(JSON.stringify(hostile))));
    assert.equal(live().loadProject(hostile, false).ok, false);
    assert.equal(live().project.room.heightM, h);
  });
});

describe("CANON-13 persisted fractional/negative asicCount does not enter canonical", () => {
  it("reject", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const hostile = structuredClone(p) as Project;
    if (!hostile.racks[0]) hostile.racks = [rackAt(2, 2, "r")];
    hostile.racks[0] = { ...hostile.racks[0], asicCount: 3.7 };
    assert.throws(() => parseProject(JSON.parse(JSON.stringify(hostile))));
    const neg = structuredClone(p) as Project;
    if (!neg.racks[0]) neg.racks = [rackAt(2, 2, "r")];
    neg.racks[0] = { ...neg.racks[0], asicCount: -1 };
    assert.throws(() => parseProject(JSON.parse(JSON.stringify(neg))));
  });
});

describe("CANON-14 valid current Project still loads", () => {
  it("ok", () => {
    const p = verifiedBase();
    const parsed = parseProject(JSON.parse(JSON.stringify(p)));
    assert.equal(parsed.room.heightM, p.room.heightM);
    assert.equal(live().loadProject(parsed, false).ok, true);
    assert.equal(validateCanonicalProjectDomains(live().project, catalogs).ok, true);
  });
});

describe("CANON-15 unknown electrical still loads, not VERIFIED", () => {
  it("known=false + 0 W", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    assert.equal(p.electrical.known, false);
    assert.equal(p.electrical.availablePowerW, 0);
    const parsed = parseProject(JSON.parse(JSON.stringify(p)));
    assert.equal(parsed.electrical.known, false);
    assert.equal(live().loadProject(parsed, false).ok, true);
    assert.equal(live().project.electrical.known, false);
    assert.notEqual(live().result.capacity.safety, "VERIFIED");
    assert.equal(live().result.capacity.verified, false);
  });
});

describe("CANON-16 failed canonical validation does not save", () => {
  it("last scheduled project remains valid", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const lastAfterValid = saveScheduler.last();
    const hostile = structuredClone(p) as Project;
    hostile.electrical.availablePowerW = 11_250_000;
    hostile.electrical.known = true;
    assert.equal(live().loadProject(hostile, false).ok, false);
    const last = saveScheduler.last();
    assert.ok(last);
    assert.equal(last.electrical.availablePowerW, lastAfterValid?.electrical.availablePowerW);
    assert.ok(last.electrical.availablePowerW <= MAX_AVAILABLE_POWER_W);
  });
});

describe("SPACE-R-01 1.6×0.6 with service cannot host a rack", () => {
  it("feasible 0", () => {
    const p = emptyRectangularProject({ widthM: 1.6, depthM: 0.6, heightM: 2.8 });
    p.constraints.frontServiceClearanceM = 0.8;
    p.constraints.rearServiceClearanceM = 0.6;
    p.constraints.minAisleM = 1.0;
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    const pack = feasibleSpacePacking(p, TEST_ASIC_A);
    assert.equal(pack.rackCount, 0);
    assert.equal(pack.asicCount, 0);
    const r = calculateAll(p, catalogs);
    assert.equal(r.capacity.slots.find((s) => s.kind === "SPACE")?.value, 0);
  });
});

describe("SPACE-R-02 exact service envelope fits one rack", () => {
  it("front + depth + rear", () => {
    const p = emptyRectangularProject({ widthM: 1.6, depthM: 2.0, heightM: 2.8 });
    p.constraints.frontServiceClearanceM = 0.8;
    p.constraints.rearServiceClearanceM = 0.6;
    p.constraints.minAisleM = 1.0;
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    const pack = feasibleSpacePacking(p, TEST_ASIC_A);
    assert.equal(pack.rackCount, 1);
    assert.equal(pack.asicCount, perRack());
  });
});

describe("SPACE-R-03 0° impossible, 90° service-valid", () => {
  it("rotated arrangement may count", () => {
    const p = emptyRectangularProject({ widthM: 0.7, depthM: 10, heightM: 2.8 });
    p.constraints.frontServiceClearanceM = 0.8;
    p.constraints.rearServiceClearanceM = 0.6;
    p.constraints.minAisleM = 1.0;
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    const pack = feasibleSpacePacking(p, TEST_ASIC_A);
    assert.ok(pack.asicCount > 0);
    assert.equal(pack.orientationDeg, 90);
  });
});

describe("SPACE-R-04 large normal room", () => {
  it("positive", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    const pack = feasibleSpacePacking(p, TEST_ASIC_A);
    assert.ok(pack.asicCount > 0);
    assert.ok(pack.rackCount > 0);
  });
});

describe("SPACE-R-05 predicted one-rack arrangement survives analyzeRacks", () => {
  it("metamorphic", () => {
    const p = emptyRectangularProject({ widthM: 1.6, depthM: 2.0, heightM: 2.8 });
    p.constraints.frontServiceClearanceM = 0.8;
    p.constraints.rearServiceClearanceM = 0.6;
    p.constraints.minAisleM = 1.0;
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    const pack = feasibleSpacePacking(p, TEST_ASIC_A);
    assert.equal(pack.rackCount, 1);
    p.racks = pack.racks;
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(r.clearanceHits.length, 0);
    assert.equal(r.wallHits.length, 0);
    assert.equal(r.usableCapacity, pack.asicCount);
  });
});

describe("SPACE-R-06 predicted multi-rack arrangement survives analyzeRacks", () => {
  it("metamorphic", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    const pack = feasibleSpacePacking(p, TEST_ASIC_A);
    assert.ok(pack.rackCount >= 2);
    p.racks = pack.racks;
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(r.clearanceHits.length, 0);
    assert.equal(r.usableCapacity, pack.asicCount);
    assert.equal(r.perRackCapacity.every((x) => !x.blocked), true);
  });
});

describe("SPACE-R-07 no-rack maxBySpace/maxByRack never exceed feasible packing", () => {
  it("equal to demonstrated packing", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.racks = [];
    const pack = feasibleSpacePacking(p, TEST_ASIC_A);
    const r = calculateAll(p, catalogs);
    const space = r.capacity.slots.find((s) => s.kind === "SPACE")?.value;
    const rack = r.capacity.slots.find((s) => s.kind === "RACK")?.value;
    assert.equal(space, pack.asicCount);
    assert.equal(rack, pack.asicCount);
  });
});

describe("SPACE-R-08 adding predicted arrangement does not collapse N → 0", () => {
  it("usable stays N", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    const empty = calculateAll(p, catalogs);
    const n = empty.capacity.slots.find((s) => s.kind === "SPACE")?.value ?? 0;
    assert.ok(n > 0);
    const pack = feasibleSpacePacking(p, TEST_ASIC_A);
    p.racks = pack.racks;
    const placed = calculateAll(p, catalogs);
    assert.equal(placed.racks.usableCapacity, n);
    assert.notEqual(placed.racks.usableCapacity, 0);
  });
});

describe("AISLE-R-01 true north/south facing pair", () => {
  it("north-facing south of south-facing", () => {
    const a = rackAt(2, 1, "a", { airflowToward: "north" });
    const b = rackAt(2, 2.6, "b", { airflowToward: "south" });
    const gap = facingAisleGapM(a, b);
    assert.ok(gap != null);
    assert.ok(Math.abs((gap as number) - 1.0) < 1e-9);
  });
});

describe("AISLE-R-02 reversed physical order is not facing", () => {
  it("looking away", () => {
    const a = rackAt(2, 2.6, "a", { airflowToward: "north" });
    const b = rackAt(2, 1, "b", { airflowToward: "south" });
    assert.equal(facingAisleGapM(a, b), null);
  });
});

describe("AISLE-R-03 true east/west facing pair", () => {
  it("east-facing west of west-facing", () => {
    const a = rackAt(1, 2, "a", { airflowToward: "east" });
    const b = rackAt(1 + 1.6 + 1.0, 2, "b", { airflowToward: "west" });
    const gap = facingAisleGapM(a, b);
    assert.ok(gap != null);
    assert.ok(Math.abs((gap as number) - 1.0) < 1e-9);
  });
});

describe("AISLE-R-04 reversed east/west is not facing", () => {
  it("looking away", () => {
    const a = rackAt(1 + 1.6 + 1.0, 2, "a", { airflowToward: "east" });
    const b = rackAt(1, 2, "b", { airflowToward: "west" });
    assert.equal(facingAisleGapM(a, b), null);
  });
});

describe("AISLE-R-05 no perpendicular overlap", () => {
  it("null", () => {
    const a = rackAt(0, 1, "a", { airflowToward: "north" });
    const b = rackAt(3, 2.6, "b", { airflowToward: "south" });
    assert.equal(facingAisleGapM(a, b), null);
  });
});

describe("AISLE-R-06 true facing gap below min is blocked", () => {
  it("CRITICAL", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.constraints.minAisleM = 1.0;
    p.constraints.frontServiceClearanceM = 0.2;
    p.constraints.rearServiceClearanceM = 0;
    p.racks = [
      rackAt(2, 1, "a", { airflowToward: "north" }),
      rackAt(2, 2.1, "b", { airflowToward: "south" }),
    ];
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.ok(r.clearanceHits.some((h) => h.reason.includes("Aisle")));
    assert.equal(r.usableCapacity, 0);
    const all = calculateAll(p, catalogs);
    assert.ok(all.warnings.some((w) => w.severity === "CRITICAL"));
    assert.equal(all.capacity.verified, false);
  });
});

describe("AISLE-R-07 true facing gap exactly min accepted", () => {
  it("gap === minAisleM", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.constraints.minAisleM = 1.0;
    p.constraints.frontServiceClearanceM = 0.2;
    p.constraints.rearServiceClearanceM = 0;
    p.racks = [
      rackAt(2, 1, "a", { airflowToward: "north" }),
      rackAt(2, 2.6, "b", { airflowToward: "south" }),
    ];
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(r.clearanceHits.length, 0);
    assert.equal(r.usableCapacity, 2 * perRack());
  });
});

describe("AISLE-R-08 facing away but otherwise valid remains usable", () => {
  it("no false aisle hit", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.constraints.minAisleM = 1.0;
    p.constraints.frontServiceClearanceM = 0.2;
    p.constraints.rearServiceClearanceM = 0.2;
    p.racks = [
      rackAt(2, 2.4, "a", { airflowToward: "north" }),
      rackAt(2, 1.0, "b", { airflowToward: "south" }),
    ];
    assert.equal(facingAisleGapM(p.racks[0]!, p.racks[1]!), null);
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(r.clearanceHits.filter((h) => h.reason.includes("Aisle")).length, 0);
    assert.equal(r.usableCapacity, 2 * perRack());
  });
});

describe("CRIT-R-01 typical pass + design fail is not VERIFIED", () => {
  it("electrical CRITICAL", () => {
    const p = verifiedBase();
    p.electrical.policy = "typical";
    p.electrical.auxiliaryW = 0;
    p.electrical.lightingW = 0;
    p.electrical.networkW = 0;
    p.electrical.reservePct = 0;
    p.electrical.known = true;
    p.electrical.availablePowerW = 85_000;
    p.fleet.requestedCount = 24;
    const r = calculateAll(p, catalogs);
    assert.equal(r.electrical.typicalPass, true);
    assert.equal(r.electrical.designPass, false);
    assert.ok(r.warnings.some((w) => w.id === "elec-design-fail" && w.severity === "CRITICAL"));
    assert.equal(r.capacity.verified, false);
    assert.notEqual(r.capacity.safety, "VERIFIED");
  });
});

describe("CRIT-R-02 fan duty FAIL", () => {
  it("not VERIFIED", () => {
    const p = verifiedBase();
    p.fans = p.fans.map((f, i) => (i === 0 ? { ...f, specId: FAN_WEAK.id } : f));
    p.thermal.deltaTK = 5;
    const r = calculateAll(p, catalogs);
    assert.equal(r.fan.pass, false);
    assert.ok(r.warnings.some((w) => w.id === "fan-fail" && w.severity === "CRITICAL"));
    assert.equal(r.capacity.verified, false);
    assert.notEqual(r.capacity.safety, "VERIFIED");
  });
});

describe("CRIT-R-03 fan outside room", () => {
  it("not VERIFIED", () => {
    const p = verifiedBase();
    p.fans = p.fans.map((f, i) => (i === 0 ? { ...f, x: -2, y: -2 } : f));
    const r = calculateAll(p, catalogs);
    assert.ok(r.warnings.some((w) => w.id === "fan-outside" && w.severity === "CRITICAL"));
    assert.equal(r.capacity.verified, false);
    assert.notEqual(r.capacity.safety, "VERIFIED");
  });
});

describe("CRIT-R-04 no fan cannot be VERIFIED", () => {
  it("CRITICAL exists", () => {
    const p = verifiedBase();
    p.fans = [];
    const r = calculateAll(p, catalogs);
    assert.ok(r.warnings.some((w) => w.id === "no-fan" && w.severity === "CRITICAL"));
    assert.equal(r.capacity.verified, false);
    assert.notEqual(r.capacity.safety, "VERIFIED");
  });
});

describe("CRIT-R-05 rack collision remains CRITICAL", () => {
  it("not VERIFIED", () => {
    const p = verifiedBase();
    p.racks = [rackAt(2, 2, "a"), rackAt(2.2, 2, "b")];
    p.fleet.requestedCount = 1;
    const r = calculateAll(p, catalogs);
    assert.ok(r.warnings.some((w) => w.severity === "CRITICAL" && w.title === "Rack collision"));
    assert.equal(r.capacity.verified, false);
    assert.equal(r.capacity.safety, "CRITICAL");
  });
});

describe("CRIT-R-06 INFO floor-unknown stays informational", () => {
  it("PRELIMINARY not CRITICAL from INFO", () => {
    const p = verifiedBase();
    p.constraints.floorLoadingUnknown = true;
    const r = calculateAll(p, catalogs);
    assert.ok(r.warnings.some((w) => w.id === "floor-unknown" && w.severity === "INFO"));
    assert.equal(r.capacity.confidence, "PRELIMINARY");
    assert.equal(r.capacity.safety, "PRELIMINARY");
  });
});

describe("CRIT-R-07 dirty-filter WARNING is not auto-CRITICAL", () => {
  it("WARNING only", () => {
    const p = verifiedBase();
    p.ventilation.dirtyFilter = true;
    const r = calculateAll(p, catalogs);
    const dirty = r.warnings.find((w) => w.id === "dirty-filter");
    if (dirty) assert.equal(dirty.severity, "WARNING");
    assert.equal(r.warnings.some((w) => w.id === "dirty-filter" && w.severity === "CRITICAL"), false);
  });
});

describe("CRIT-R-08 invariant: any CRITICAL ⇒ not verified", () => {
  it("representative results", () => {
    const cases: Project[] = [
      verifiedBase(),
      (() => {
        const p = verifiedBase();
        p.fans = [];
        return p;
      })(),
      (() => {
        const p = verifiedBase();
        p.racks = [rackAt(2, 2, "a"), rackAt(2.1, 2, "b")];
        return p;
      })(),
      (() => {
        const p = verifiedBase();
        p.electrical.policy = "typical";
        p.electrical.auxiliaryW = 0;
        p.electrical.lightingW = 0;
        p.electrical.networkW = 0;
        p.electrical.availablePowerW = 85_000;
        return p;
      })(),
    ];
    for (const p of cases) {
      const r = calculateAll(p, catalogs);
      const crit = r.warnings.some((w) => w.severity === "CRITICAL");
      if (crit) {
        assert.equal(r.capacity.verified, false, p.name);
        assert.notEqual(r.capacity.safety, "VERIFIED", p.name);
      }
    }
  });
});

describe("SPACE diagnostic 1.6×0.6 is 0", () => {
  it("theoreticalSpaceCapacity no longer over-counts unserviceable cells", () => {
    assert.equal(theoreticalSpaceCapacity(1.6, 0.6, 1.6, 0.6, 24, 0.8, 0.6, 1.0), 0);
  });
});
