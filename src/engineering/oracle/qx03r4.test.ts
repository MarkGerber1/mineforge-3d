/**
 * QX-03R4: Canonical → Photo must not invent nx; typed lock identity.
 * R15 / R16. Does not reopen QX-03R3 residuals except these defects.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { emptyReality, type PhotoWallRegistration, type RealityPhotoMeta } from "../types.ts";
import { emptyRectangularProject } from "../../project/factory.ts";
import { parseProject } from "../../project/schema.ts";
import { saveScheduler } from "../../project/save-scheduler.ts";
import { useProjectStore } from "../../project/store.ts";
import { geometryFingerprint } from "../reality.ts";
import { defaultWallRegistration, nxFromRegisteredOffset } from "../photo-registration.ts";
import {
  OBJECT_LOCKED_RU,
  lockedCanonicalDeletions,
  typedCanonicalKey,
  typedCanonicalIds,
} from "../object-lock.ts";
import { applyPatchValidated } from "../upgrade.ts";
import { FAN_STRONG } from "../../equipment/fan-catalog.ts";
import { PHOTO_UNREGISTERED_RU, reconcileLinkedReality } from "../photo-reconcile.ts";

saveScheduler.setSave(async () => undefined);

const ROOT = dirname(fileURLToPath(import.meta.url));

function live() {
  return useProjectStore.getState();
}

function uncalPhoto(): RealityPhotoMeta {
  return {
    id: "ph1",
    name: "south.jpg",
    mime: "image/jpeg",
    createdAt: 1,
    notes: "",
    wallHint: "south",
    widthPx: 1000,
    heightPx: 800,
    markers: [],
    overlays: [],
  };
}

function scaleOnlyPhoto(): RealityPhotoMeta {
  return {
    ...uncalPhoto(),
    calibration: {
      scaleMPerPx: 0.01,
      lengthM: 10,
      aId: "a",
      bId: "b",
      provenance: "FIELD_MEASUREMENT",
    },
  };
}

function registeredPhoto(reg: Partial<PhotoWallRegistration> = {}, size?: { widthPx: number; heightPx: number; scale: number }): RealityPhotoMeta {
  const widthPx = size?.widthPx ?? 800;
  const heightPx = size?.heightPx ?? 280;
  const scale = size?.scale ?? 0.01;
  return {
    id: "ph1",
    name: "south.jpg",
    mime: "image/jpeg",
    createdAt: 1,
    notes: "",
    wallHint: "south",
    widthPx,
    heightPx,
    calibration: {
      scaleMPerPx: scale,
      lengthM: widthPx * scale,
      aId: "a",
      bId: "b",
      provenance: "FIELD_MEASUREMENT",
    },
    wallRegistration: { ...defaultWallRegistration("south"), ...reg },
    markers: [
      { id: "a", nx: 0.1, ny: 0.5, kind: "point", label: "A", pairId: "b" },
      { id: "b", nx: 0.9, ny: 0.5, kind: "point", label: "B", pairId: "a", lengthM: widthPx * scale },
    ],
    overlays: [],
  };
}

function seeded(photo: RealityPhotoMeta) {
  const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8, name: "QX-03R4" });
  p.reality = { ...emptyReality(), photos: [photo] };
  return p;
}

function applyLinkedDoor(photo: RealityPhotoMeta, nx: number, extras?: { ownerOffsetM?: number; ownerElevationM?: number }) {
  live().loadProject(seeded(photo));
  const add = live().addPhotoOverlay("ph1", "door", nx, 0.85);
  assert.equal(add.ok, true);
  const patch: { nx: number; ny?: number; ownerOffsetM?: number; ownerElevationM?: number } = { nx };
  if (extras?.ownerOffsetM != null) patch.ownerOffsetM = extras.ownerOffsetM;
  if (extras?.ownerElevationM != null) patch.ownerElevationM = extras.ownerElevationM;
  live().updatePhotoOverlay("ph1", add.overlay!.id, patch);
  const r = live().applyPhotoOverlaysToModel("ph1");
  assert.equal(r.ok, true, r.errors.join("; ") || live().lastMutationError || "APPLY failed");
  return live().project.reality!.photos[0]!.overlays![0]!;
}

function sameIdFan() {
  return {
    id: "same-id",
    specId: FAN_STRONG.id,
    name: "F1",
    x: 1.2,
    y: 1.2,
    arrangement: "single" as const,
    count: 1,
    dirtyFilter: false,
  };
}

function sameIdAsBuilt() {
  return {
    id: "same-id",
    kind: "column" as const,
    name: "C1",
    x: 6,
    y: 3,
    z: 0,
    widthM: 0.4,
    heightM: 2.8,
    depthM: 0.4,
    provenance: "PHOTO_ESTIMATE" as const,
    confidence: "MEDIUM" as const,
  };
}

describe("R15-00 no Canonical→Photo proportional fallback", () => {
  it("photo-reconcile has no offset/wallLength invention and no nxFromOffset", () => {
    const reconcile = readFileSync(join(ROOT, "../photo-reconcile.ts"), "utf8");
    assert.equal(reconcile.includes("function nxFromOffset"), false);
    assert.equal(/offsetM\s*\/\s*(L|wallLength)/.test(reconcile), false);
    assert.equal(reconcile.includes("wallLength("), false);
    assert.equal(reconcile.includes("UNCALIBRATED_PROPORTIONAL"), false);
    assert.ok(reconcile.includes("UNREGISTERED"));
    assert.ok(reconcile.includes(PHOTO_UNREGISTERED_RU));
  });
});

describe("R15-01 uncalibrated unregistered linked overlay keeps nx", () => {
  it("canonical offset=2 on 8m wall does not write nx=0.25", () => {
    const ov = applyLinkedDoor(uncalPhoto(), 0.8, { ownerOffsetM: 2, ownerElevationM: 0 });
    assert.equal(live().project.openings[0]!.offsetFromWallStartM, 2);
    assert.equal(ov.nx, 0.8);
    assert.notEqual(ov.nx, 2 / 8);
    assert.equal(ov.linkedObjectId, live().project.openings[0]!.id);
  });
});

describe("R15-02 unregistered path is not ON_PLANE", () => {
  it("marks UNREGISTERED, not synchronized", () => {
    const ov = applyLinkedDoor(uncalPhoto(), 0.8, { ownerOffsetM: 2, ownerElevationM: 0 });
    assert.equal(ov.planeStatus, "UNREGISTERED");
    assert.notEqual(ov.planeStatus, "ON_PLANE");
  });
});

describe("R15-03 scale-only unregistered has no inverse absolute mapping", () => {
  it("nx stays visual; not 2/8", () => {
    const ov = applyLinkedDoor(scaleOnlyPhoto(), 0.8, { ownerOffsetM: 2, ownerElevationM: 0 });
    assert.equal(live().project.openings[0]!.offsetFromWallStartM, 2);
    assert.equal(ov.nx, 0.8);
    assert.notEqual(ov.nx, 2 / 8);
    assert.equal(ov.planeStatus, "UNREGISTERED");
  });
});

describe("R15-04 registered full-wall inverse mapping works", () => {
  it("overlay nx follows registration inverse of canonical offset", () => {
    applyLinkedDoor(registeredPhoto(), 0.3);
    const opening = live().project.openings[0]!;
    const photo = live().project.reality!.photos[0]!;
    const ov = photo.overlays![0]!;
    const expected = nxFromRegisteredOffset(photo, opening.offsetFromWallStartM);
    assert.ok(expected != null);
    assert.ok(Math.abs(ov.nx - expected!) < 1e-6);
    assert.equal(ov.planeStatus, "ON_PLANE");
    live().updateOpening(opening.id, { offsetFromWallStartM: 2 });
    const after = live().project.reality!.photos[0]!.overlays![0]!;
    const expected2 = nxFromRegisteredOffset(live().project.reality!.photos[0]!, 2);
    assert.ok(Math.abs(after.nx - expected2!) < 1e-6);
    assert.equal(after.planeStatus, "ON_PLANE");
  });
});

describe("R15-05 registered cropped inverse mapping works", () => {
  it("offset 4 m on crop 2→7 is not 4/8", () => {
    const photo = registeredPhoto(
      { anchorNx: 0, wallOffsetM: 2, hDirection: 1 },
      { widthPx: 500, heightPx: 280, scale: 0.01 },
    );
    applyLinkedDoor(photo, 0.4);
    const opening = live().project.openings[0]!;
    live().updateOpening(opening.id, { offsetFromWallStartM: 4 });
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    const expected = nxFromRegisteredOffset(live().project.reality!.photos[0]!, 4);
    assert.ok(expected != null);
    assert.ok(Math.abs(ov.nx - expected!) < 1e-6);
    assert.notEqual(ov.nx, 4 / 8);
    assert.equal(ov.planeStatus, "ON_PLANE");
  });
});

describe("R15-06 registered reversed inverse mapping works", () => {
  it("hDirection −1 inverts offset onto photo nx", () => {
    const photo = registeredPhoto(
      { anchorNx: 0, wallOffsetM: 7, hDirection: -1 },
      { widthPx: 500, heightPx: 280, scale: 0.01 },
    );
    applyLinkedDoor(photo, 0.4);
    const opening = live().project.openings[0]!;
    live().updateOpening(opening.id, { offsetFromWallStartM: 4 });
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    const expected = nxFromRegisteredOffset(live().project.reality!.photos[0]!, 4);
    assert.ok(expected != null);
    assert.ok(Math.abs(ov.nx - expected!) < 1e-6);
    assert.ok(expected! > 0.5);
    assert.equal(ov.planeStatus, "ON_PLANE");
  });
});

describe("R15-07 remove registration → unsynchronized, not invented", () => {
  it("canonical stays; overlay nx preserved and UNREGISTERED", () => {
    applyLinkedDoor(registeredPhoto(), 0.3);
    const opening = live().project.openings[0]!;
    const beforeNx = live().project.reality!.photos[0]!.overlays![0]!.nx;
    const beforeOffset = opening.offsetFromWallStartM;
    const fp = geometryFingerprint(live().project);
    const r = live().setPhotoWallRegistration("ph1", undefined);
    assert.equal(r.ok, true, r.reason);
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(ov.nx, beforeNx);
    assert.equal(ov.planeStatus, "UNREGISTERED");
    assert.equal(live().project.openings[0]!.offsetFromWallStartM, beforeOffset);
    assert.equal(live().project.openings.length, 1);
    assert.equal(geometryFingerprint(live().project), fp);
    live().updateOpening(opening.id, { offsetFromWallStartM: 6 });
    const afterMove = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(live().project.openings[0]!.offsetFromWallStartM, 6);
    assert.equal(afterMove.nx, beforeNx);
    assert.notEqual(afterMove.nx, 6 / 8);
    assert.equal(afterMove.planeStatus, "UNREGISTERED");
  });
});

describe("R15-08 restore registration → overlay reprojects", () => {
  it("same registration restores ON_PLANE inverse nx", () => {
    applyLinkedDoor(registeredPhoto(), 0.3);
    const offset = live().project.openings[0]!.offsetFromWallStartM;
    live().setPhotoWallRegistration("ph1", undefined);
    assert.equal(live().project.reality!.photos[0]!.overlays![0]!.planeStatus, "UNREGISTERED");
    live().setPhotoWallRegistration("ph1", defaultWallRegistration("south"));
    const photo = live().project.reality!.photos[0]!;
    const ov = photo.overlays![0]!;
    const expected = nxFromRegisteredOffset(photo, offset);
    assert.ok(Math.abs(ov.nx - expected!) < 1e-6);
    assert.equal(ov.planeStatus, "ON_PLANE");
  });
});

describe("R15-09 undo/redo registration preserves sync state", () => {
  it("undo restore ON_PLANE; redo UNREGISTERED", () => {
    applyLinkedDoor(registeredPhoto(), 0.3);
    const onPlaneNx = live().project.reality!.photos[0]!.overlays![0]!.nx;
    live().setPhotoWallRegistration("ph1", undefined);
    assert.equal(live().project.reality!.photos[0]!.overlays![0]!.planeStatus, "UNREGISTERED");
    live().undo();
    const undone = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(undone.planeStatus, "ON_PLANE");
    assert.equal(undone.nx, onPlaneNx);
    live().redo();
    const redone = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(redone.planeStatus, "UNREGISTERED");
    assert.equal(redone.nx, onPlaneNx);
  });
});

describe("R15-10 save/reload preserves UNREGISTERED", () => {
  it("parseProject keeps nx and planeStatus", () => {
    applyLinkedDoor(uncalPhoto(), 0.8, { ownerOffsetM: 2, ownerElevationM: 0 });
    const json = JSON.parse(JSON.stringify(live().project));
    const loaded = parseProject(json);
    const ov = loaded.reality!.photos[0]!.overlays![0]!;
    assert.equal(ov.nx, 0.8);
    assert.equal(ov.planeStatus, "UNREGISTERED");
    assert.equal(loaded.openings[0]!.offsetFromWallStartM, 2);
    const again = reconcileLinkedReality(loaded);
    assert.equal(again.reality!.photos[0]!.overlays![0]!.nx, 0.8);
    assert.equal(again.reality!.photos[0]!.overlays![0]!.planeStatus, "UNREGISTERED");
  });
});

describe("R16-01 typed identity: locked fan not satisfied by asBuilt same raw id", () => {
  it("fans:[] + asBuilt same-id REJECT", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8, name: "R16" });
    p.fans = [sameIdFan()];
    p.lockedObjectIds = ["same-id"];
    p.reality = { ...emptyReality() };
    const before = lockedCanonicalDeletions(p, p);
    assert.equal(before.length, 0);
    const patch = applyPatchValidated(p, { fans: [], reality: { asBuilt: [sameIdAsBuilt()] } });
    assert.equal(patch.ok, false);
    assert.ok(patch.errors.includes(OBJECT_LOCKED_RU));
    assert.equal(p.fans.length, 1);
    assert.equal(p.reality!.asBuilt.length, 0);
    const keys = typedCanonicalIds(p).map((t) => typedCanonicalKey(t.kind, t.id));
    assert.ok(keys.includes("fan:same-id"));
    assert.equal(keys.includes("asBuilt:same-id"), false);
  });
});

describe("R16-02 inverse: locked asBuilt not satisfied by fan same raw id", () => {
  it("asBuilt:[] + fan same-id REJECT", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8, name: "R16" });
    p.reality = { ...emptyReality(), asBuilt: [sameIdAsBuilt()] };
    p.lockedObjectIds = ["same-id"];
    const patch = applyPatchValidated(p, { fans: [sameIdFan()], reality: { asBuilt: [] } });
    assert.equal(patch.ok, false);
    assert.ok(patch.errors.includes(OBJECT_LOCKED_RU));
    assert.equal(p.reality!.asBuilt.length, 1);
    assert.equal(p.fans.length, 0);
  });
});

describe("R16-03 unlocked same-raw-id replacement remains allowed", () => {
  it("unlocked fan may be replaced by asBuilt with the same raw id", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8, name: "R16" });
    p.fans = [sameIdFan()];
    p.lockedObjectIds = [];
    const patch = applyPatchValidated(p, { fans: [], reality: { asBuilt: [sameIdAsBuilt()] } });
    assert.equal(patch.ok, true, patch.errors.join("; "));
    assert.equal(patch.project.fans.length, 0);
    assert.equal(patch.project.reality!.asBuilt[0]!.id, "same-id");
  });
});
