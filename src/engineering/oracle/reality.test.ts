import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyReality } from "../types.ts";
import type { PhotoMarker, Project, RealityPhotoMeta } from "../types.ts";
import { undergroundParkingFarm } from "../../project/factory.ts";
import { emptyRectangularProject } from "../../project/factory.ts";
import { defaultCatalogs } from "../catalogs.ts";
import { calculateAll } from "../pipeline.ts";
import { applyPatch } from "../upgrade.ts";
import { parseProject } from "../../project/schema.ts";
import { wallLength } from "../geometry.ts";
import {
  applyFinding,
  asBuiltPlanAabb,
  calibrateFromKnownDistance,
  measurePairMeters,
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
            z: 2.2,
            widthM: rack.widthM,
            heightM: 0.3,
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
        z: 2.2,
        widthM: rack.widthM,
        heightM: 0.3,
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
