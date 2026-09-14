/**
 * QX-03R3: fail-closed photo absolute position, complete lock policy.
 * R11 / R12 / R14 oracle. R13 cancel semantics are WebKit canvas E2E.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { emptyReality, type RealityPhotoMeta } from "../types.ts";
import { emptyRectangularProject } from "../../project/factory.ts";
import { parseProject } from "../../project/schema.ts";
import { saveScheduler } from "../../project/save-scheduler.ts";
import { useProjectStore } from "../../project/store.ts";
import { geometryFingerprint } from "../reality.ts";
import {
  ABSOLUTE_ELEVATION_RU,
  ABSOLUTE_POSITION_RU,
  defaultWallRegistration,
  registeredOffsetFromNx,
  resolveOverlayWallOffset,
  SCALE_ONLY_POSITION_RU,
} from "../photo-registration.ts";
import { OBJECT_LOCKED_RU } from "../object-lock.ts";
import { applyPatchValidated } from "../upgrade.ts";
import { FAN_STRONG } from "../../equipment/fan-catalog.ts";

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

function seeded(photo: RealityPhotoMeta) {
  const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8, name: "QX-03R3" });
  p.reality = { ...emptyReality(), photos: [photo] };
  return p;
}

function fp() {
  return geometryFingerprint(live().project);
}

describe("R11-01 uncalibrated unregistered door APPLY REJECT", () => {
  it("no ownerOffset → zero openings", () => {
    live().loadProject(seeded(uncalPhoto()));
    live().addPhotoOverlay("ph1", "door", 0.3, 0.5);
    const before = fp();
    const r = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("привяз") || e.includes(ABSOLUTE_POSITION_RU)));
    assert.equal(live().project.openings.length, 0);
    assert.equal(fp(), before);
  });
});

describe("R11-02 uncalibrated unregistered rack APPLY REJECT", () => {
  it("no ownerOffset → zero racks", () => {
    live().loadProject(seeded(uncalPhoto()));
    live().addPhotoOverlay("ph1", "rack", 0.2, 0.5);
    const r = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(r.ok, false);
    assert.equal(live().project.racks.length, 0);
  });
});

describe("R11-03 uncalibrated unregistered fan APPLY REJECT", () => {
  it("no ownerOffset → zero fans", () => {
    live().loadProject(seeded(uncalPhoto()));
    live().addPhotoOverlay("ph1", "fan", 0.6, 0.5);
    const r = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(r.ok, false);
    assert.equal(live().project.fans.length, 0);
  });
});

describe("R11-04 uncalibrated unregistered column APPLY REJECT", () => {
  it("no ownerOffset → zero asBuilt", () => {
    live().loadProject(seeded(uncalPhoto()));
    live().addPhotoOverlay("ph1", "column", 0.4, 0.5);
    const r = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(r.ok, false);
    assert.equal((live().project.reality?.asBuilt ?? []).length, 0);
  });
});

describe("R11-05 canonical fingerprint unchanged", () => {
  it("failed APPLY does not mutate geometry", () => {
    live().loadProject(seeded(uncalPhoto()));
    live().addPhotoOverlay("ph1", "exhaust", 0.4, 0.5);
    const before = fp();
    live().applyPhotoOverlaysToModel("ph1");
    assert.equal(fp(), before);
  });
});

describe("R11-06 atomic APPLY one unresolved position → zero canonical", () => {
  it("five placed + one missing offset rolls back all", () => {
    live().loadProject(seeded(uncalPhoto()));
    const a = live().addPhotoOverlay("ph1", "rack", 0.15, 0.5);
    const b = live().addPhotoOverlay("ph1", "rack", 0.45, 0.5);
    const c = live().addPhotoOverlay("ph1", "intake", 0.25, 0.4);
    const d = live().addPhotoOverlay("ph1", "exhaust", 0.55, 0.4);
    const e = live().addPhotoOverlay("ph1", "fan", 0.75, 0.55);
    live().addPhotoOverlay("ph1", "door", 0.35, 0.5);
    live().updatePhotoOverlay("ph1", a.overlay!.id, { ownerOffsetM: 1.2 });
    live().updatePhotoOverlay("ph1", b.overlay!.id, { ownerOffsetM: 3.2 });
    live().updatePhotoOverlay("ph1", c.overlay!.id, { ownerOffsetM: 1.5, ownerElevationM: 0.4 });
    live().updatePhotoOverlay("ph1", d.overlay!.id, { ownerOffsetM: 3.5, ownerElevationM: 0.4 });
    live().updatePhotoOverlay("ph1", e.overlay!.id, { ownerOffsetM: 6.0 });
    const before = fp();
    const r = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(r.ok, false);
    assert.equal(r.appliedIds.length, 0);
    assert.equal(live().project.racks.length, 0);
    assert.equal(live().project.openings.length, 0);
    assert.equal(live().project.fans.length, 0);
    assert.equal(fp(), before);
  });
});

describe("R11-07 explicit ownerOffsetM allows horizontal placement", () => {
  it("door offset is the Owner value, not nx * L", () => {
    live().loadProject(seeded(uncalPhoto()));
    const add = live().addPhotoOverlay("ph1", "door", 0.9, 0.5);
    live().updatePhotoOverlay("ph1", add.overlay!.id, { ownerOffsetM: 2, ownerElevationM: 0 });
    const r = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(r.ok, true, r.errors.join("; "));
    assert.equal(live().project.openings[0]!.offsetFromWallStartM, 2);
    assert.notEqual(live().project.openings[0]!.offsetFromWallStartM, 0.9 * 8);
  });
});

describe("R11-08 registered photo still works", () => {
  it("APPLY uses registration mapping", () => {
    const photo: RealityPhotoMeta = {
      ...scaleOnlyPhoto(),
      widthPx: 800,
      heightPx: 280,
      wallRegistration: defaultWallRegistration("south"),
    };
    live().loadProject(seeded(photo));
    const add = live().addPhotoOverlay("ph1", "door", 0.25, 0.55);
    const nx = add.overlay!.nx;
    const expected = registeredOffsetFromNx(photo, nx);
    assert.ok(expected != null);
    const r = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(r.ok, true, r.errors.join("; "));
    assert.ok(live().project.openings.length >= 1);
    assert.ok(Math.abs(live().project.openings[0]!.offsetFromWallStartM - expected!) < 1e-6);
  });
});

describe("R11-09 no nx * wallLength absolute fallback", () => {
  it("resolver rejects; source has no proportional fallback", () => {
    live().loadProject(seeded(uncalPhoto()));
    const mapped = resolveOverlayWallOffset(live().project.reality!.photos[0]!, 0.5, "south", live().project);
    assert.equal(mapped.ok, false);
    const reg = readFileSync(join(ROOT, "../photo-registration.ts"), "utf8");
    const overlay = readFileSync(join(ROOT, "../photo-overlay.ts"), "utf8");
    const reconcile = readFileSync(join(ROOT, "../photo-reconcile.ts"), "utf8");
    assert.equal(reg.includes("UNCALIBRATED_PROPORTIONAL"), false);
    assert.equal(/nx \* L/.test(reg), false);
    assert.equal(/nx \* .*wallLength/.test(reg), false);
    assert.equal(overlay.includes("UNCALIBRATED_PROPORTIONAL"), false);
    assert.equal(reconcile.includes("UNCALIBRATED_PROPORTIONAL"), false);
    assert.equal(/nx \* .*wallLength/.test(reconcile), false);
  });
});

describe("R14-01 DEFAULT exhaust elevation cannot satisfy absolute positioning", () => {
  it("scale-only + ownerOffset + default 0.4 → REJECT", () => {
    live().loadProject(seeded(scaleOnlyPhoto()));
    const add = live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    live().updatePhotoOverlay("ph1", add.overlay!.id, { ownerOffsetM: 2 });
    const r = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("привяз") || e.includes(ABSOLUTE_ELEVATION_RU) || e.includes(SCALE_ONLY_POSITION_RU)));
    assert.equal(live().project.openings.length, 0);
  });
});

describe("R14-02 DEFAULT intake elevation cannot satisfy it", () => {
  it("scale-only intake REJECT without ownerElevationM", () => {
    live().loadProject(seeded(scaleOnlyPhoto()));
    const add = live().addPhotoOverlay("ph1", "intake", 0.3, 0.5);
    live().updatePhotoOverlay("ph1", add.overlay!.id, { ownerOffsetM: 2 });
    const r = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(r.ok, false);
    assert.equal(live().project.openings.length, 0);
  });
});

describe("R14-03 DEFAULT duct 1.8 m cannot silently become canonical z", () => {
  it("scale-only duct REJECT", () => {
    live().loadProject(seeded(scaleOnlyPhoto()));
    const add = live().addPhotoOverlay("ph1", "duct", 0.4, 0.2);
    live().updatePhotoOverlay("ph1", add.overlay!.id, { ownerOffsetM: 2 });
    const r = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(r.ok, false);
    assert.equal((live().project.reality?.asBuilt ?? []).length, 0);
  });
});

describe("R14-04 explicit Owner elevation succeeds", () => {
  it("ownerElevationM=0.4 is canonical bottomElevationM", () => {
    live().loadProject(seeded(scaleOnlyPhoto()));
    const add = live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    live().updatePhotoOverlay("ph1", add.overlay!.id, { ownerOffsetM: 2, ownerElevationM: 0.4 });
    const r = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(r.ok, true, r.errors.join("; "));
    assert.equal(live().project.openings[0]!.bottomElevationM, 0.4);
  });
});

describe("R14-05 registered vertical anchor succeeds", () => {
  it("registration derives elevation without ownerElevationM", () => {
    const photo: RealityPhotoMeta = {
      ...scaleOnlyPhoto(),
      widthPx: 800,
      heightPx: 280,
      wallRegistration: defaultWallRegistration("south"),
    };
    live().loadProject(seeded(photo));
    live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    const r = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(r.ok, true, r.errors.join("; "));
    assert.ok(Number.isFinite(live().project.openings[0]!.bottomElevationM));
  });
});

describe("R14-06 Owner elevation provenance survives reload", () => {
  it("parseProject keeps ownerElevationM", () => {
    live().loadProject(seeded(scaleOnlyPhoto()));
    const add = live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    live().updatePhotoOverlay("ph1", add.overlay!.id, { ownerOffsetM: 2, ownerElevationM: 0.4 });
    const parsed = parseProject(JSON.parse(JSON.stringify(live().project)));
    const ov = parsed.reality!.photos[0]!.overlays![0]!;
    assert.equal(ov.ownerElevationM, 0.4);
    assert.equal(ov.ownerOffsetM, 2);
  });
});

describe("R14-07 Undo/Redo preserves explicit elevation state", () => {
  it("undo drops ownerElevationM write; redo restores", () => {
    live().loadProject(seeded(scaleOnlyPhoto()));
    const add = live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    live().updatePhotoOverlay("ph1", add.overlay!.id, { ownerOffsetM: 2, ownerElevationM: 0.4 });
    assert.equal(live().project.reality!.photos[0]!.overlays![0]!.ownerElevationM, 0.4);
    live().undo();
    assert.equal(live().project.reality!.photos[0]!.overlays![0]!.ownerElevationM, undefined);
    live().redo();
    assert.equal(live().project.reality!.photos[0]!.overlays![0]!.ownerElevationM, 0.4);
  });
});

function withFanAndAsBuilt() {
  const p = seeded(uncalPhoto());
  p.fans = [
    {
      id: "fan1",
      specId: FAN_STRONG.id,
      name: "F1",
      x: 1.2,
      y: 1.2,
      arrangement: "single",
      count: 1,
      dirtyFilter: false,
    },
  ];
  p.reality = {
    ...p.reality!,
    asBuilt: [
      {
        id: "ab1",
        kind: "column",
        name: "C1",
        x: 6,
        y: 3,
        z: 0,
        widthM: 0.4,
        heightM: 2.8,
        depthM: 0.4,
        provenance: "PHOTO_ESTIMATE",
        confidence: "MEDIUM",
      },
    ],
  };
  return p;
}

describe("R12-01 locked fan + patch fans:[] → REJECT", () => {
  it("lockedObjectIds protects fan", () => {
    const p = withFanAndAsBuilt();
    p.lockedObjectIds = ["fan1"];
    live().loadProject(p);
    const before = fp();
    const past = live().past.length;
    const patch = applyPatchValidated(live().project, { fans: [] });
    assert.equal(patch.ok, false);
    assert.ok(patch.errors.includes(OBJECT_LOCKED_RU));
    assert.equal(live().project.fans.length, 1);
    assert.equal(fp(), before);
    assert.equal(live().past.length, past);
  });
});

describe("R12-02 locked AsBuilt + patch reality.asBuilt:[] → REJECT", () => {
  it("lockedObjectIds protects asBuilt", () => {
    const p = withFanAndAsBuilt();
    p.lockedObjectIds = ["ab1"];
    live().loadProject(p);
    const patch = applyPatchValidated(live().project, { reality: { asBuilt: [] } });
    assert.equal(patch.ok, false);
    assert.ok(patch.errors.includes(OBJECT_LOCKED_RU));
    assert.equal(live().project.reality!.asBuilt.length, 1);
  });
});

describe("R12-03 canonical fingerprints unchanged", () => {
  it("rejected fan wipe does not change geometry", () => {
    const p = withFanAndAsBuilt();
    p.lockedObjectIds = ["fan1"];
    live().loadProject(p);
    const before = fp();
    applyPatchValidated(live().project, { fans: [] });
    assert.equal(fp(), before);
  });
});

describe("R12-04 no fake history transaction", () => {
  it("store applyProposed does not commit locked fan delete", () => {
    const p = withFanAndAsBuilt();
    p.lockedObjectIds = ["fan1"];
    live().loadProject(p);
    const past = live().past.length;
    live().propose({
      id: "p1",
      summary: "wipe fans",
      detail: "locked fan delete must not commit",
      patch: { fans: [] },
      fromGrok: false,
    });
    const r = live().applyProposed();
    assert.equal(r.ok, false);
    assert.equal(live().past.length, past);
    assert.equal(live().project.fans.length, 1);
  });
});

describe("R12-05 unlocked fan deletion remains allowed", () => {
  it("deleteSelected removes fan", () => {
    const p = withFanAndAsBuilt();
    p.lockedObjectIds = [];
    live().loadProject(p);
    live().select(["fan1"]);
    const r = live().deleteSelected();
    assert.equal(r.ok, true, r.errors.join("; "));
    assert.equal(live().project.fans.length, 0);
  });
});

describe("R12-06 unlocked AsBuilt deletion remains allowed", () => {
  it("deleteSelected removes asBuilt", () => {
    const p = withFanAndAsBuilt();
    p.lockedObjectIds = [];
    live().loadProject(p);
    live().select(["ab1"]);
    const r = live().deleteSelected();
    assert.equal(r.ok, true, r.errors.join("; "));
    assert.equal(live().project.reality!.asBuilt.length, 0);
  });
});

describe("R12-07 locked opening/rack existing tests remain green", () => {
  it("locked opening wipe still rejected", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.openings = [
      {
        id: "op1",
        type: "DOOR",
        wallId: "south",
        widthM: 1,
        heightM: 2.1,
        bottomElevationM: 0,
        offsetFromWallStartM: 1,
        name: "D",
        locked: true,
      },
    ];
    p.lockedObjectIds = ["op1"];
    const patch = applyPatchValidated(p, { openings: [] });
    assert.equal(patch.ok, false);
    assert.ok(patch.errors.includes(OBJECT_LOCKED_RU));
    assert.equal(p.openings.length, 1);
  });
});

describe("R12-08 mixed locked IDs cannot be bypassed in one patch", () => {
  it("fans + asBuilt + openings wipe fails if any id is locked", () => {
    const p = withFanAndAsBuilt();
    p.openings = [
      {
        id: "op1",
        type: "TECHNICAL",
        wallId: "south",
        widthM: 0.8,
        heightM: 0.8,
        bottomElevationM: 0.4,
        offsetFromWallStartM: 3,
        name: "T",
      },
    ];
    p.lockedObjectIds = ["fan1", "ab1", "op1"];
    live().loadProject(p);
    const patch = applyPatchValidated(live().project, {
      fans: [],
      openings: [],
      reality: { asBuilt: [] },
    });
    assert.equal(patch.ok, false);
    assert.ok(patch.errors.includes(OBJECT_LOCKED_RU));
    assert.equal(live().project.fans.length, 1);
    assert.equal(live().project.openings.length, 1);
    assert.equal(live().project.reality!.asBuilt.length, 1);
  });
});

describe("R13 Twin3D cancel is not commit (code)", () => {
  it("commitDrag and cancelDrag are separate; pointercancel is not onUp", () => {
    const twin = readFileSync(join(ROOT, "../../components/twin/Twin3D.tsx"), "utf8");
    assert.ok(twin.includes("const commitDrag"));
    assert.ok(twin.includes("const cancelDrag"));
    assert.ok(twin.includes('addEventListener("pointercancel", onCancel'));
    assert.ok(twin.includes('addEventListener("touchcancel", onCancel'));
    assert.ok(twin.includes("lostpointercapture"));
    assert.ok(twin.includes('e.key !== "Escape"') || twin.includes('e.key === "Escape"'));
    assert.ok(twin.includes('addEventListener("pointerup", onUp'));
    assert.ok(twin.includes('addEventListener("touchend", onUp'));
    assert.equal(/pointercancel", onUp/.test(twin), false);
    assert.equal(/touchcancel", onUp/.test(twin), false);
    assert.ok(twin.includes("finishCommit"));
    assert.ok(twin.includes("finishCancel"));
  });
});
