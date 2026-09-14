import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyReality, type PhotoWallRegistration, type RealityPhotoMeta } from "../types.ts";
import { emptyRectangularProject } from "../../project/factory.ts";
import { parseProject } from "../../project/schema.ts";
import { saveScheduler } from "../../project/save-scheduler.ts";
import { useProjectStore } from "../../project/store.ts";
import { geometryFingerprint } from "../reality.ts";
import {
  defaultWallRegistration,
  isPhotoRegistered,
  nxFromRegisteredOffset,
  nyFromRegisteredElevation,
  registeredElevationFromNy,
  registeredOffsetFromNx,
  resolveOverlayWallOffset,
  SCALE_ONLY_POSITION_RU,
} from "../photo-registration.ts";
import { OBJECT_LOCKED_RU } from "../object-lock.ts";
import { applyPatchValidated } from "../upgrade.ts";

saveScheduler.setSave(async () => undefined);

function live() {
  return useProjectStore.getState();
}

function regPhoto(partial: Partial<PhotoWallRegistration> & { id?: string; scale?: number; widthPx?: number; heightPx?: number } = {}): RealityPhotoMeta {
  const widthPx = partial.widthPx ?? 800;
  const heightPx = partial.heightPx ?? 280;
  const scale = partial.scale ?? 0.01;
  const { id, scale: _s, widthPx: _w, heightPx: _h, ...regPartial } = partial;
  return {
    id: id ?? "ph1",
    name: "south.jpg",
    mime: "image/jpeg",
    createdAt: 1,
    notes: "",
    wallHint: regPartial.wallId ?? "south",
    widthPx,
    heightPx,
    calibration: {
      scaleMPerPx: scale,
      lengthM: widthPx * scale,
      aId: "a",
      bId: "b",
      provenance: "FIELD_MEASUREMENT",
    },
    wallRegistration: {
      ...defaultWallRegistration(regPartial.wallId ?? "south"),
      ...regPartial,
    },
    markers: [],
    overlays: [],
  };
}

function scaleOnlyPhoto(): RealityPhotoMeta {
  const p = regPhoto();
  return { ...p, wallRegistration: undefined };
}

function seeded(photo: RealityPhotoMeta) {
  const proj = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8, name: "QX-03R2" });
  proj.reality = { ...emptyReality(), photos: [photo] };
  return proj;
}

function approx(a: number, b: number, eps = 1e-9) {
  assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
}

describe("REG-01 full wall, forward direction", () => {
  it("nx=0 → 0 m, nx=1 → 8 m, nx=0.5 → 4 m", () => {
    const photo = regPhoto({ widthPx: 800, heightPx: 280, scale: 0.01, anchorNx: 0, wallOffsetM: 0, hDirection: 1 });
    approx(registeredOffsetFromNx(photo, 0)!, 0);
    approx(registeredOffsetFromNx(photo, 1)!, 8);
    approx(registeredOffsetFromNx(photo, 0.5)!, 4);
  });
});

describe("REG-02 cropped wall 2→7 on 8 m wall", () => {
  it("nx=0.5 maps to 4.5 m not 2.5 m", () => {
    const photo = regPhoto({ widthPx: 1000, heightPx: 500, scale: 0.005, anchorNx: 0, wallOffsetM: 2, hDirection: 1 });
    approx(registeredOffsetFromNx(photo, 0)!, 2);
    approx(registeredOffsetFromNx(photo, 0.5)!, 4.5);
    approx(registeredOffsetFromNx(photo, 1)!, 7);
    assert.notEqual(registeredOffsetFromNx(photo, 0.5), 2.5);
  });
});

describe("REG-03 same crop reversed 7→2", () => {
  it("center maps to 4.5 m", () => {
    const photo = regPhoto({ widthPx: 1000, heightPx: 500, scale: 0.005, anchorNx: 0, wallOffsetM: 7, hDirection: -1 });
    approx(registeredOffsetFromNx(photo, 0)!, 7);
    approx(registeredOffsetFromNx(photo, 0.5)!, 4.5);
    approx(registeredOffsetFromNx(photo, 1)!, 2);
  });
});

describe("REG-04 interior horizontal anchor", () => {
  it("anchorNx=0.25 wallOffset=3.25 maps and inverts", () => {
    const photo = regPhoto({ widthPx: 800, heightPx: 280, scale: 0.01, anchorNx: 0.25, wallOffsetM: 3.25, hDirection: 1 });
    const at025 = registeredOffsetFromNx(photo, 0.25)!;
    approx(at025, 3.25);
    const nx = nxFromRegisteredOffset(photo, 3.25)!;
    approx(nx, 0.25);
    const at0 = registeredOffsetFromNx(photo, 0)!;
    approx(at0, 3.25 - 0.25 * 8);
  });
});

describe("REG-05 floor visible above photo bottom", () => {
  it("anchorNy=0.82 elevation=0 is the floor line", () => {
    const photo = regPhoto({
      widthPx: 800,
      heightPx: 800,
      scale: 0.01,
      anchorNy: 0.82,
      elevationM: 0,
      vDirection: -1,
    });
    approx(registeredElevationFromNy(photo, 0.82)!, 0);
    const above = registeredElevationFromNy(photo, 0.82 - 0.1)!;
    assert.ok(above! > 0);
    const below = registeredElevationFromNy(photo, 1)!;
    assert.ok(below! < 0);
  });
});

describe("REG-06 nonzero vertical reference elevation", () => {
  it("interior mark at 1.5 m inverts", () => {
    const photo = regPhoto({
      widthPx: 800,
      heightPx: 800,
      scale: 0.01,
      anchorNy: 0.4,
      elevationM: 1.5,
      vDirection: -1,
    });
    approx(registeredElevationFromNy(photo, 0.4)!, 1.5);
    const ny = nyFromRegisteredElevation(photo, 1.5)!;
    approx(ny, 0.4);
  });
});

describe("REG-07 scale exists, registration absent → size allowed, absolute APPLY rejected", () => {
  it("visual meters work; APPLY invents no offset", () => {
    const photo = scaleOnlyPhoto();
    live().loadProject(seeded(photo));
    const add = live().addPhotoOverlay("ph1", "door", 0.3, 0.7);
    assert.equal(add.ok, true);
    live().updatePhotoOverlay("ph1", add.overlay!.id, { nw: add.overlay!.nw * 1.2, nh: add.overlay!.nh });
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    assert.ok(ov.widthM > 0);
    const applied = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(applied.ok, false);
    assert.ok(applied.errors.some((e) => e.includes("не привязано") || e.includes(SCALE_ONLY_POSITION_RU)));
    assert.equal(live().project.openings.length, 0);
    assert.equal(ov.applied, false);
  });
});

describe("REG-08 save/reload registration", () => {
  it("parseProject keeps wallRegistration", () => {
    const photo = regPhoto({ anchorNx: 0, wallOffsetM: 2, hDirection: 1, anchorNy: 0.82, elevationM: 0 });
    const p = seeded(photo);
    const parsed = parseProject(JSON.parse(JSON.stringify(p)));
    const r = parsed.reality!.photos[0]!.wallRegistration;
    assert.ok(r);
    assert.equal(r!.wallOffsetM, 2);
    assert.equal(r!.anchorNy, 0.82);
    assert.equal(isPhotoRegistered(parsed.reality!.photos[0]!), true);
  });
});

describe("REG-09 Undo/Redo registration", () => {
  it("undo restores absent registration", () => {
    live().loadProject(seeded(scaleOnlyPhoto()));
    const before = live().project.reality!.photos[0]!.wallRegistration;
    assert.equal(before, undefined);
    live().setPhotoWallRegistration("ph1", defaultWallRegistration("south"));
    assert.ok(live().project.reality!.photos[0]!.wallRegistration);
    live().undo();
    assert.equal(live().project.reality!.photos[0]!.wallRegistration, undefined);
    live().redo();
    assert.ok(live().project.reality!.photos[0]!.wallRegistration);
  });
});

describe("REG-10 canonical → photo inverse mapping after registration", () => {
  it("forward then inverse recovers nx", () => {
    const photo = regPhoto({ anchorNx: 0.2, wallOffsetM: 1.6, hDirection: 1 });
    for (const nx of [0, 0.2, 0.5, 0.9, 1]) {
      const off = registeredOffsetFromNx(photo, nx)!;
      const back = nxFromRegisteredOffset(photo, off)!;
      approx(back, nx, 1e-9);
    }
  });
});

describe("REG-11 object reassigned to another wall → OUT_OF_PHOTO_PLANE", () => {
  it("south-registered exhaust moved to north", () => {
    live().loadProject(seeded(regPhoto()));
    live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.7);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true, live().lastMutationError ?? "");
    const id = live().project.openings[0]!.id;
    assert.equal(live().reassignOpeningWall(id, "north").ok, true);
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(ov.planeStatus, "OUT_OF_PHOTO_PLANE");
  });
});

describe("REG-12 reassigned back → correct registered position restored", () => {
  it("south offset maps to the same nx", () => {
    live().loadProject(seeded(regPhoto({ anchorNx: 0, wallOffsetM: 2, hDirection: 1, widthPx: 1000, scale: 0.005 })));
    live().addPhotoOverlay("ph1", "exhaust", 0.4, 0.7);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true, live().lastMutationError ?? "");
    const opening = live().project.openings[0]!;
    const nxBefore = live().project.reality!.photos[0]!.overlays![0]!.nx;
    live().reassignOpeningWall(opening.id, "north");
    live().reassignOpeningWall(opening.id, "south", opening.offsetFromWallStartM);
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(ov.planeStatus, "ON_PLANE");
    approx(ov.nx, nxBefore, 1e-6);
  });
});

function applyDoorAtOffset(rawOffsetM: number, widthM = 1) {
  const photo = regPhoto({ widthPx: 800, scale: 0.01, anchorNx: 0, wallOffsetM: 0, hDirection: 1 });
  const nx = rawOffsetM / 8;
  live().loadProject(seeded(photo));
  const add = live().addPhotoOverlay("ph1", "door", 0.2, 0.7);
  live().updatePhotoOverlay("ph1", add.overlay!.id, { nx, ny: 0.2, nw: widthM / 8, nh: 2.1 / 2.8, widthM, heightM: 2.1, metricSource: "OWNER_ENTERED" });
  const fp = geometryFingerprint(live().project);
  const applied = live().applyPhotoOverlaysToModel("ph1");
  return { applied, fp, project: live().project };
}

describe("PLACE-01 raw offset 6.5 width 1 on 8 m wall is valid", () => {
  it("commits", () => {
    const { applied, project } = applyDoorAtOffset(6.5, 1);
    assert.equal(applied.ok, true, applied.errors.join("; "));
    approx(project.openings[0]!.offsetFromWallStartM, 6.5, 1e-6);
  });
});

describe("PLACE-02 raw offset 7.0 exact boundary is valid", () => {
  it("commits", () => {
    const { applied, project } = applyDoorAtOffset(7.0, 1);
    assert.equal(applied.ok, true, applied.errors.join("; "));
    approx(project.openings[0]!.offsetFromWallStartM, 7.0, 1e-6);
  });
});

describe("PLACE-03 raw offset 7.01 is REJECT not clamp", () => {
  it("canonical unchanged", () => {
    const { applied, fp, project } = applyDoorAtOffset(7.01, 1);
    assert.equal(applied.ok, false);
    assert.equal(project.openings.length, 0);
    assert.equal(geometryFingerprint(project), fp);
    assert.ok(!applied.errors.some((e) => e.includes("7.00")));
  });
});

describe("PLACE-04 raw offset -0.01 is REJECT", () => {
  it("canonical unchanged", () => {
    const { applied, project } = applyDoorAtOffset(-0.01, 1);
    assert.equal(applied.ok, false);
    assert.equal(project.openings.length, 0);
  });
});

describe("PLACE-05 photo span larger than wall nx → 9 m REJECT not 7 m", () => {
  it("does not silent-clamp to wall end", () => {
    const photo = regPhoto({ widthPx: 1000, scale: 0.01, anchorNx: 0, wallOffsetM: 0, hDirection: 1 });
    live().loadProject(seeded(photo));
    const add = live().addPhotoOverlay("ph1", "door", 0.2, 0.7);
    live().updatePhotoOverlay("ph1", add.overlay!.id, { nx: 0.9, widthM: 1, heightM: 2.1, metricSource: "OWNER_ENTERED" });
    const raw = resolveOverlayWallOffset(live().project.reality!.photos[0]!, 0.9, "south", live().project);
    assert.equal(raw.ok, true);
    assert.ok((raw as { offsetM: number }).offsetM > 8);
    const applied = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(applied.ok, false);
    assert.equal(live().project.openings.length, 0);
  });
});

describe("PLACE-06 failed atomic APPLY → zero canonical objects", () => {
  it("fingerprint unchanged", () => {
    const photo = regPhoto();
    live().loadProject(seeded(photo));
    live().addPhotoOverlay("ph1", "intake", 0.2, 0.7);
    live().addPhotoOverlay("ph1", "exhaust", 0.45, 0.7);
    const bad = live().addPhotoOverlay("ph1", "door", 0.2, 0.7);
    live().updatePhotoOverlay("ph1", bad.overlay!.id, { nx: 0.95, widthM: 1, heightM: 2.1, metricSource: "OWNER_ENTERED" });
    const fp = geometryFingerprint(live().project);
    const applied = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(applied.ok, false);
    assert.equal(applied.appliedIds.length, 0);
    assert.equal(live().project.openings.length, 0);
    assert.equal(geometryFingerprint(live().project), fp);
  });
});

function linkedExhaust(locked = false) {
  live().loadProject(seeded(regPhoto()));
  live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.7);
  assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true, live().lastMutationError ?? "");
  const opening = live().project.openings[0]!;
  if (locked) {
    const next = {
      ...live().project,
      openings: live().project.openings.map((o) => (o.id === opening.id ? { ...o, locked: true } : o)),
      lockedObjectIds: [opening.id],
    };
    live().loadProject(next);
  }
  return live().project.reality!.photos[0]!.overlays![0]!;
}

describe("LOCKDEL-01 linked unlocked exhaust delete succeeds", () => {
  it("canonical and overlay gone", () => {
    const ov = linkedExhaust(false);
    const past = live().past.length;
    const r = live().deleteLinkedFromModel("ph1", ov.id);
    assert.equal(r.ok, true);
    assert.equal(live().project.openings.length, 0);
    assert.equal((live().project.reality!.photos[0]!.overlays ?? []).length, 0);
    assert.equal(live().past.length, past + 1);
  });
});

describe("LOCKDEL-02 linked locked door explicit REJECT", () => {
  it("ok=false and message", () => {
    live().loadProject(seeded(regPhoto()));
    live().addPhotoOverlay("ph1", "door", 0.3, 0.55);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true, live().lastMutationError ?? "");
    const id = live().project.openings[0]!.id;
    live().loadProject({
      ...live().project,
      openings: live().project.openings.map((o) => ({ ...o, locked: true })),
      lockedObjectIds: [id],
    });
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    const r = live().deleteLinkedFromModel("ph1", ov.id);
    assert.equal(r.ok, false);
    assert.equal(r.reason, OBJECT_LOCKED_RU);
  });
});

describe("LOCKDEL-03 canonical fingerprint unchanged", () => {
  it("locked delete does not mutate geometry", () => {
    live().loadProject(seeded(regPhoto()));
    live().addPhotoOverlay("ph1", "door", 0.3, 0.55);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const id = live().project.openings[0]!.id;
    live().loadProject({
      ...live().project,
      openings: live().project.openings.map((o) => ({ ...o, locked: true })),
      lockedObjectIds: [id],
    });
    const fp = geometryFingerprint(live().project);
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    live().deleteLinkedFromModel("ph1", ov.id);
    assert.equal(geometryFingerprint(live().project), fp);
  });
});

describe("LOCKDEL-04 photo overlay unchanged", () => {
  it("overlay still linked", () => {
    live().loadProject(seeded(regPhoto()));
    live().addPhotoOverlay("ph1", "door", 0.3, 0.55);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const id = live().project.openings[0]!.id;
    live().loadProject({
      ...live().project,
      openings: live().project.openings.map((o) => ({ ...o, locked: true })),
      lockedObjectIds: [id],
    });
    const before = JSON.stringify(live().project.reality!.photos[0]!.overlays);
    live().deleteLinkedFromModel("ph1", live().project.reality!.photos[0]!.overlays![0]!.id);
    assert.equal(JSON.stringify(live().project.reality!.photos[0]!.overlays), before);
  });
});

describe("LOCKDEL-05 linkedObjectId unchanged", () => {
  it("link survives rejected delete", () => {
    live().loadProject(seeded(regPhoto()));
    live().addPhotoOverlay("ph1", "door", 0.3, 0.55);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const id = live().project.openings[0]!.id;
    live().loadProject({
      ...live().project,
      openings: live().project.openings.map((o) => ({ ...o, locked: true })),
      lockedObjectIds: [id],
    });
    const ovId = live().project.reality!.photos[0]!.overlays![0]!.linkedObjectId;
    live().deleteLinkedFromModel("ph1", live().project.reality!.photos[0]!.overlays![0]!.id);
    assert.equal(live().project.reality!.photos[0]!.overlays![0]!.linkedObjectId, ovId);
  });
});

describe("LOCKDEL-06 Undo history does not receive a fake delete", () => {
  it("past length unchanged", () => {
    live().loadProject(seeded(regPhoto()));
    live().addPhotoOverlay("ph1", "door", 0.3, 0.55);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const id = live().project.openings[0]!.id;
    live().loadProject({
      ...live().project,
      openings: live().project.openings.map((o) => ({ ...o, locked: true })),
      lockedObjectIds: [id],
    });
    const past = live().past.length;
    live().deleteLinkedFromModel("ph1", live().project.reality!.photos[0]!.overlays![0]!.id);
    assert.equal(live().past.length, past);
  });
});

describe("LOCKDEL-07 same lock semantics across 2D/3D/AI", () => {
  it("deleteSelected and AI patch refuse locked opening", () => {
    live().loadProject(seeded(regPhoto()));
    live().addPhotoOverlay("ph1", "door", 0.3, 0.55);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const id = live().project.openings[0]!.id;
    live().loadProject({
      ...live().project,
      openings: live().project.openings.map((o) => ({ ...o, locked: true })),
      lockedObjectIds: [id],
    });
    live().select([id]);
    const d2 = live().deleteSelected();
    assert.equal(d2.ok, false);
    assert.equal(live().project.openings.length, 1);
    const patch = applyPatchValidated(live().project, { openings: [] });
    assert.equal(patch.ok, false);
    assert.ok(patch.errors.includes(OBJECT_LOCKED_RU));
    assert.equal(live().project.openings.length, 1);
  });
});

describe("REG-07b owner-entered offset allows APPLY without registration", () => {
  it("explicit offset is not invented from nx", () => {
    live().loadProject(seeded(scaleOnlyPhoto()));
    const add = live().addPhotoOverlay("ph1", "door", 0.9, 0.7);
    live().updatePhotoOverlay("ph1", add.overlay!.id, { ownerOffsetM: 2, widthM: 1, heightM: 2.1, metricSource: "OWNER_ENTERED" });
    const applied = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    approx(live().project.openings[0]!.offsetFromWallStartM, 2, 1e-6);
  });
});
