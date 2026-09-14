import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeIntent } from "../../ai/intent.ts";
import { emptyReality, type RealityPhotoMeta } from "../types.ts";
import { emptyRectangularProject } from "../../project/factory.ts";
import { parseProject } from "../../project/schema.ts";
import { saveScheduler } from "../../project/save-scheduler.ts";
import { useProjectStore } from "../../project/store.ts";
import { createPhotoOverlay } from "../photo-overlay.ts";
import {
  applyVisualResize,
  overlayMetersFromNormalized,
  photoIntentToCanonical,
  reconcileLinkedReality,
} from "../photo-reconcile.ts";
import { defaultWallRegistration } from "../photo-registration.ts";
import { clientToPhotoNorm, photoContentBox } from "../photo-frame.ts";
import { geometryFingerprint } from "../reality.ts";

saveScheduler.setSave(async () => undefined);

function live() {
  return useProjectStore.getState();
}

function calibratedPhoto(id = "ph1"): RealityPhotoMeta {
  return {
    id,
    name: "south.jpg",
    mime: "image/jpeg",
    createdAt: 1,
    notes: "",
    wallHint: "south",
    widthPx: 800,
    heightPx: 280,
    calibration: {
      scaleMPerPx: 0.01,
      lengthM: 8,
      aId: "a",
      bId: "b",
      provenance: "FIELD_MEASUREMENT",
    },
    wallRegistration: defaultWallRegistration("south"),
    markers: [
      { id: "a", nx: 0.1, ny: 0.5, kind: "point", label: "A", pairId: "b" },
      { id: "b", nx: 0.9, ny: 0.5, kind: "point", label: "B", pairId: "a", lengthM: 8 },
    ],
    overlays: [],
  };
}

function seeded(calibrated = true) {
  const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8, name: "QX-03R" });
  p.reality = { ...emptyReality(), photos: [calibrated ? calibratedPhoto() : { ...calibratedPhoto(), calibration: undefined, markers: [] }] };
  return p;
}

describe("PHOTO-METER-01 calibrated double nw doubles widthM", () => {
  it("visual nw * 2 → widthM * 2", () => {
    const photo = calibratedPhoto();
    const ov = createPhotoOverlay(photo, "exhaust", 0.4, 0.5, "ov1");
    const meters = overlayMetersFromNormalized(photo, ov.nw, ov.nh);
    assert.ok(meters);
    const doubled = applyVisualResize(photo, ov, ov.nw * 2, ov.nh);
    assert.ok(Math.abs(doubled.widthM - meters!.widthM * 2) < 1e-9);
    assert.equal(doubled.metricSource, "CALIBRATED");
  });
});

describe("PHOTO-METER-02 calibrated double nh doubles heightM", () => {
  it("visual nh * 2 → heightM * 2", () => {
    const photo = calibratedPhoto();
    const ov = createPhotoOverlay(photo, "exhaust", 0.4, 0.5, "ov1");
    const meters = overlayMetersFromNormalized(photo, ov.nw, ov.nh);
    assert.ok(meters);
    const doubled = applyVisualResize(photo, ov, ov.nw, ov.nh * 2);
    assert.ok(Math.abs(doubled.heightM - meters!.heightM * 2) < 1e-9);
  });
});

describe("PHOTO-METER-03 visual resize then APPLY writes opening meters", () => {
  it("canonical opening matches derived dimensions", () => {
    live().loadProject(seeded(true));
    const add = live().addPhotoOverlay("ph1", "exhaust", 0.35, 0.55);
    assert.equal(add.ok, true);
    const ov = add.overlay!;
    const photo = live().project.reality!.photos[0]!;
    const next = applyVisualResize(photo, ov, ov.nw * 1.5, ov.nh * 1.2);
    live().updatePhotoOverlay("ph1", ov.id, { nw: next.nw, nh: next.nh });
    const after = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(after.metricSource, "CALIBRATED");
    const applied = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    const opening = live().project.openings.find((o) => o.type === "EXHAUST");
    assert.ok(opening);
    assert.ok(Math.abs(opening!.widthM - after.widthM) < 1e-6);
    assert.ok(Math.abs(opening!.heightM - after.heightM) < 1e-6);
  });
});

describe("PHOTO-METER-04 rack visual resize then APPLY", () => {
  it("canonical rack along-wall size reflects calibrated resize", () => {
    live().loadProject(seeded(true));
    const add = live().addPhotoOverlay("ph1", "rack", 0.25, 0.55);
    const ov = add.overlay!;
    const photo = live().project.reality!.photos[0]!;
    const next = applyVisualResize(photo, ov, Math.min(0.28, ov.nw * 1.4), ov.nh);
    live().updatePhotoOverlay("ph1", ov.id, { nw: next.nw, nh: next.nh });
    const visual = live().project.reality!.photos[0]!.overlays![0]!;
    const applied = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    const rack = live().project.racks[0];
    assert.ok(rack);
    assert.ok(Math.abs(rack!.widthM - visual.widthM) < 1e-6);
  });
});

describe("PHOTO-METER-05 no calibration visual resize is not fake meters", () => {
  it("uncalibrated resize keeps DEFAULT meters", () => {
    live().loadProject(seeded(false));
    const add = live().addPhotoOverlay("ph1", "exhaust", 0.4, 0.5);
    const ov = add.overlay!;
    const beforeW = ov.widthM;
    const beforeH = ov.heightM;
    live().updatePhotoOverlay("ph1", ov.id, { nw: ov.nw * 2, nh: ov.nh * 2 });
    const after = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(after.widthM, beforeW);
    assert.equal(after.heightM, beforeH);
    assert.equal(after.metricSource ?? "DEFAULT", "DEFAULT");
    assert.ok(after.nw > ov.nw);
  });
});

describe("PHOTO-METER-06 undo resize restores box and meters", () => {
  it("normalized box AND meters restore together", () => {
    live().loadProject(seeded(true));
    const add = live().addPhotoOverlay("ph1", "exhaust", 0.4, 0.5);
    const ov = add.overlay!;
    live().updatePhotoOverlay("ph1", ov.id, { nw: ov.nw * 2, nh: ov.nh });
    const mid = live().project.reality!.photos[0]!.overlays![0]!;
    assert.ok(mid.widthM > ov.widthM);
    live().undo();
    const restored = live().project.reality!.photos[0]!.overlays![0]!;
    assert.ok(Math.abs(restored.nw - ov.nw) < 1e-9);
    assert.ok(Math.abs(restored.widthM - ov.widthM) < 1e-9);
    assert.ok(Math.abs(restored.nh - ov.nh) < 1e-9);
    assert.ok(Math.abs(restored.heightM - ov.heightM) < 1e-9);
  });
});

describe("PHOTO-METER-07 rotation does not swap width/height", () => {
  it("object-local meters stay", () => {
    const photo = calibratedPhoto();
    const ov = createPhotoOverlay(photo, "exhaust", 0.4, 0.5, "ov1");
    const rotated = { ...ov, rotationDeg: 90 as const };
    const resized = applyVisualResize(photo, rotated, rotated.nw * 2, rotated.nh);
    assert.ok(resized.widthM > ov.widthM);
    assert.ok(Math.abs(resized.heightM - ov.heightM) < 1e-9);
  });
});

describe("PHOTO-METER-08 OWNER_ENTERED meters via inspector", () => {
  it("typed meters update overlay and stay OWNER_ENTERED", () => {
    live().loadProject(seeded(false));
    const add = live().addPhotoOverlay("ph1", "intake", 0.3, 0.4);
    live().updatePhotoOverlay("ph1", add.overlay!.id, { widthM: 1.11, metricSource: "OWNER_ENTERED" });
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(ov.widthM, 1.11);
    assert.equal(ov.metricSource, "OWNER_ENTERED");
  });
});

describe("SYNC-01 linked photo drag updates canonical opening offset", () => {
  it("photo nx → offsetFromWallStartM", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    const before = live().project.openings[0]!.offsetFromWallStartM;
    live().updatePhotoOverlay("ph1", ov.id, { nx: Math.min(0.55, ov.nx + 0.1), ny: ov.ny, nw: ov.nw, nh: ov.nh });
    const after = live().project.openings[0]!.offsetFromWallStartM;
    assert.ok(after > before - 1e-9);
    const linked = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(linked.linkedObjectId, live().project.openings[0]!.id);
  });
});

describe("SYNC-02 canonical opening edit updates overlay", () => {
  it("Inspector height → overlay heightM", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const id = live().project.openings[0]!.id;
    live().updateOpening(id, { heightM: 1.05 });
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(ov.heightM, 1.05);
    assert.equal(ov.linkedObjectId, id);
  });
});

describe("SYNC-03 wall reassignment marks OUT_OF_PHOTO_PLANE", () => {
  it("exhaust south photo → north wall", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const id = live().project.openings[0]!.id;
    const r = live().reassignOpeningWall(id, "north");
    assert.equal(r.ok, true, r.errors.join("; "));
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(ov.linkedObjectId, id);
    assert.equal(ov.planeStatus, "OUT_OF_PHOTO_PLANE");
    assert.equal(ov.wallId, "north");
  });
});

describe("SYNC-04 invalid linked photo edit is fail-closed", () => {
  it("huge calibrated resize rejected; canonical unchanged", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const fp = geometryFingerprint(live().project);
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    const res = live().updatePhotoOverlay("ph1", ov.id, { nw: 0.95, nh: ov.nh });
    assert.equal(res.ok, false);
    assert.equal(geometryFingerprint(live().project), fp);
  });
});

describe("SYNC-05 rack 3D move reconciles overlay plane", () => {
  it("rack pulled off south wall → OUT_OF_PHOTO_PLANE", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "rack", 0.22, 0.55);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const rack = live().project.racks[0]!;
    const moved = live().moveRack(rack.id, 2.4, 1.8, false);
    assert.equal(moved.ok, true, moved.errors.join("; "));
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(ov.linkedObjectId, rack.id);
    assert.equal(ov.planeStatus, "OUT_OF_PHOTO_PLANE");
  });
});

describe("SYNC-06 undo wall reassignment restores ON_PLANE", () => {
  it("undo restores overlay wall + plane", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const id = live().project.openings[0]!.id;
    live().reassignOpeningWall(id, "north");
    live().undo();
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(ov.planeStatus, "ON_PLANE");
    assert.equal(live().project.openings[0]!.wallId, "south");
  });
});

describe("SYNC-07 persist keeps linked identity", () => {
  it("parseProject keeps synchronized fields", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "intake", 0.28, 0.45);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    live().updateOpening(live().project.openings[0]!.id, { heightM: 1.02 });
    const loaded = parseProject(JSON.parse(JSON.stringify(live().project)));
    const ov = loaded.reality?.photos[0]?.overlays?.[0];
    assert.ok(ov?.linkedObjectId);
    assert.equal(ov!.heightM, 1.02);
    assert.ok(loaded.openings.some((o) => o.id === ov!.linkedObjectId && o.heightM === 1.02));
  });
});

describe("SYNC-08 AI PROJECT_EDIT sentence", () => {
  it("Перенеси приток на левую стену → PROJECT_EDIT", () => {
    const r = routeIntent("Перенеси приток на левую стену");
    assert.equal(r.scope, "PROJECT");
    assert.equal(r.type, "PROJECT_EDIT");
  });
});

describe("SYNC-09 photoIntentToCanonical is the single adapter", () => {
  it("draft patch does not mutate canonical", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "door", 0.3, 0.6);
    const fp = geometryFingerprint(live().project);
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    const r = photoIntentToCanonical(live().project, "ph1", ov.id, { nx: 0.4 });
    assert.equal(r.ok, true);
    assert.equal(geometryFingerprint(r.ok ? r.project : live().project), fp);
  });
});

describe("SYNC-10 reconcile is idempotent", () => {
  it("second reconcile does not change JSON", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const a = reconcileLinkedReality(live().project);
    const b = reconcileLinkedReality(a);
    assert.equal(JSON.stringify(a.reality?.photos[0]?.overlays), JSON.stringify(b.reality?.photos[0]?.overlays));
  });
});

describe("COORD-01 content-box center maps to 0.5, 0.5", () => {
  it("tap visual center of photo", () => {
    const box = photoContentBox(1000, 500, 1000, 500);
    const n = clientToPhotoNorm(box.x + box.w / 2, box.y + box.h / 2, { left: box.x, top: box.y, width: box.w, height: box.h });
    assert.ok(n);
    assert.ok(Math.abs(n!.nx - 0.5) < 1e-9);
    assert.ok(Math.abs(n!.ny - 0.5) < 1e-9);
  });
});

describe("COORD-02 10% from left edge", () => {
  it("image-relative point", () => {
    const box = photoContentBox(800, 800, 1600, 900);
    const n = clientToPhotoNorm(box.x + box.w * 0.1, box.y + box.h * 0.5, { left: box.x, top: box.y, width: box.w, height: box.h });
    assert.ok(n);
    assert.ok(Math.abs(n!.nx - 0.1) < 1e-9);
  });
});

describe("COORD-03 portrait letterbox has no horizontal displacement", () => {
  it("side letterboxes are outside 0..1", () => {
    const box = photoContentBox(1000, 500, 400, 800);
    assert.ok(box.x > 1);
    const leftLetter = clientToPhotoNorm(box.x - 10, box.y + box.h / 2, { left: box.x, top: box.y, width: box.w, height: box.h });
    assert.ok(leftLetter && leftLetter.nx < 0);
    const imgLeft = clientToPhotoNorm(box.x, box.y + box.h / 2, { left: box.x, top: box.y, width: box.w, height: box.h });
    assert.ok(imgLeft && Math.abs(imgLeft.nx) < 1e-9);
  });
});

describe("COORD-04 landscape letterbox has no vertical displacement", () => {
  it("top/bottom letterboxes are outside 0..1", () => {
    const box = photoContentBox(400, 800, 1600, 900);
    assert.ok(box.y > 1);
    const above = clientToPhotoNorm(box.x + box.w / 2, box.y - 10, { left: box.x, top: box.y, width: box.w, height: box.h });
    assert.ok(above && above.ny < 0);
    const top = clientToPhotoNorm(box.x + box.w / 2, box.y, { left: box.x, top: box.y, width: box.w, height: box.h });
    assert.ok(top && Math.abs(top.ny) < 1e-9);
  });
});

describe("COORD-05 square and extreme aspect ratios", () => {
  it("square / very tall / very wide keep 0,0 and 1,1 on the image", () => {
    const cases = [
      [390, 844, 400, 800],
      [390, 844, 1600, 900],
      [1280, 720, 1000, 1000],
      [1280, 720, 400, 2000],
      [1280, 720, 3000, 400],
    ] as const;
    for (const [cw, ch, iw, ih] of cases) {
      const box = photoContentBox(cw, ch, iw, ih);
      assert.ok(box.w > 0 && box.h > 0);
      const tl = clientToPhotoNorm(box.x, box.y, { left: box.x, top: box.y, width: box.w, height: box.h });
      const br = clientToPhotoNorm(box.x + box.w, box.y + box.h, { left: box.x, top: box.y, width: box.w, height: box.h });
      assert.ok(tl && Math.abs(tl.nx) < 1e-9 && Math.abs(tl.ny) < 1e-9);
      assert.ok(br && Math.abs(br.nx - 1) < 1e-9 && Math.abs(br.ny - 1) < 1e-9);
    }
  });
});

describe("COORD-06 normalized overlay stays registered after container resize", () => {
  it("same nx on a new container maps to the new content-box left+nx*w", () => {
    const a = photoContentBox(800, 600, 1600, 900);
    const b = photoContentBox(400, 800, 1600, 900);
    const nx = 0.25;
    const ax = a.x + nx * a.w;
    const bx = b.x + nx * b.w;
    const na = clientToPhotoNorm(ax, a.y + 0.5 * a.h, { left: a.x, top: a.y, width: a.w, height: a.h });
    const nb = clientToPhotoNorm(bx, b.y + 0.5 * b.h, { left: b.x, top: b.y, width: b.w, height: b.h });
    assert.ok(na && nb);
    assert.ok(Math.abs(na!.nx - nx) < 1e-9);
    assert.ok(Math.abs(nb!.nx - nx) < 1e-9);
  });
});

describe("APPLY-ATOMIC-01 six valid commit as one history transaction", () => {
  it("2 racks + intake + exhaust + fan + duct", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "rack", 0.18, 0.55);
    live().addPhotoOverlay("ph1", "rack", 0.52, 0.55);
    const intake = live().addPhotoOverlay("ph1", "intake", 0.3, 0.4);
    const exhaust = live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.4);
    live().addPhotoOverlay("ph1", "fan", 0.75, 0.55);
    live().addPhotoOverlay("ph1", "duct", 0.4, 0.2);
    live().updatePhotoOverlay("ph1", intake.overlay!.id, { wallId: "west" });
    live().updatePhotoOverlay("ph1", exhaust.overlay!.id, { wallId: "east" });
    const pastBefore = live().past.length;
    const applied = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    assert.equal(applied.appliedIds.length, 6);
    assert.equal(live().past.length, pastBefore + 1);
    assert.equal(live().project.racks.length, 2);
    assert.equal(live().project.openings.filter((o) => o.type === "INTAKE").length, 1);
    assert.equal(live().project.openings.filter((o) => o.type === "EXHAUST").length, 1);
    assert.equal(live().project.fans.length, 1);
    assert.equal((live().project.reality?.asBuilt ?? []).length, 1);
  });
});

describe("APPLY-ATOMIC-02 five valid + one invalid → zero canonical", () => {
  it("nothing applies", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "rack", 0.18, 0.55);
    live().addPhotoOverlay("ph1", "rack", 0.52, 0.55);
    live().addPhotoOverlay("ph1", "intake", 0.25, 0.4);
    live().addPhotoOverlay("ph1", "exhaust", 0.55, 0.4);
    live().addPhotoOverlay("ph1", "fan", 0.75, 0.55);
    const bad = live().addPhotoOverlay("ph1", "door", 0.4, 0.6);
    live().updatePhotoOverlay("ph1", bad.overlay!.id, { widthM: 20, metricSource: "OWNER_ENTERED" });
    const fp = geometryFingerprint(live().project);
    const applied = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(applied.ok, false);
    assert.equal(applied.appliedIds.length, 0);
    assert.equal(live().project.racks.length, 0);
    assert.equal(live().project.openings.length, 0);
    assert.equal(geometryFingerprint(live().project), fp);
  });
});

describe("APPLY-ATOMIC-03 failed APPLY leaves drafts", () => {
  it("overlays remain unapplied", () => {
    live().loadProject(seeded(true));
    const door = live().addPhotoOverlay("ph1", "door", 0.4, 0.5);
    live().updatePhotoOverlay("ph1", door.overlay!.id, { widthM: 20, metricSource: "OWNER_ENTERED" });
    live().applyPhotoOverlaysToModel("ph1");
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(ov.applied, false);
    assert.equal(ov.linkedObjectId, undefined);
  });
});

describe("APPLY-ATOMIC-04 undo successful APPLY ALL restores pre-apply", () => {
  it("one undo restores entire pre-apply state", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "intake", 0.3, 0.45);
    live().addPhotoOverlay("ph1", "exhaust", 0.55, 0.45);
    const pre = JSON.stringify({
      openings: live().project.openings,
      overlays: live().project.reality!.photos[0]!.overlays,
    });
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    live().undo();
    const post = JSON.stringify({
      openings: live().project.openings,
      overlays: live().project.reality!.photos[0]!.overlays,
    });
    assert.equal(post, pre);
  });
});

describe("APPLY-ATOMIC-05 redo restores links atomically", () => {
  it("redo after undo APPLY restores both links", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "intake", 0.3, 0.45);
    live().addPhotoOverlay("ph1", "exhaust", 0.55, 0.45);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    live().undo();
    live().redo();
    const ovs = live().project.reality!.photos[0]!.overlays ?? [];
    assert.equal(ovs.length, 2);
    assert.ok(ovs.every((o) => o.applied && o.linkedObjectId));
    assert.equal(live().project.openings.length, 2);
  });
});

describe("DELETE-01 unlinked draft delete has no canonical impact", () => {
  it("delete draft only", () => {
    live().loadProject(seeded(true));
    const add = live().addPhotoOverlay("ph1", "rack", 0.2, 0.5);
    const fp = geometryFingerprint(live().project);
    const r = live().deletePhotoOverlay("ph1", add.overlay!.id);
    assert.equal(r.ok, true);
    assert.equal((live().project.reality!.photos[0]!.overlays ?? []).length, 0);
    assert.equal(geometryFingerprint(live().project), fp);
  });
});

describe("DELETE-02 detach linked overlay keeps canonical", () => {
  it("Убрать с фото", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    const nOpen = live().project.openings.length;
    const r = live().detachPhotoOverlay("ph1", ov.id);
    assert.equal(r.ok, true);
    assert.equal(live().project.openings.length, nOpen);
    assert.equal((live().project.reality!.photos[0]!.overlays ?? []).length, 0);
  });
});

describe("DELETE-03 delete linked from model via photo", () => {
  it("Удалить из модели", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    const r = live().deleteLinkedFromModel("ph1", ov.id);
    assert.equal(r.ok, true);
    assert.equal(live().project.openings.length, 0);
    assert.equal((live().project.reality!.photos[0]!.overlays ?? []).length, 0);
  });
});

describe("DELETE-04 delete canonical unlinks overlay", () => {
  it("2D/3D delete", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "door", 0.35, 0.55);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const id = live().project.openings[0]!.id;
    live().select([id]);
    assert.equal(live().deleteSelected().ok, true);
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(ov.applied, false);
    assert.equal(ov.linkedObjectId, undefined);
  });
});

describe("DELETE-05 undo/redo detach is symmetric", () => {
  it("undo detach restores overlay link", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    const id = ov.linkedObjectId;
    live().detachPhotoOverlay("ph1", ov.id);
    live().undo();
    const back = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(back.linkedObjectId, id);
    assert.equal(back.applied, true);
    live().redo();
    assert.equal((live().project.reality!.photos[0]!.overlays ?? []).length, 0);
    assert.equal(live().project.openings.length, 1);
  });
});

describe("DELETE-06 linked deletePhotoOverlay is refused", () => {
  it("ambiguous delete is rejected", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const ov = live().project.reality!.photos[0]!.overlays![0]!;
    const r = live().deletePhotoOverlay("ph1", ov.id);
    assert.equal(r.ok, false);
    assert.equal(live().project.openings.length, 1);
    assert.equal(live().project.reality!.photos[0]!.overlays!.length, 1);
  });
});

describe("TWIN-EDIT-01 drag rack to valid floor point", () => {
  it("x/y canonical update", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "rack", 0.22, 0.55);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const id = live().project.racks[0]!.id;
    const res = live().moveRack(id, 2.5, 1.6, false);
    assert.equal(res.ok, true, res.errors.join("; "));
    assert.ok(Math.abs(live().project.racks[0]!.x - 2.5) < 1e-9);
    assert.ok(Math.abs(live().project.racks[0]!.y - 1.6) < 1e-9);
  });
});

describe("TWIN-EDIT-02 drag rack into collision rejected", () => {
  it("canonical unchanged", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "rack", 0.18, 0.55);
    live().addPhotoOverlay("ph1", "rack", 0.52, 0.55);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const a = live().project.racks[0]!;
    const b = live().project.racks[1]!;
    const fp = geometryFingerprint(live().project);
    const res = live().moveRack(a.id, b.x, b.y, false);
    assert.equal(res.ok, false);
    assert.equal(geometryFingerprint(live().project), fp);
  });
});

describe("TWIN-EDIT-03 rotate rack 90", () => {
  it("canonical rotation changes", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "rack", 0.22, 0.55);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const id = live().project.racks[0]!.id;
    live().moveRack(id, 2.5, 1.5, false);
    live().select([id]);
    const rot = live().rotateSelectedRack();
    assert.equal(rot.ok, true, rot.errors.join("; "));
    assert.equal(live().project.racks[0]!.rotationDeg, 90);
  });
});

describe("TWIN-EDIT-04 drag fan", () => {
  it("canonical position changes", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "fan", 0.4, 0.55);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const id = live().project.fans[0]!.id;
    const res = live().moveFan(id, 3.1, 2.2, false);
    assert.equal(res.ok, true, res.errors.join("; "));
    assert.ok(Math.abs(live().project.fans[0]!.x - 3.1) < 1e-9);
    assert.ok(Math.abs(live().project.fans[0]!.y - 2.2) < 1e-9);
  });
});

describe("TWIN-EDIT-05 move opening along wall", () => {
  it("offsetFromWallStartM updates", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.5);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const id = live().project.openings[0]!.id;
    const before = live().project.openings[0]!.offsetFromWallStartM;
    const res = live().updateOpening(id, { offsetFromWallStartM: before + 0.4 }, false);
    assert.equal(res.ok, true, res.errors.join("; "));
    assert.ok(Math.abs(live().project.openings[0]!.offsetFromWallStartM - (before + 0.4)) < 1e-9);
  });
});

describe("TWIN-EDIT-06 2D sees the same geometry", () => {
  it("view switch does not fork state", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "rack", 0.22, 0.55);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const id = live().project.racks[0]!.id;
    live().moveRack(id, 2.4, 1.7, false);
    live().setView("2d");
    assert.ok(Math.abs(live().project.racks[0]!.x - 2.4) < 1e-9);
    live().setView("3d");
    assert.ok(Math.abs(live().project.racks[0]!.y - 1.7) < 1e-9);
  });
});

describe("TWIN-EDIT-07 linked photo reconciles after 3D edit", () => {
  it("opening offset change updates overlay nx", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "exhaust", 0.25, 0.5);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const ovBefore = live().project.reality!.photos[0]!.overlays![0]!;
    const id = live().project.openings[0]!.id;
    live().updateOpening(id, { offsetFromWallStartM: live().project.openings[0]!.offsetFromWallStartM + 0.6 });
    const ovAfter = live().project.reality!.photos[0]!.overlays![0]!;
    assert.equal(ovAfter.linkedObjectId, ovBefore.linkedObjectId);
    assert.ok(ovAfter.nx > ovBefore.nx - 1e-9);
  });
});

describe("TWIN-EDIT-08 undo 3D rack move restores all views", () => {
  it("canonical + overlay restore", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "rack", 0.22, 0.55);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const before = JSON.stringify({
      rack: live().project.racks[0],
      ov: live().project.reality!.photos[0]!.overlays![0],
    });
    live().moveRack(live().project.racks[0]!.id, 2.5, 1.6, false);
    live().undo();
    const after = JSON.stringify({
      rack: live().project.racks[0],
      ov: live().project.reality!.photos[0]!.overlays![0],
    });
    assert.equal(after, before);
  });
});

describe("JOURNEY-01 owner photo → apply → 2D/3D → photo plane", () => {
  it("full QX-03R journey on canonical store", () => {
    live().loadProject(seeded(true));
    live().addPhotoOverlay("ph1", "rack", 0.18, 0.55);
    live().addPhotoOverlay("ph1", "rack", 0.52, 0.55);
    live().addPhotoOverlay("ph1", "intake", 0.22, 0.4);
    const exhaust = live().addPhotoOverlay("ph1", "exhaust", 0.48, 0.4);
    live().addPhotoOverlay("ph1", "fan", 0.75, 0.55);
    live().addPhotoOverlay("ph1", "duct", 0.35, 0.18);
    const ex = live().project.reality!.photos[0]!.overlays!.find((o) => o.id === exhaust.overlay!.id)!;
    const resized = applyVisualResize(live().project.reality!.photos[0]!, ex, ex.nw * 1.25, ex.nh);
    live().updatePhotoOverlay("ph1", ex.id, { nw: resized.nw, nh: resized.nh });
    const visualW = live().project.reality!.photos[0]!.overlays!.find((o) => o.id === ex.id)!.widthM;
    assert.ok(visualW > ex.widthM);
    const applied = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    assert.equal(applied.appliedIds.length, 6);
    live().setView("2d");
    assert.equal(live().project.racks.length, 2);
    const canonEx = live().project.openings.find((o) => o.type === "EXHAUST")!;
    assert.ok(Math.abs(canonEx.widthM - visualW) < 1e-6);
    live().setView("3d");
    const rackId = live().project.racks[0]!.id;
    assert.equal(live().moveRack(rackId, 2.3, 1.7, false).ok, true);
    live().select([rackId]);
    assert.equal(live().rotateSelectedRack().ok, true);
    assert.equal(live().project.racks[0]!.rotationDeg, 90);
    const r = live().reassignOpeningWall(canonEx.id, "north");
    assert.equal(r.ok, true, r.errors.join("; "));
    live().setView("photo");
    const ovs = live().project.reality!.photos[0]!.overlays ?? [];
    assert.ok(ovs.every((o) => o.applied && o.linkedObjectId));
    const exOv = ovs.find((o) => o.linkedObjectId === canonEx.id)!;
    assert.equal(exOv.planeStatus, "OUT_OF_PHOTO_PLANE");
    live().undo();
    const afterUndoWall = live().project.reality!.photos[0]!.overlays!.find((o) => o.linkedObjectId === canonEx.id)!;
    assert.equal(live().project.openings.find((o) => o.id === canonEx.id)!.wallId, "south");
    assert.equal(afterUndoWall.planeStatus, "ON_PLANE");
    live().undo();
    live().undo();
    assert.equal(live().project.racks[0]!.rotationDeg, 0);
    assert.ok(live().project.racks[0]!.y < 0.3);
  });
});
