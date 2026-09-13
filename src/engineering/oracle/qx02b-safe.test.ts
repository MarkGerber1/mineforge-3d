import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyFailure } from "../../ai/failure.ts";
import { TEST_ASIC_A } from "../../equipment/asic-catalog.ts";
import { TEST_RACK_A, emptyRectangularProject, undergroundParkingFarm } from "../../project/factory.ts";
import { saveScheduler } from "../../project/save-scheduler.ts";
import { useProjectStore } from "../../project/store.ts";
import { defaultCatalogs } from "../catalogs.ts";
import { theoreticalSpaceCapacity } from "../capacity.ts";
import {
  MAX_AVAILABLE_POWER_W,
  MAX_ROOM_HEIGHT_M,
  MIN_AVAILABLE_POWER_W,
  MIN_ROOM_DIM_M,
} from "../constants.ts";
import { validateAvailablePowerInput, validateAvailablePowerW } from "../electrical.ts";
import { calculateAll } from "../pipeline.ts";
import { calculatePressure } from "../pressure.ts";
import { analyzeRacks, rackAsicCapacity, validateRackAsicCount, validateRackAsicCountInput } from "../racks.ts";
import { geometryFingerprint } from "../reality.ts";
import { validateRoomHeightInput, validateRoomHeightM } from "../room-resize.ts";
import type { Rack } from "../types.ts";

saveScheduler.setSave(async () => undefined);

const catalogs = defaultCatalogs();

function live() {
  return useProjectStore.getState();
}

function rackAt(
  x: number,
  y: number,
  id = "r1",
  extra: Partial<Rack> = {},
): Rack {
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

function noClearance(p: ReturnType<typeof emptyRectangularProject>) {
  p.constraints.frontServiceClearanceM = 0;
  p.constraints.rearServiceClearanceM = 0;
  p.constraints.minAisleM = 0;
  return p;
}

function verifiedBase() {
  const p = undergroundParkingFarm();
  p.constraints.floorLoadingUnknown = false;
  p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
  return p;
}

function perRack(): number {
  return rackAsicCapacity(
    { id: "t", name: "t", ...TEST_RACK_A, x: 0, y: 0, rotationDeg: 0, asicCount: 0, airflowToward: "south" },
    TEST_ASIC_A,
  );
}

describe("RACK-SAFE-01 two valid non-overlapping racks", () => {
  it("both usable", () => {
    const p = noClearance(emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 }));
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.racks = [rackAt(1, 1, "a"), rackAt(3.5, 1, "b")];
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(r.collisions.length, 0);
    assert.equal(r.perRackCapacity.every((x) => !x.blocked), true);
    assert.equal(r.usableCapacity, 2 * perRack());
  });
});

describe("RACK-SAFE-02 overlapping racks", () => {
  it("CRITICAL and neither conflicting rack counts", () => {
    const p = noClearance(emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 }));
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.racks = [rackAt(1, 1, "a"), rackAt(2.5, 1, "b")];
    const r = calculateAll(p, catalogs);
    assert.ok(r.racks.collisions.length >= 1);
    assert.equal(r.racks.usableCapacity, 0);
    assert.ok(r.warnings.some((w) => w.severity === "CRITICAL" && w.title === "Rack collision"));
    assert.notEqual(r.capacity.confidence, "VERIFIED");
    assert.equal(r.capacity.verified, false);
  });
});

describe("RACK-SAFE-03 rack partially outside", () => {
  it("excluded", () => {
    const p = noClearance(emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 }));
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.racks = [rackAt(-0.2, 1, "out")];
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.ok(r.wallHits.some((h) => h.id === "out"));
    assert.equal(r.usableCapacity, 0);
  });
});

describe("RACK-SAFE-04 rack completely outside", () => {
  it("excluded", () => {
    const p = noClearance(emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 }));
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.racks = [rackAt(40, 40, "gone")];
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.ok(r.wallHits.some((h) => h.id === "gone"));
    assert.equal(r.usableCapacity, 0);
  });
});

describe("RACK-SAFE-05 rack in door swing", () => {
  it("excluded", () => {
    const p = noClearance(emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 }));
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.openings = [
      {
        id: "door_s",
        type: "DOOR",
        wallId: "south",
        widthM: 1,
        heightM: 2.1,
        bottomElevationM: 0,
        offsetFromWallStartM: 2,
        name: "Door",
      },
    ];
    p.racks = [rackAt(2, 0.1, "block")];
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.ok(r.doorHits.some((h) => h.id === "block"));
    assert.equal(r.usableCapacity, 0);
  });
});

describe("RACK-SAFE-06 rack-AsBuilt", () => {
  it("excluded", () => {
    const p = noClearance(emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 }));
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.racks = [rackAt(1, 1, "r")];
    p.reality = {
      photos: [],
      videos: [],
      findings: [],
      asBuilt: [
        {
          id: "col1",
          kind: "column",
          name: "C",
          x: 1.1,
          y: 1.1,
          z: 0,
          widthM: 0.4,
          heightM: 2.8,
          depthM: 0.4,
          provenance: "USER_CONFIRMED",
          confidence: "HIGH",
        },
      ],
      compareMode: "as-designed",
      interview: [],
    };
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.ok(r.asBuiltHits.some((h) => h.id === "r"));
    assert.equal(r.usableCapacity, 0);
  });
});

describe("RACK-SAFE-07 rack-ceiling", () => {
  it("excluded", () => {
    const p = noClearance(emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 }));
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.racks = [rackAt(1, 1, "tall", { heightM: 2.95 })];
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.ok(r.ceilingHits.some((h) => h.id === "tall"));
    assert.equal(r.usableCapacity, 0);
  });
});

describe("RACK-SAFE-08 removing conflict restores capacity", () => {
  it("deterministic restore", () => {
    const p = noClearance(emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 }));
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.racks = [rackAt(1, 1, "a"), rackAt(2.5, 1, "b")];
    const bad = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(bad.usableCapacity, 0);
    p.racks = [rackAt(1, 1, "a"), rackAt(3.5, 1, "b")];
    const good = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(good.usableCapacity, 2 * perRack());
  });
});

describe("AISLE-01 sufficient clearance", () => {
  it("valid", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.racks = [rackAt(3, 2, "ok")];
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(r.clearanceHits.length, 0);
    assert.equal(r.usableCapacity, perRack());
  });
});

describe("AISLE-02 body non-overlap but front clearances collide", () => {
  it("front service vs body", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.constraints.rearServiceClearanceM = 0;
    p.constraints.minAisleM = 0;
    p.constraints.frontServiceClearanceM = 0.8;
    p.racks = [rackAt(2, 1, "south", { airflowToward: "south" }), rackAt(2, 1.9, "north", { airflowToward: "south" })];
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(r.collisions.length, 0);
    assert.ok(r.clearanceHits.length > 0);
    assert.ok(r.perRackCapacity.some((x) => x.blocked));
    assert.ok(r.usableCapacity < 2 * perRack());
    const all = calculateAll(p, catalogs);
    assert.notEqual(all.capacity.confidence, "VERIFIED");
  });
});

describe("AISLE-03 rear service conflict", () => {
  it("rear envelope hits body", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.constraints.frontServiceClearanceM = 0;
    p.constraints.minAisleM = 0;
    p.constraints.rearServiceClearanceM = 0.6;
    p.racks = [rackAt(2, 1, "a", { airflowToward: "south" }), rackAt(2, 1.8, "b", { airflowToward: "south" })];
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(r.collisions.length, 0);
    assert.ok(r.clearanceHits.some((h) => h.reason.includes("rear")));
    assert.ok(r.perRackCapacity.some((x) => x.blocked));
    assert.ok(r.usableCapacity < 2 * perRack());
  });
});

describe("AISLE-04 min aisle too narrow", () => {
  it("facing gap below minAisleM", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.constraints.frontServiceClearanceM = 0.2;
    p.constraints.rearServiceClearanceM = 0;
    p.constraints.minAisleM = 1.0;
    p.racks = [
      rackAt(2, 1, "a", { airflowToward: "north" }),
      rackAt(2, 2.1, "b", { airflowToward: "south" }),
    ];
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.ok(r.clearanceHits.some((h) => h.reason.includes("Aisle")));
    assert.equal(r.usableCapacity, 0);
  });
});

describe("AISLE-05 near exact required boundary", () => {
  it("just below rejected, just above accepted", () => {
    const mk = (gap: number) => {
      const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
      p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
      p.constraints.frontServiceClearanceM = 0.2;
      p.constraints.rearServiceClearanceM = 0;
      p.constraints.minAisleM = 1.0;
      p.racks = [
        rackAt(2, 1, "a", { airflowToward: "north" }),
        rackAt(2, 1.6 + gap, "b", { airflowToward: "south" }),
      ];
      return analyzeRacks(p, TEST_ASIC_A);
    };
    assert.ok(mk(0.999).clearanceHits.length > 0);
    assert.equal(mk(1.001).clearanceHits.length, 0);
  });
});

describe("AISLE-06 exact boundary accepted", () => {
  it("gap === minAisleM is accepted; service flush with wall accepted", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.constraints.frontServiceClearanceM = 0.2;
    p.constraints.rearServiceClearanceM = 0;
    p.constraints.minAisleM = 1.0;
    p.racks = [
      rackAt(2, 1, "a", { airflowToward: "north" }),
      rackAt(2, 2.6, "b", { airflowToward: "south" }),
    ];
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(r.clearanceHits.length, 0);
    const wall = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    wall.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    wall.constraints.frontServiceClearanceM = 0.8;
    wall.constraints.rearServiceClearanceM = 0;
    wall.constraints.minAisleM = 0;
    wall.racks = [rackAt(3, 0.8, "flush", { airflowToward: "south" })];
    const flush = analyzeRacks(wall, TEST_ASIC_A);
    assert.equal(flush.clearanceHits.length, 0);
  });
});

describe("AISLE-07 legacy invalid Project cannot produce VERIFIED SAFE", () => {
  it("loadProject of tight aisle is not VERIFIED", () => {
    const p = verifiedBase();
    p.constraints.frontServiceClearanceM = 0.2;
    p.constraints.rearServiceClearanceM = 0;
    p.constraints.minAisleM = 1.0;
    p.racks = [
      rackAt(2, 1, "a", { airflowToward: "north" }),
      rackAt(2, 2.1, "b", { airflowToward: "south" }),
    ];
    live().loadProject(p, false);
    const r = live().result;
    assert.notEqual(r.capacity.confidence, "VERIFIED");
    assert.equal(r.capacity.verified, false);
    assert.ok(r.capacity.safety === "CRITICAL" || r.capacity.safety === "INCOMPLETE");
  });
});

describe("SPACE-01 normal 8×5 room", () => {
  it("positive packing not exceeding body grid", () => {
    const n = theoreticalSpaceCapacity(8, 5, 1.6, 0.6, 24, 0.8, 0.6, 1.0);
    const body = Math.max(Math.floor(8 / 1.6) * Math.floor(5 / 0.6), Math.floor(8 / 0.6) * Math.floor(5 / 1.6)) * 24;
    assert.ok(n > 0);
    assert.ok(n <= body);
  });
});

describe("SPACE-02 room narrower than rack in both orientations", () => {
  it("0.5 × 100 → 0", () => {
    assert.equal(theoreticalSpaceCapacity(0.5, 100, 1.6, 0.6, 24, 0.8, 0.6, 1.0), 0);
    assert.equal(theoreticalSpaceCapacity(100, 0.5, 1.6, 0.6, 24, 0.8, 0.6, 1.0), 0);
  });
});

describe("SPACE-03 orientation 0 impossible but 90° fits", () => {
  it("0.7 × 10 yields positive", () => {
    const n = theoreticalSpaceCapacity(0.7, 10, 1.6, 0.6, 24, 0.8, 0.6, 1.0);
    assert.ok(n > 0);
    assert.equal(theoreticalSpaceCapacity(0.7, 10, 1.6, 0.6, 24, 0.8, 0.6, 1.0) % 24, 0);
  });
});

describe("SPACE-04 exact boundary fit", () => {
  it("room equals rack footprint → 1 rack × perRack", () => {
    assert.equal(theoreticalSpaceCapacity(1.6, 0.6, 1.6, 0.6, 24, 0.8, 0.6, 1.0), 24);
  });
});

describe("SPACE-05 long/narrow valid room", () => {
  it("2.0 × 20 positive", () => {
    const n = theoreticalSpaceCapacity(2.0, 20, 1.6, 0.6, 24, 0.8, 0.6, 1.0);
    assert.ok(n > 0);
  });
});

describe("SPACE-06 never exceeds dimensional grid", () => {
  it("packed ≤ body grid", () => {
    for (const [w, d] of [
      [8, 5],
      [0.5, 100],
      [0.7, 10],
      [1.6, 0.6],
      [2, 20],
      [12, 7],
    ] as const) {
      const n = theoreticalSpaceCapacity(w, d, 1.6, 0.6, 24, 0.8, 0.6, 1.0);
      const body =
        Math.max(Math.floor((w + 1e-12) / 1.6) * Math.floor((d + 1e-12) / 0.6), Math.floor((w + 1e-12) / 0.6) * Math.floor((d + 1e-12) / 1.6)) *
        24;
      assert.ok(n <= body, `${w}×${d} packed ${n} > body ${body}`);
    }
  });
});

describe("INTAKE-01 no intake", () => {
  it("not VERIFIED", () => {
    const p = verifiedBase();
    p.openings = p.openings.filter((o) => o.type !== "INTAKE");
    const r = calculateAll(p, catalogs);
    assert.equal(r.capacity.confidence, "INCOMPLETE");
    assert.ok(r.warnings.some((w) => w.id === "no-intake"));
  });
});

describe("INTAKE-02 valid intake", () => {
  it("usable", () => {
    const p = verifiedBase();
    const r = calculateAll(p, catalogs);
    assert.ok(p.openings.some((o) => o.type === "INTAKE"));
    assert.notEqual(r.capacity.confidence, "INCOMPLETE");
  });
});

describe("INTAKE-03 malformed intake", () => {
  it("does not count", () => {
    const p = verifiedBase();
    p.openings = p.openings.map((o) => (o.type === "INTAKE" ? { ...o, widthM: 0 } : o));
    const r = calculateAll(p, catalogs);
    assert.equal(r.capacity.confidence, "INCOMPLETE");
    assert.ok(r.warnings.some((w) => w.severity === "BLOCKER"));
  });
});

describe("INTAKE-04 blocked-intake failure scenario", () => {
  it("tiny intake is not VERIFIED ventilation", () => {
    const src = verifiedBase();
    const blocked = applyFailure(src, "intake-blocked");
    const r = calculateAll(blocked, catalogs);
    assert.notEqual(r.capacity.confidence, "VERIFIED");
    assert.equal(r.capacity.verified, false);
  });
});

describe("INTAKE-05 intake restored", () => {
  it("restores non-incomplete if other inputs present", () => {
    const missing = verifiedBase();
    missing.openings = missing.openings.filter((o) => o.type !== "INTAKE");
    const a = calculateAll(missing, catalogs);
    assert.equal(a.capacity.confidence, "INCOMPLETE");
    const restored = verifiedBase();
    const b = calculateAll(restored, catalogs);
    assert.notEqual(b.capacity.confidence, "INCOMPLETE");
  });
});

describe("INTAKE-06 fan + exhaust but no intake cannot produce VERIFIED ventilation SAFE", () => {
  it("INCOMPLETE", () => {
    const p = verifiedBase();
    p.openings = p.openings.filter((o) => o.type !== "INTAKE");
    const r = calculateAll(p, catalogs);
    assert.equal(r.capacity.verified, false);
    assert.equal(r.capacity.confidence, "INCOMPLETE");
  });
});

describe("OPEN-SAFE-01 valid exhaust counts", () => {
  it("exhaustKnown via valid geometry", () => {
    const p = verifiedBase();
    const r = calculateAll(p, catalogs);
    assert.equal(r.openings.valid, true);
    assert.notEqual(r.capacity.confidence, "INCOMPLETE");
  });
});

describe("OPEN-SAFE-02 invalid exhaust does not count", () => {
  it("zero-width exhaust is not availability", () => {
    const p = verifiedBase();
    p.openings = p.openings.map((o) => (o.type === "EXHAUST" ? { ...o, widthM: 0 } : o));
    const r = calculateAll(p, catalogs);
    assert.equal(r.capacity.confidence, "INCOMPLETE");
    assert.ok(r.warnings.some((w) => w.id === "no-exhaust" || w.severity === "BLOCKER"));
  });
});

describe("OPEN-SAFE-03 malformed exhaust + fan cannot yield VERIFIED SAFE", () => {
  it("BLOCKER", () => {
    const p = verifiedBase();
    p.openings = p.openings.map((o) => (o.type === "EXHAUST" ? { ...o, offsetFromWallStartM: 50 } : o));
    const r = calculateAll(p, catalogs);
    assert.equal(r.capacity.verified, false);
    assert.ok(r.warnings.some((w) => w.severity === "BLOCKER"));
  });
});

describe("OPEN-SAFE-04 invalid unrelated opening produces correct global safety", () => {
  it("bad TECHNICAL forces INCOMPLETE", () => {
    const p = verifiedBase();
    p.openings.push({
      id: "tech_bad",
      type: "TECHNICAL",
      wallId: "north",
      widthM: -1,
      heightM: 0.5,
      bottomElevationM: 0,
      offsetFromWallStartM: 0,
      name: "Bad tech",
    });
    const r = calculateAll(p, catalogs);
    assert.equal(r.openings.valid, false);
    assert.equal(r.capacity.confidence, "INCOMPLETE");
    assert.equal(r.capacity.verified, false);
  });
});

describe("OPEN-SAFE-05 fixing opening restores capability", () => {
  it("restore exhaust", () => {
    const bad = verifiedBase();
    bad.openings = bad.openings.map((o) => (o.type === "EXHAUST" ? { ...o, widthM: 0 } : o));
    assert.equal(calculateAll(bad, catalogs).capacity.confidence, "INCOMPLETE");
    const good = verifiedBase();
    assert.notEqual(calculateAll(good, catalogs).capacity.confidence, "INCOMPLETE");
  });
});

describe("SAFE-CONF global contract", () => {
  it("BLOCKER / CRITICAL / unknown required input is not VERIFIED", () => {
    const base = calculateAll(verifiedBase(), catalogs);
    assert.ok(base.capacity.confidence === "VERIFIED" || base.capacity.confidence === "PRELIMINARY");
    const col = verifiedBase();
    col.racks = [rackAt(1, 2, "a"), rackAt(1.2, 2, "b")];
    const c = calculateAll(col, catalogs);
    assert.equal(c.capacity.verified, false);
    assert.ok(c.capacity.safety === "CRITICAL" || c.capacity.confidence === "CRITICAL");
  });
});

describe("FILTER-01 clean", () => {
  it("no extra", () => {
    const p = verifiedBase();
    p.ventilation.dirtyFilter = false;
    const r = calculatePressure(p, 10000);
    assert.equal(r.dirtyExtraPa, 0);
  });
});

describe("FILTER-02 dirty", () => {
  it("applies extra", () => {
    const p = verifiedBase();
    p.ventilation.dirtyFilter = true;
    const r = calculatePressure(p, 10000);
    assert.equal(r.dirtyExtraPa, p.ventilation.dirtyFilterExtraPa);
  });
});

describe("FILTER-03 dirty pressure difference equals exactly dirtyFilterExtraPa", () => {
  it("once", () => {
    const p = verifiedBase();
    const extra = p.ventilation.dirtyFilterExtraPa;
    p.ventilation.dirtyFilter = false;
    const clean = calculatePressure(p, 20000);
    p.ventilation.dirtyFilter = true;
    const dirty = calculatePressure(p, 20000);
    assert.ok(Math.abs(dirty.totalPa - clean.totalPa - extra) < 1e-9);
  });
});

describe("FILTER-04 operating-point and pressure trace share one penalty", () => {
  it("same extra", () => {
    const p = verifiedBase();
    p.ventilation.dirtyFilter = true;
    const r = calculateAll(p, catalogs);
    assert.equal(r.pressure.dirtyExtraPa, p.ventilation.dirtyFilterExtraPa);
    p.ventilation.dirtyFilter = false;
    const clean = calculateAll(p, catalogs);
    p.ventilation.dirtyFilter = true;
    const dirty = calculateAll(p, catalogs);
    assert.ok((clean.fan.operatingQ_m3h ?? 0) >= (dirty.fan.operatingQ_m3h ?? 0));
    assert.equal(dirty.pressure.dirtyExtraPa, p.ventilation.dirtyFilterExtraPa);
    assert.equal(clean.pressure.dirtyExtraPa, 0);
  });
});

describe("FILTER-05 toggle dirty→clean restores baseline", () => {
  it("restore", () => {
    const p = verifiedBase();
    p.ventilation.dirtyFilter = false;
    const a = calculatePressure(p, 15000);
    p.ventilation.dirtyFilter = true;
    calculatePressure(p, 15000);
    p.ventilation.dirtyFilter = false;
    const c = calculatePressure(p, 15000);
    assert.equal(c.totalPa, a.totalPa);
  });
});

describe("DIM-H room height matrix", () => {
  const cases: Array<{ raw: string; ok: boolean }> = [
    { raw: "", ok: false },
    { raw: "abc", ok: false },
    { raw: "0", ok: false },
    { raw: "-1", ok: false },
    { raw: "0.49", ok: false },
    { raw: "0.50", ok: true },
    { raw: "0,50", ok: true },
    { raw: "2.8", ok: true },
    { raw: "50.00", ok: true },
    { raw: "50.01", ok: false },
    { raw: "999 m", ok: false },
  ];
  for (const c of cases) {
    it(`${c.raw || "blank"} → ${c.ok ? "accept" : "reject"}`, () => {
      const r = validateRoomHeightInput(c.raw);
      assert.equal(r.ok, c.ok, c.raw);
    });
  }
  it("domain helpers", () => {
    assert.equal(validateRoomHeightM(MIN_ROOM_DIM_M).ok, true);
    assert.equal(validateRoomHeightM(MAX_ROOM_HEIGHT_M).ok, true);
    assert.equal(validateRoomHeightM(MIN_ROOM_DIM_M - 0.01).ok, false);
    assert.equal(validateRoomHeightM(MAX_ROOM_HEIGHT_M + 0.01).ok, false);
  });
});

describe("NUM-POWER electrical matrix", () => {
  it("blank text NaN Infinity negative zero MIN normal MAX above huge", () => {
    assert.equal(validateAvailablePowerInput("").ok, false);
    assert.equal(validateAvailablePowerInput("abc").ok, false);
    assert.equal(validateAvailablePowerW(Number.NaN).ok, false);
    assert.equal(validateAvailablePowerW(Infinity).ok, false);
    assert.equal(validateAvailablePowerW(-Infinity).ok, false);
    assert.equal(validateAvailablePowerW(-1).ok, false);
    assert.equal(validateAvailablePowerW(0).ok, false);
    assert.equal(validateAvailablePowerW(MIN_AVAILABLE_POWER_W).ok, true);
    assert.equal(validateAvailablePowerInput("80", "kW").ok, true);
    const eighty = validateAvailablePowerInput("80", "kW");
    assert.equal(eighty.ok, true);
    if (eighty.ok) assert.equal(eighty.watts, 80000);
    const comma = validateAvailablePowerInput("80,5", "kW");
    assert.equal(comma.ok, true);
    if (comma.ok) assert.equal(comma.watts, 80500);
    assert.equal(validateAvailablePowerW(MAX_AVAILABLE_POWER_W).ok, true);
    assert.equal(validateAvailablePowerW(MAX_AVAILABLE_POWER_W + 1).ok, false);
    assert.equal(validateAvailablePowerW(1e20).ok, false);
  });
});

describe("RACK-ASIC count matrix", () => {
  it("-1 0 1 3.7 NaN Infinity cap cap+1 huge", () => {
    const cap = 24;
    assert.equal(validateRackAsicCount(-1, cap).ok, false);
    assert.equal(validateRackAsicCount(0, cap).ok, true);
    assert.equal(validateRackAsicCount(1, cap).ok, true);
    assert.equal(validateRackAsicCount(3.7, cap).ok, false);
    assert.equal(validateRackAsicCountInput("3,7", cap).ok, false);
    assert.equal(validateRackAsicCount(Number.NaN, cap).ok, false);
    assert.equal(validateRackAsicCount(Infinity, cap).ok, false);
    assert.equal(validateRackAsicCount(cap, cap).ok, true);
    assert.equal(validateRackAsicCount(cap + 1, cap).ok, false);
    assert.equal(validateRackAsicCount(999999, cap).ok, false);
  });
});

describe("ADV-01 collision → CRITICAL not VERIFIED", () => {
  it("valid then overlap", () => {
    const p = verifiedBase();
    const a = calculateAll(p, catalogs);
    assert.equal(a.capacity.verified, true);
    p.racks = [rackAt(2, 2, "a"), rackAt(2.2, 2, "b")];
    const b = calculateAll(p, catalogs);
    assert.ok(b.warnings.some((w) => w.severity === "CRITICAL"));
    assert.equal(b.racks.usableCapacity, 0);
    assert.equal(b.capacity.verified, false);
    assert.equal(b.capacity.safety, "CRITICAL");
  });
});

describe("ADV-02 delete intake", () => {
  it("ventilation no longer VERIFIED", () => {
    const p = verifiedBase();
    assert.equal(calculateAll(p, catalogs).capacity.verified, true);
    p.openings = p.openings.filter((o) => o.type !== "INTAKE");
    const r = calculateAll(p, catalogs);
    assert.equal(r.capacity.verified, false);
    assert.equal(r.capacity.confidence, "INCOMPLETE");
  });
});

describe("ADV-03 invalid exhaust", () => {
  it("not exhaustKnown, not VERIFIED", () => {
    const p = verifiedBase();
    p.openings = p.openings.map((o) => (o.type === "EXHAUST" ? { ...o, widthM: 0 } : o));
    const r = calculateAll(p, catalogs);
    assert.ok(r.warnings.some((w) => w.severity === "BLOCKER"));
    assert.equal(r.capacity.verified, false);
  });
});

describe("ADV-04 long/narrow area-large space 0", () => {
  it("Physical Space = 0", () => {
    assert.equal(theoreticalSpaceCapacity(0.5, 100, 1.6, 0.6, 24, 0.8, 0.6, 1.0), 0);
    const p = verifiedBase();
    p.room = { ...p.room, widthM: 0.5, depthM: 100 };
    p.racks = [];
    const r = calculateAll(p, catalogs);
    const space = r.capacity.slots.find((s) => s.kind === "SPACE");
    assert.equal(space?.value, 0);
  });
});

describe("ADV-05 invalid height leaves fingerprint", () => {
  it("canonical unchanged", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const fp = geometryFingerprint(live().project);
    const h = live().project.room.heightM;
    const res = live().setRoomHeight(0.2);
    assert.equal(res.ok, false);
    assert.equal(live().project.room.heightM, h);
    assert.equal(geometryFingerprint(live().project), fp);
  });
});

describe("ADV-06 malformed power leaves canonical", () => {
  it("unchanged", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const w = live().project.electrical.availablePowerW;
    const res = live().setPower(Number.NaN);
    assert.equal(res.ok, false);
    assert.equal(live().project.electrical.availablePowerW, w);
    const res2 = live().setPower(-5);
    assert.equal(res2.ok, false);
    assert.equal(live().project.electrical.availablePowerW, w);
  });
});

describe("ADV-07 dirty filter one-time penalty", () => {
  it("exactly extraPa once", () => {
    const p = verifiedBase();
    const extra = p.ventilation.dirtyFilterExtraPa;
    p.ventilation.dirtyFilter = false;
    const c = calculatePressure(p, 12000);
    p.ventilation.dirtyFilter = true;
    const d = calculatePressure(p, 12000);
    assert.equal(d.totalPa - c.totalPa, extra);
  });
});

describe("HUD-SAFE oracle states", () => {
  it("verified / over / collision / invalid opening / missing intake / blocker", () => {
    const v = calculateAll(verifiedBase(), catalogs);
    assert.equal(v.capacity.safety, "VERIFIED");
    assert.equal(v.capacity.verified, true);

    const over = verifiedBase();
    over.fleet.requestedCount = 10_000;
    const o = calculateAll(over, catalogs);
    assert.equal(o.capacity.safety, "OVER_CAPACITY");
    assert.equal(o.capacity.verified, false);

    const col = verifiedBase();
    col.racks = [rackAt(2, 2, "a"), rackAt(2.1, 2, "b")];
    col.fleet.requestedCount = 1;
    const cr = calculateAll(col, catalogs);
    assert.equal(cr.capacity.safety, "CRITICAL");
    assert.notEqual(cr.capacity.safety, "VERIFIED");

    const inv = verifiedBase();
    inv.openings = inv.openings.map((x) => (x.type === "EXHAUST" ? { ...x, widthM: 0 } : x));
    assert.equal(calculateAll(inv, catalogs).capacity.verified, false);

    const ni = verifiedBase();
    ni.openings = ni.openings.filter((x) => x.type !== "INTAKE");
    const n = calculateAll(ni, catalogs);
    assert.equal(n.capacity.safety, "INCOMPLETE");

    const blk = verifiedBase();
    blk.room.heightM = 0.1;
    const b = calculateAll(blk, catalogs);
    assert.equal(b.capacity.verified, false);
    assert.ok(b.warnings.some((w) => w.severity === "BLOCKER"));
  });
});
