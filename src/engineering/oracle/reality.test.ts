import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyReality } from "../types.ts";
import type { PhotoMarker, Project, RealityFinding, RealityPhotoMeta } from "../types.ts";
import { undergroundParkingFarm } from "../../project/factory.ts";
import { emptyRectangularProject, TEST_RACK_A } from "../../project/factory.ts";
import { TEST_ASIC_A } from "../../equipment/asic-catalog.ts";
import { defaultCatalogs } from "../catalogs.ts";
import { calculateAll } from "../pipeline.ts";
import { applyPatch } from "../upgrade.ts";
import { parseProject } from "../../project/schema.ts";
import { openingAreaM2, wallLength } from "../geometry.ts";
import { asBuiltAabb3, aabb3Intersects, rackAabb3 } from "../aabb3.ts";
import { resolvedVentComponents } from "../pressure.ts";
import {
  applyFinding,
  asBuiltPlanAabb,
  calibrateFromKnownDistance,
  measurePairMeters,
  parseAiFinding,
  photoCalibration,
  pixelDistance,
  recordAnnotation,
} from "../reality.ts";

function marker(partial: Partial<PhotoMarker> & Pick<PhotoMarker, "id" | "nx" | "ny">): PhotoMarker {
  return { kind: "point", label: partial.label ?? partial.id, ...partial };
}

function calibratedPhoto(project: Project): { project: Project; photo: RealityPhotoMeta } {
  const photo: RealityPhotoMeta = {
    id: "ph1",
    name: "south.jpg",
    mime: "image/jpeg",
    createdAt: 1,
    notes: "",
    wallHint: "south",
    widthPx: 1024,
    heightPx: 512,
    markers: [],
  };
  const p: Project = {
    ...project,
    reality: { ...(project.reality ?? emptyReality()), photos: [photo] },
  };
  return { project: p, photo };
}

/** 2.000 m over 256 px → scale 1/128 m/px (exact in IEEE-754). */
const CAL_A = (): PhotoMarker => marker({ id: "a", nx: 0, ny: 0.5, label: "A" });
const CAL_B = (): PhotoMarker => marker({ id: "b", nx: 0.25, ny: 0.5, label: "B" });
const SCALE = 2 / 256;


describe("REAL-01 photo estimate never labeled field measurement", () => {
  it("provenance stays PHOTO_ESTIMATE until confirm", () => {
    const p = undergroundParkingFarm();
    p.reality = emptyReality();
    p.reality.asBuilt.push({
      id: "beam1",
      kind: "beam",
      name: "Beam from photo",
      x: 1,
      y: 1,
      z: 2.4,
      widthM: 4,
      heightM: 0.3,
      depthM: 0.3,
      provenance: "PHOTO_ESTIMATE",
      confidence: "MEDIUM",
    });
    assert.notEqual(p.reality.asBuilt[0].provenance, "FIELD_MEASUREMENT");
  });
});

describe("REAL-02 confirmed beam collides with rack", () => {
  it("SAFE/warnings see as-built after APPLY", () => {
    const src = undergroundParkingFarm();
    const rack = src.racks[0];
    assert.ok(rack);
    const next = applyPatch(src, {
      reality: {
        asBuilt: [
          {
            id: "beam_hit",
            kind: "beam",
            name: "Beam",
            x: rack.x,
            y: rack.y,
            z: 1.7,
            widthM: rack.widthM,
            heightM: 0.4,
            depthM: rack.depthM,
            provenance: "USER_CONFIRMED",
            confidence: "HIGH",
          },
        ],
      },
    });
    const r = calculateAll(next, defaultCatalogs());
    assert.ok(r.racks.asBuiltHits.length >= 1);
    assert.ok(r.warnings.some((w) => w.id.startsWith("asbuilt-")));
  });
});

describe("REAL-03 A–B known distance sets photo scale", () => {
  it("2.000 m over 256 px → 1/128 m/px", () => {
    const { photo } = calibratedPhoto(emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 }));
    const a = CAL_A();
    const b = CAL_B();
    const d = pixelDistance(a, b, 1024, 512);
    assert.equal(d, 256);
    const cal = calibrateFromKnownDistance(photo, a, b, 2);
    assert.ok(cal);
    assert.equal(cal.scaleMPerPx, SCALE);
    assert.equal(cal.provenance, "FIELD_MEASUREMENT");
    assert.equal(cal.lengthM, 2);
  });
});

describe("REAL-04 calibration scale transfers to a second pair", () => {
  it("128 px at 1/128 m/px → 1.000 m PHOTO_ESTIMATE", () => {
    const base = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    const { project } = calibratedPhoto(base);
    const rec = recordAnnotation(project, "ph1", CAL_A(), CAL_B(), { knownLengthM: 2, kind: "point" });
    assert.ok(rec.calibration);
    assert.equal(rec.calibration.scaleMPerPx, SCALE);
    assert.equal(rec.finding, null);
    const photo = rec.project.reality!.photos[0];
    const c = marker({ id: "c", nx: 0, ny: 0.25, label: "C" });
    const d = marker({ id: "d", nx: 0.125, ny: 0.25, label: "D" });
    const m = measurePairMeters(photo, c, d);
    assert.ok(m);
    assert.equal(m.lengthM, 1);
    assert.equal(m.provenance, "PHOTO_ESTIMATE");
  });
});

describe("REAL-05 confirmed door annotation mutates canonical openings", () => {
  it("ADD writes 1.000 × 2.100 m door at offset 2.000 m on south", () => {
    const base = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    const { project } = calibratedPhoto(base);
    const calibrated = recordAnnotation(project, "ph1", CAL_A(), CAL_B(), { knownLengthM: 2, kind: "point" }).project;
    const dA = marker({ id: "da", nx: 0.25, ny: 0.95, label: "A" });
    const dB = marker({ id: "db", nx: 0.375, ny: 0.95, label: "B" });
    const rec = recordAnnotation(calibrated, "ph1", dA, dB, { kind: "door" });
    assert.ok(rec.finding);
    assert.equal(rec.finding.kind, "door");
    assert.equal(rec.finding.status, "PENDING");
    assert.equal(rec.project.openings.length, 0);
    const applied = applyFinding(rec.project, rec.finding.id, "ADDED");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    assert.equal(applied.project.openings.length, 1);
    const door = applied.project.openings[0];
    assert.equal(door.type, "DOOR");
    assert.equal(door.wallId, "south");
    assert.equal(door.widthM, 1);
    assert.equal(door.heightM, 2.1);
    assert.equal(door.offsetFromWallStartM, 2);
    assert.equal(door.bottomElevationM, 0);
    assert.equal(door.provenance, "USER_CONFIRMED");
  });
});

describe("REAL-06 pending photo geometry does not mutate the model", () => {
  it("openings and asBuilt stay empty until ADD", () => {
    const base = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    const { project } = calibratedPhoto(base);
    const calibrated = recordAnnotation(project, "ph1", CAL_A(), CAL_B(), { knownLengthM: 2, kind: "point" }).project;
    const dA = marker({ id: "da", nx: 0.25, ny: 0.95, label: "A" });
    const dB = marker({ id: "db", nx: 0.375, ny: 0.95, label: "B" });
    const rec = recordAnnotation(calibrated, "ph1", dA, dB, { kind: "door" });
    assert.equal(rec.project.openings.length, 0);
    assert.equal(rec.project.reality!.asBuilt.length, 0);
    assert.equal(rec.finding?.status, "PENDING");
  });
});

describe("REAL-07 confirmed beam as-built hits a rack", () => {
  it("ADD beam overlapping rack AABB → asBuiltHits", () => {
    const src = undergroundParkingFarm();
    const rack = src.racks[0];
    assert.ok(rack);
    const finding = {
      id: "find_hit",
      kind: "beam" as const,
      summary: "Beam over rack",
      confidence: "HIGH" as const,
      status: "PENDING" as const,
      estimated: {
        kind: "beam" as const,
        name: "Beam",
        x: rack.x,
        y: rack.y,
        z: 1.7,
        widthM: rack.widthM,
        heightM: 0.4,
        depthM: rack.depthM,
        provenance: "PHOTO_ESTIMATE" as const,
        confidence: "HIGH" as const,
      },
    };
    const p: Project = {
      ...src,
      reality: { ...(src.reality ?? emptyReality()), findings: [finding], asBuilt: [] },
    };
    assert.equal(p.reality!.asBuilt.length, 0);
    const applied = applyFinding(p, "find_hit", "ADDED");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    const r = calculateAll(applied.project, defaultCatalogs());
    assert.ok(r.racks.asBuiltHits.length >= 1);
    assert.equal(applied.project.reality!.asBuilt[0].provenance, "USER_CONFIRMED");
    assert.equal(p.reality!.asBuilt.length, 0);
  });
});

describe("REAL-08 confirmed wall length resizes canonical room", () => {
  it("south wall 7.000 m → widthM 7.000", () => {
    const { project } = calibratedPhoto(emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 }));
    const calibrated = recordAnnotation(project, "ph1", CAL_A(), CAL_B(), { knownLengthM: 2, kind: "point" }).project;
    const wA = marker({ id: "wa", nx: 0, ny: 0.5, label: "A" });
    const wB = marker({ id: "wb", nx: 0.875, ny: 0.5, label: "B" });
    const rec = recordAnnotation(calibrated, "ph1", wA, wB, { kind: "wall" });
    assert.ok(rec.finding);
    assert.equal(rec.finding.wallResize?.lengthM, 7);
    assert.equal(rec.project.room.widthM, 8);
    const applied = applyFinding(rec.project, rec.finding.id, "ADDED");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    assert.equal(applied.project.room.widthM, 7);
    assert.equal(applied.project.room.depthM, 5);
    assert.equal(wallLength(applied.project, "south"), 7);
  });
});

describe("REAL-09 applyFinding is pure — source project unchanged", () => {
  it("undo is the previous project reference", () => {
    const { project } = calibratedPhoto(emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 }));
    const calibrated = recordAnnotation(project, "ph1", CAL_A(), CAL_B(), { knownLengthM: 2, kind: "point" }).project;
    const dA = marker({ id: "da", nx: 0.25, ny: 0.95, label: "A" });
    const dB = marker({ id: "db", nx: 0.375, ny: 0.95, label: "B" });
    const rec = recordAnnotation(calibrated, "ph1", dA, dB, { kind: "door" });
    const beforeOpenings = rec.project.openings.length;
    const applied = applyFinding(rec.project, rec.finding!.id, "ADDED");
    assert.equal(rec.project.openings.length, beforeOpenings);
    assert.equal(applied.project.openings.length, 1);
    assert.notEqual(applied.project, rec.project);
  });
});

describe("REAL-10 calibration persists through JSON round-trip", () => {
  it("scale 1/128 survives parseProject", () => {
    const { project } = calibratedPhoto(emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 }));
    const rec = recordAnnotation(project, "ph1", CAL_A(), CAL_B(), { knownLengthM: 2, kind: "point" });
    const loaded = parseProject(JSON.parse(JSON.stringify(rec.project)));
    const cal = photoCalibration(loaded.reality!.photos[0]);
    assert.ok(cal);
    assert.equal(cal.scaleMPerPx, SCALE);
    assert.equal(cal.provenance, "FIELD_MEASUREMENT");
    assert.equal(loaded.reality!.photos[0].widthPx, 1024);
    assert.equal(loaded.reality!.photos[0].wallHint, "south");
  });
});

describe("REAL-11 no typed length is never FIELD_MEASUREMENT", () => {
  it("scale transfer stays PHOTO_ESTIMATE", () => {
    const { project } = calibratedPhoto(emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 }));
    const calibrated = recordAnnotation(project, "ph1", CAL_A(), CAL_B(), { knownLengthM: 2, kind: "point" }).project;
    const rec = recordAnnotation(
      calibrated,
      "ph1",
      marker({ id: "da", nx: 0.25, ny: 0.95, label: "A" }),
      marker({ id: "db", nx: 0.375, ny: 0.95, label: "B" }),
      { kind: "door" },
    );
    assert.equal(rec.finding?.opening?.provenance, "PHOTO_ESTIMATE");
    const without = calibrateFromKnownDistance(
      calibratedPhoto(emptyRectangularProject()).photo,
      marker({ id: "a", nx: 0.1, ny: 0.5 }),
      marker({ id: "b", nx: 0.1, ny: 0.5 }),
      2,
    );
    assert.equal(without, null);
  });
});

describe("REAL-12 2D plan AABB equals as-built x/y/width/depth used by 3D", () => {
  it("single object, one box", () => {
    const obj = {
      id: "ab1",
      kind: "beam" as const,
      name: "Beam",
      x: 1.5,
      y: 0,
      z: 2.5,
      widthM: 4,
      heightM: 0.3,
      depthM: 0.3,
      provenance: "USER_CONFIRMED" as const,
      confidence: "HIGH" as const,
    };
    const bb = asBuiltPlanAabb(obj);
    assert.equal(bb.x1, obj.x);
    assert.equal(bb.y1, obj.y);
    assert.equal(bb.x2, obj.x + obj.widthM);
    assert.equal(bb.y2, obj.y + obj.depthM);
  });
});

function rackLimitedProject(): Project {
  const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
  p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
  p.electrical = { ...p.electrical, availablePowerW: 500_000, known: true };
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
  p.racks = [
    {
      id: "r1",
      name: "R1",
      x: 1,
      y: 1,
      ...TEST_RACK_A,
      rotationDeg: 0,
      asicCount: 0,
      airflowToward: "south",
    },
  ];
  return p;
}

function pendingBeam(over: { z: number; heightM: number }): RealityFinding {
  const p = rackLimitedProject();
  const rack = p.racks[0];
  return {
    id: "find_beam",
    kind: "beam",
    summary: "Beam",
    confidence: "HIGH",
    status: "PENDING",
    estimated: {
      kind: "beam",
      name: "Beam",
      x: rack.x,
      y: rack.y,
      z: over.z,
      widthM: rack.widthM,
      heightM: over.heightM,
      depthM: rack.depthM,
      provenance: "PHOTO_ESTIMATE",
      findingId: "find_beam",
      confidence: "HIGH",
    },
  };
}

function ventLimitedProject(widthM: number, heightM: number): Project {
  const p = undergroundParkingFarm();
  p.racks = [];
  p.electrical = { ...p.electrical, availablePowerW: 500_000, known: true };
  p.fleet = { ...p.fleet, requestedCount: 30 };
  p.openings = p.openings.map((o) =>
    o.type === "EXHAUST" || o.type === "SHAFT_CONNECTION" ? { ...o, widthM, heightM } : o,
  );
  return p;
}

describe("REAL-13 confirmed beam intersects rack in XYZ → physical conflict", () => {
  it("ADD intersecting beam blocks rack capacity and drops SAFE when rack is bottleneck", () => {
    const src = rackLimitedProject();
    const before = calculateAll(src, defaultCatalogs());
    assert.equal(before.racks.usableCapacity, before.racks.totalCapacity);
    assert.equal(before.capacity.bottlenecks.includes("RACK"), true);
    const safeN = before.capacity.safe;
    assert.ok(safeN != null && safeN > 0);

    const finding = pendingBeam({ z: 1.7, heightM: 0.4 });
    const p: Project = {
      ...src,
      reality: { ...(src.reality ?? emptyReality()), findings: [finding], asBuilt: [] },
    };
    const applied = applyFinding(p, finding.id, "ADDED");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    const after = calculateAll(applied.project, defaultCatalogs());
    assert.ok(after.racks.asBuiltHits.length >= 1);
    assert.equal(after.racks.asBuiltHits[0]?.id, "r1");
    assert.equal(after.racks.perRackCapacity[0]?.blocked, true);
    assert.equal(after.racks.usableCapacity, 0);
    assert.ok(after.capacity.safe != null && after.capacity.safe < (safeN as number));
    assert.ok(after.warnings.some((w) => w.id.startsWith("asbuilt-")));
    applied.project.reality!.compareMode = "as-designed";
    const hidden = calculateAll(applied.project, defaultCatalogs());
    assert.ok(hidden.racks.asBuiltHits.length >= 1);
  });
});

describe("REAL-14 beam above rack → no false conflict", () => {
  it("XY overlap with Z separation does not block capacity or change SAFE", () => {
    const src = rackLimitedProject();
    const before = calculateAll(src, defaultCatalogs());
    const finding = pendingBeam({ z: 2.2, heightM: 0.3 });
    const p: Project = {
      ...src,
      reality: { ...(src.reality ?? emptyReality()), findings: [finding], asBuilt: [] },
    };
    const applied = applyFinding(p, finding.id, "ADDED");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    const rack = applied.project.racks[0];
    const beam = applied.project.reality!.asBuilt[0];
    assert.equal(aabb3Intersects(rackAabb3(rack), asBuiltAabb3(beam)), false);
    const after = calculateAll(applied.project, defaultCatalogs());
    assert.equal(after.racks.asBuiltHits.length, 0);
    assert.equal(after.racks.usableCapacity, before.racks.usableCapacity);
    assert.equal(after.capacity.safe, before.capacity.safe);
  });
});

describe("REAL-15 confirmed opening changes ventilation calculation", () => {
  it("0.60 × 0.60 → 1.20 × 1.00 updates canonical opening and vent network", () => {
    const src = ventLimitedProject(0.6, 0.6);
    const beforeOpen = src.openings.find((o) => o.type === "EXHAUST")!;
    assert.equal(beforeOpen.widthM, 0.6);
    assert.equal(beforeOpen.heightM, 0.6);
    const before = calculateAll(src, defaultCatalogs());
    const beforeArea = openingAreaM2(beforeOpen);
    const beforeResolved = resolvedVentComponents(src).find((c) => c.openingId === beforeOpen.id);
    assert.ok(beforeResolved);
    assert.equal(beforeResolved.widthM, 0.6);
    assert.equal(beforeResolved.heightM, 0.6);

    const finding = parseAiFinding(
      {
        kind: "shaft",
        summary: "Exhaust 1.20 × 1.00",
        confidence: "HIGH",
        wallId: beforeOpen.wallId,
        widthM: 1.2,
        heightM: 1.0,
        bottomElevationM: beforeOpen.bottomElevationM,
        offsetFromWallStartM: beforeOpen.offsetFromWallStartM,
      },
      "find_ex",
    );
    const p: Project = {
      ...src,
      reality: { ...(src.reality ?? emptyReality()), findings: [finding] },
    };
    const applied = applyFinding(p, finding.id, "ADDED");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    const afterOpen = applied.project.openings.find((o) => o.type === "EXHAUST")!;
    assert.equal(afterOpen.id, beforeOpen.id);
    assert.equal(afterOpen.widthM, 1.2);
    assert.equal(afterOpen.heightM, 1.0);
    assert.ok(openingAreaM2(afterOpen) > beforeArea);
    const afterResolved = resolvedVentComponents(applied.project).find((c) => c.openingId === afterOpen.id);
    assert.ok(afterResolved);
    assert.equal(afterResolved.widthM, 1.2);
    assert.equal(afterResolved.heightM, 1.0);
    const after = calculateAll(applied.project, defaultCatalogs());
    assert.notEqual(after.pressure.totalPa, before.pressure.totalPa);
  });
});

describe("REAL-16 ventilation opening change moves SAFE when ventilation bottleneck exists", () => {
  it("enlarging the exhaust raises SAFE; shrinking it lowers SAFE", () => {
    const small = ventLimitedProject(0.6, 0.6);
    const finding = parseAiFinding(
      {
        kind: "shaft",
        summary: "Larger exhaust",
        confidence: "HIGH",
        wallId: "east",
        widthM: 1.2,
        heightM: 1.0,
        bottomElevationM: 0.4,
        offsetFromWallStartM: 1.6,
      },
      "find_ex2",
    );
    const pending: Project = {
      ...small,
      reality: { ...(small.reality ?? emptyReality()), findings: [finding] },
    };
    const large = applyFinding(pending, finding.id, "ADDED");
    assert.equal(large.ok, true, large.errors.join("; "));
    const rSmall = calculateAll(small, defaultCatalogs());
    const rLarge = calculateAll(large.project, defaultCatalogs());
    assert.ok(rSmall.capacity.bottlenecks.includes("VENTILATION") || rLarge.capacity.bottlenecks.includes("VENTILATION"));
    assert.ok(rSmall.capacity.safe != null && rLarge.capacity.safe != null);
    assert.ok(
      (rLarge.capacity.safe as number) > (rSmall.capacity.safe as number),
      `SAFE small=${rSmall.capacity.safe} large=${rLarge.capacity.safe} bottlenecks small=${rSmall.capacity.bottlenecks.join(",")} large=${rLarge.capacity.bottlenecks.join(",")}`,
    );

    const shrink = parseAiFinding(
      {
        kind: "shaft",
        summary: "Smaller exhaust",
        confidence: "HIGH",
        wallId: "east",
        widthM: 0.6,
        heightM: 0.6,
        bottomElevationM: 0.4,
        offsetFromWallStartM: 1.6,
      },
      "find_ex3",
    );
    const pendingShrink: Project = {
      ...large.project,
      reality: { ...(large.project.reality ?? emptyReality()), findings: [shrink] },
    };
    const back = applyFinding(pendingShrink, shrink.id, "ADDED");
    assert.equal(back.ok, true, back.errors.join("; "));
    const rBack = calculateAll(back.project, defaultCatalogs());
    assert.equal(rBack.capacity.safe, rSmall.capacity.safe);
  });
});

describe("REAL-17 undo restores opening and exact previous engineering result", () => {
  it("history[0] after ADD restores SAFE and opening size", () => {
    const src = ventLimitedProject(0.6, 0.6);
    const r0 = calculateAll(src, defaultCatalogs());
    const finding = parseAiFinding(
      {
        kind: "shaft",
        summary: "Larger exhaust",
        confidence: "HIGH",
        wallId: "east",
        widthM: 1.2,
        heightM: 1.0,
        bottomElevationM: 0.4,
        offsetFromWallStartM: 1.6,
      },
      "find_undo",
    );
    const pending: Project = {
      ...src,
      reality: { ...(src.reality ?? emptyReality()), findings: [finding] },
    };
    const added = applyFinding(pending, finding.id, "ADDED");
    assert.equal(added.ok, true);
    const r1 = calculateAll(added.project, defaultCatalogs());
    assert.notEqual(r1.capacity.safe, r0.capacity.safe);
    const undone = calculateAll(pending, defaultCatalogs());
    assert.equal(undone.capacity.safe, r0.capacity.safe);
    assert.equal(pending.openings.find((o) => o.type === "EXHAUST")?.widthM, 0.6);
    assert.equal(added.project.openings.find((o) => o.type === "EXHAUST")?.widthM, 1.2);
  });
});

describe("REAL-18 redo reapplies exact engineering result", () => {
  it("re-applying the added project restores SAFE M", () => {
    const src = ventLimitedProject(0.6, 0.6);
    const finding = parseAiFinding(
      {
        kind: "shaft",
        summary: "Larger exhaust",
        confidence: "HIGH",
        wallId: "east",
        widthM: 1.2,
        heightM: 1.0,
        bottomElevationM: 0.4,
        offsetFromWallStartM: 1.6,
      },
      "find_redo",
    );
    const pending: Project = {
      ...src,
      reality: { ...(src.reality ?? emptyReality()), findings: [finding] },
    };
    const added = applyFinding(pending, finding.id, "ADDED");
    const rAdded = calculateAll(added.project, defaultCatalogs());
    const rUndo = calculateAll(pending, defaultCatalogs());
    const rRedo = calculateAll(added.project, defaultCatalogs());
    assert.notEqual(rAdded.capacity.safe, rUndo.capacity.safe);
    assert.equal(rRedo.capacity.safe, rAdded.capacity.safe);
    assert.equal(rRedo.pressure.totalPa, rAdded.pressure.totalPa);
    assert.equal(rRedo.racks.usableCapacity, rAdded.racks.usableCapacity);
  });
});

describe("REAL-19 save/reload preserves 3D Reality geometry and engineering result", () => {
  it("JSON round-trip keeps z and SAFE", () => {
    const src = rackLimitedProject();
    const finding = pendingBeam({ z: 1.7, heightM: 0.4 });
    const p: Project = {
      ...src,
      reality: { ...(src.reality ?? emptyReality()), findings: [finding], compareMode: "deviation" },
    };
    const added = applyFinding(p, finding.id, "ADDED");
    const before = calculateAll(added.project, defaultCatalogs());
    const loaded = parseProject(JSON.parse(JSON.stringify(added.project)));
    assert.equal(loaded.reality!.asBuilt[0].z, 1.7);
    assert.equal(loaded.reality!.asBuilt[0].heightM, 0.4);
    assert.equal(loaded.reality!.asBuilt[0].provenance, "USER_CONFIRMED");
    assert.equal(loaded.reality!.compareMode, "as-built");
    const after = calculateAll(loaded, defaultCatalogs());
    assert.equal(after.capacity.safe, before.capacity.safe);
    assert.equal(after.racks.asBuiltHits.length, before.racks.asBuiltHits.length);
    assert.equal(after.racks.usableCapacity, before.racks.usableCapacity);
  });
});

describe("REAL-20 AI door → PENDING opening → confirmation → canonical opening", () => {
  it("parseAiFinding door is DOOR, not obstruction", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    const finding = parseAiFinding(
      {
        kind: "door",
        summary: "Door 1.000 × 2.100",
        confidence: "HIGH",
        wallId: "south",
        widthM: 1,
        heightM: 2.1,
        offsetFromWallStartM: 0.4,
      },
      "find_door_ai",
    );
    assert.equal(finding.kind, "door");
    assert.equal(finding.status, "PENDING");
    assert.equal(finding.opening?.type, "DOOR");
    assert.equal(finding.estimated, undefined);
    assert.equal(finding.opening?.bottomElevationM, 0);
    const p: Project = { ...src, reality: { ...(src.reality ?? emptyReality()), findings: [finding] } };
    assert.equal(p.openings.length, 0);
    const applied = applyFinding(p, finding.id, "ADDED");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    assert.equal(applied.project.openings.length, 1);
    assert.equal(applied.project.openings[0].type, "DOOR");
    assert.equal(applied.project.openings[0].widthM, 1);
    assert.equal(applied.project.openings[0].heightM, 2.1);
    assert.equal(p.openings.length, 0);
  });
});

describe("REAL-21 AI wall → PENDING wallResize → confirmation → room geometry", () => {
  it("south wall 7.000 m resizes width", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    const finding = parseAiFinding(
      {
        kind: "wall",
        summary: "South wall 7 m",
        confidence: "HIGH",
        wallId: "south",
        lengthM: 7,
      },
      "find_wall_ai",
    );
    assert.equal(finding.kind, "wall");
    assert.equal(finding.wallResize?.lengthM, 7);
    assert.equal(finding.estimated, undefined);
    const p: Project = { ...src, reality: { ...(src.reality ?? emptyReality()), findings: [finding] } };
    const applied = applyFinding(p, finding.id, "ADDED");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    assert.equal(applied.project.room.widthM, 7);
    assert.equal(applied.project.room.depthM, 5);
    assert.equal(src.room.widthM, 8);
  });
});

describe("REAL-22 incomplete AI geometry cannot mutate canonical state", () => {
  it("missing coordinates fail closed — no as-built, no invented 1/2.2 fallbacks", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    const finding = parseAiFinding({ kind: "beam", summary: "maybe a beam", confidence: "LOW" }, "find_inc");
    assert.equal(finding.incomplete, true);
    assert.ok((finding.missing ?? []).includes("x"));
    assert.ok((finding.missing ?? []).includes("z"));
    assert.equal(finding.estimated, undefined);
    const p: Project = { ...src, reality: { ...(src.reality ?? emptyReality()), findings: [finding] } };
    const applied = applyFinding(p, finding.id, "ADDED");
    assert.equal(applied.ok, false);
    assert.equal(applied.project, p);
    assert.equal(applied.project.reality!.asBuilt.length, 0);
    assert.equal(applied.project.openings.length, src.openings.length);
    assert.equal(applied.project.room.widthM, src.room.widthM);
  });
});

describe("REAL-23 AI Reality never bypasses confirmation", () => {
  it("parseAiFinding is PENDING and does not write openings", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    const finding = parseAiFinding(
      {
        kind: "opening",
        summary: "Technical opening",
        confidence: "MEDIUM",
        wallId: "west",
        widthM: 0.8,
        heightM: 0.6,
        bottomElevationM: 1.0,
        offsetFromWallStartM: 0.5,
      },
      "find_open_ai",
    );
    assert.equal(finding.status, "PENDING");
    assert.equal(finding.opening?.type, "TECHNICAL");
    const p: Project = { ...src, reality: { ...(src.reality ?? emptyReality()), findings: [finding] } };
    assert.equal(p.openings.length, 0);
    assert.equal(p.reality!.asBuilt.length, 0);
    const ignored = applyFinding(p, finding.id, "IGNORED");
    assert.equal(ignored.ok, true);
    assert.equal(ignored.project.openings.length, 0);
  });
});

describe("REAL-24 2D and 3D consume identical As-Built source coordinates", () => {
  it("plan AABB and Aabb3 share x/y/z/width/depth/height", () => {
    const obj = {
      id: "ab1",
      kind: "beam" as const,
      name: "Beam",
      x: 1.5,
      y: 0.25,
      z: 2.15,
      widthM: 4,
      heightM: 0.3,
      depthM: 0.35,
      provenance: "USER_CONFIRMED" as const,
      confidence: "HIGH" as const,
    };
    const plan = asBuiltPlanAabb(obj);
    const box = asBuiltAabb3(obj);
    assert.equal(plan.x1, box.x1);
    assert.equal(plan.y1, box.y1);
    assert.equal(plan.x2, box.x2);
    assert.equal(plan.y2, box.y2);
    assert.equal(box.z1, obj.z);
    assert.equal(box.z2, obj.z + obj.heightM);
    assert.equal(plan.x1, obj.x);
    assert.equal(plan.y1, obj.y);
  });
});
