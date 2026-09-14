import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeIntent } from "../../ai/intent.ts";
import { emptyReality, type RealityPhotoMeta } from "../types.ts";
import { emptyRectangularProject } from "../../project/factory.ts";
import { parseProject } from "../../project/schema.ts";
import { saveScheduler } from "../../project/save-scheduler.ts";
import { useProjectStore } from "../../project/store.ts";
import { applyPhotoOverlays, createPhotoOverlay } from "../photo-overlay.ts";
import { reassignOpeningWall } from "../wall-reassign.ts";
import { geometryFingerprint } from "../reality.ts";
import type { Opening } from "../types.ts";

saveScheduler.setSave(async () => undefined);

function live() {
  return useProjectStore.getState();
}

function photoMeta(id = "ph1"): RealityPhotoMeta {
  return {
    id,
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

function seededProject() {
  const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8, name: "QX-03" });
  p.reality = { ...emptyReality(), photos: [photoMeta()] };
  return p;
}

function ownerAbs(overlayId: string, offsetM: number, elevationM?: number, extra: Record<string, unknown> = {}) {
  const patch: Record<string, unknown> = { ownerOffsetM: offsetM, ...extra };
  if (elevationM != null) patch.ownerElevationM = elevationM;
  live().updatePhotoOverlay("ph1", overlayId, patch);
}

function southExhaust(): Opening {
  return {
    id: "ex_s",
    type: "EXHAUST",
    wallId: "south",
    widthM: 1.4,
    heightM: 0.9,
    bottomElevationM: 0.4,
    offsetFromWallStartM: 2,
    name: "Exhaust",
  };
}

describe("PHOTO-01 overlay draft does not mutate canonical", () => {
  it("add overlay leaves openings/racks/fans unchanged", () => {
    live().loadProject(seededProject());
    const fp = geometryFingerprint(live().project);
    const nOpen = live().project.openings.length;
    const nRack = live().project.racks.length;
    const nFan = live().project.fans.length;
    const r = live().addPhotoOverlay("ph1", "rack", 0.2, 0.4);
    assert.equal(r.ok, true);
    assert.equal(live().project.openings.length, nOpen);
    assert.equal(live().project.racks.length, nRack);
    assert.equal(live().project.fans.length, nFan);
    assert.equal(geometryFingerprint(live().project), fp);
    const ov = live().project.reality?.photos[0]?.overlays ?? [];
    assert.equal(ov.length, 1);
    assert.equal(ov[0]!.applied, false);
    assert.equal(ov[0]!.linkedObjectId, undefined);
  });
});

describe("PHOTO-02 APPLY TO MODEL links overlays to canonical objects", () => {
  it("2 racks + intake + exhaust + fan + duct", () => {
    live().loadProject(seededProject());
    const beforeOpen = live().project.openings.length;
    const beforeRack = live().project.racks.length;
    const beforeFan = live().project.fans.length;
    const beforeAb = live().project.reality?.asBuilt.length ?? 0;

    live().addPhotoOverlay("ph1", "rack", 0.18, 0.5);
    live().addPhotoOverlay("ph1", "rack", 0.52, 0.5);
    const intake = live().addPhotoOverlay("ph1", "intake", 0.3, 0.4);
    const exhaust = live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.4);
    const fan = live().addPhotoOverlay("ph1", "fan", 0.75, 0.55);
    const duct = live().addPhotoOverlay("ph1", "duct", 0.4, 0.2);
    assert.ok(intake.overlay?.id);
    assert.ok(exhaust.overlay?.id);
    const ovs0 = live().project.reality?.photos[0]?.overlays ?? [];
    const racks = ovs0.filter((o) => o.kind === "rack");
    ownerAbs(racks[0]!.id, 1.2);
    ownerAbs(racks[1]!.id, 3.4);
    ownerAbs(intake.overlay!.id, 1.5, 0.4, { wallId: "west" });
    ownerAbs(exhaust.overlay!.id, 1.6, 0.4, { wallId: "east" });
    ownerAbs(fan.overlay!.id, 5.5);
    ownerAbs(duct.overlay!.id, 4.0, 1.8);

    const drafts = live().project.reality?.photos[0]?.overlays ?? [];
    assert.equal(drafts.length, 6);
    assert.ok(drafts.every((o) => !o.applied));
    assert.equal(live().project.racks.length, beforeRack);
    assert.equal(live().project.openings.length, beforeOpen);

    const applied = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    assert.equal(applied.appliedIds.length, 6, applied.errors.join("; "));

    const p = live().project;
    assert.equal(p.racks.length, beforeRack + 2);
    assert.equal(p.openings.filter((o) => o.type === "INTAKE").length, 1);
    assert.equal(p.openings.filter((o) => o.type === "EXHAUST").length, 1);
    assert.equal(p.fans.length, beforeFan + 1);
    assert.equal((p.reality?.asBuilt ?? []).length, beforeAb + 1);
    const ovs = p.reality?.photos[0]?.overlays ?? [];
    assert.ok(ovs.every((o) => o.applied && o.linkedObjectId));
    const linked = new Set(ovs.map((o) => o.linkedObjectId));
    assert.equal(linked.size, 6);
    assert.ok(p.racks.some((r) => linked.has(r.id)));
    assert.ok(p.openings.some((o) => linked.has(o.id) && o.type === "INTAKE"));
    assert.ok(p.openings.some((o) => linked.has(o.id) && o.type === "EXHAUST"));
    assert.ok(p.fans.some((f) => linked.has(f.id)));
    assert.ok((p.reality?.asBuilt ?? []).some((a) => linked.has(a.id) && a.kind === "duct"));
  });
});

describe("PHOTO-03 overlay apply uses validators (fail closed)", () => {
  it("opening wider than wall is rejected; canonical unchanged", () => {
    live().loadProject(seededProject());
    const fp = geometryFingerprint(live().project);
    const r = live().addPhotoOverlay("ph1", "door", 0.4, 0.5);
    assert.equal(r.ok, true);
    live().updatePhotoOverlay("ph1", r.overlay!.id, { widthM: 20, wallId: "south" });
    const applied = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(applied.ok, false);
    assert.equal(live().project.openings.length, 0);
    assert.equal(geometryFingerprint(live().project), fp);
  });
});

describe("WALL-REASSIGN-01 exhaust south → north", () => {
  it("keeps size, writes valid canonical geometry", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    src.openings = [southExhaust()];
    live().loadProject(src);
    const r = live().reassignOpeningWall("ex_s", "north");
    assert.equal(r.ok, true, r.errors.join("; "));
    const o = live().project.openings.find((x) => x.id === "ex_s");
    assert.ok(o);
    assert.equal(o!.wallId, "north");
    assert.equal(o!.widthM, 1.4);
    assert.equal(o!.heightM, 0.9);
    assert.ok(o!.offsetFromWallStartM >= 0);
    assert.ok(o!.offsetFromWallStartM + o!.widthM <= 8 + 1e-9);
  });
});

describe("WALL-REASSIGN-02 invalid target rejected", () => {
  it("width larger than destination wall", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    src.openings = [
      {
        id: "ex_s",
        type: "EXHAUST",
        wallId: "south",
        widthM: 6,
        heightM: 0.9,
        bottomElevationM: 0.4,
        offsetFromWallStartM: 0.5,
        name: "Wide",
      },
    ];
    const r = reassignOpeningWall(src, "ex_s", "west");
    assert.equal(r.ok, false);
    assert.equal(src.openings[0]!.wallId, "south");
  });
});

describe("WALL-REASSIGN-03 locked opening rejected", () => {
  it("locked door stays", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5 });
    src.openings = [
      {
        id: "door",
        type: "DOOR",
        wallId: "south",
        widthM: 1,
        heightM: 2.1,
        bottomElevationM: 0,
        offsetFromWallStartM: 1,
        name: "Door",
        locked: true,
      },
    ];
    live().loadProject(src);
    const r = live().reassignOpeningWall("door", "north");
    assert.equal(r.ok, false);
    assert.equal(live().project.openings[0]!.wallId, "south");
  });
});

describe("PHOTO-04 undo APPLY and overlay add", () => {
  it("undo restores pre-APPLY canonical and unapplied overlays", () => {
    live().loadProject(seededProject());
    live().addPhotoOverlay("ph1", "door", 0.3, 0.6);
    const doorOv = live().project.reality?.photos[0]?.overlays?.[0];
    assert.ok(doorOv);
    ownerAbs(doorOv.id, 2.0, 0);
    const preApply = JSON.stringify(live().project.openings);
    const preOv = live().project.reality?.photos[0]?.overlays?.[0];
    assert.ok(preOv && !preOv.applied);
    const applied = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    assert.ok(live().project.openings.some((o) => o.type === "DOOR"));
    live().undo();
    assert.equal(JSON.stringify(live().project.openings), preApply);
    const ov = live().project.reality?.photos[0]?.overlays?.[0];
    assert.ok(ov);
    assert.equal(ov!.applied, false);
    live().undo();
    live().undo();
    assert.equal((live().project.reality?.photos[0]?.overlays ?? []).length, 0);
  });
});

describe("PHOTO-05 persist linked overlays", () => {
  it("parseProject keeps overlays + linkedObjectId", () => {
    live().loadProject(seededProject());
    live().addPhotoOverlay("ph1", "intake", 0.25, 0.4);
    const intakeOv = live().project.reality?.photos[0]?.overlays?.[0];
    assert.ok(intakeOv);
    ownerAbs(intakeOv.id, 2.0, 0.4);
    const applied = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    const json = JSON.parse(JSON.stringify(live().project));
    const loaded = parseProject(json);
    const ov = loaded.reality?.photos[0]?.overlays?.[0];
    assert.ok(ov);
    assert.equal(ov!.applied, true);
    assert.ok(ov!.linkedObjectId);
    assert.ok(loaded.openings.some((o) => o.id === ov!.linkedObjectId && o.type === "INTAKE"));
  });
});

describe("PHOTO-06 view selection sync", () => {
  it("select in 2D remains selected in 3D and photo link", () => {
    live().loadProject(seededProject());
    live().addPhotoOverlay("ph1", "exhaust", 0.3, 0.4);
    const exOv = live().project.reality?.photos[0]?.overlays?.[0];
    assert.ok(exOv);
    ownerAbs(exOv.id, 2.4, 0.4);
    const applied = live().applyPhotoOverlaysToModel("ph1");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    const id = live().project.openings.find((o) => o.type === "EXHAUST")!.id;
    live().setView("2d");
    live().select([id]);
    assert.deepEqual(live().selectedIds, [id]);
    live().setView("3d");
    assert.deepEqual(live().selectedIds, [id]);
    live().setView("photo");
    assert.deepEqual(live().selectedIds, [id]);
    const ov = live().project.reality?.photos[0]?.overlays?.[0];
    assert.equal(ov!.linkedObjectId, id);
    live().updateOpening(id, { heightM: 1.1 });
    assert.equal(live().project.openings.find((o) => o.id === id)!.heightM, 1.1);
    live().setView("2d");
    assert.equal(live().project.openings.find((o) => o.id === id)!.heightM, 1.1);
  });
});

describe("PHOTO-07 applyOneOverlay helper is the same validator path", () => {
  it("createPhotoOverlay then applyPhotoOverlays matches store", () => {
    const p = seededProject();
    const photo = p.reality!.photos[0]!;
    const ov = { ...createPhotoOverlay(photo, "door", 0.4, 0.5, "ov_test"), ownerOffsetM: 2, ownerElevationM: 0 };
    const withOv = {
      ...p,
      reality: { ...p.reality!, photos: [{ ...photo, overlays: [ov] }] },
    };
    const r = applyPhotoOverlays(withOv, "ph1");
    assert.equal(r.ok, true, r.errors.join("; "));
    assert.ok(r.project.openings.some((o) => o.type === "DOOR" && o.provenance === "PHOTO_ESTIMATE"));
  });
});

describe("INT-QX03-01 project wall move", () => {
  it("Перенеси вытяжку на северную стену → PROJECT_EDIT", () => {
    const r = routeIntent("Перенеси вытяжку на северную стену");
    assert.equal(r.scope, "PROJECT");
    assert.equal(r.type, "PROJECT_EDIT");
  });
});

describe("INT-QX03-02 reality photo place", () => {
  it("На этом фото поставь две стойки и венткороб → REALITY", () => {
    const r = routeIntent("На этом фото поставь две стойки и венткороб", { hasPhotos: true });
    assert.equal(r.scope, "REALITY");
    assert.equal(r.type, "REALITY_EDIT");
  });
});

describe("INT-QX03-03 application button", () => {
  it("Сделай кнопку 3D больше → APPLICATION", () => {
    const r = routeIntent("Сделай кнопку 3D больше");
    assert.equal(r.scope, "APPLICATION");
    assert.equal(r.type, "APPLICATION_EDIT");
  });
});

describe("PHOTO-08 deleteSelected unlinks overlay", () => {
  it("deleting canonical un-applies overlay, does not drop photo", () => {
    live().loadProject(seededProject());
    live().addPhotoOverlay("ph1", "door", 0.35, 0.5);
    const dOv = live().project.reality?.photos[0]?.overlays?.[0];
    assert.ok(dOv);
    ownerAbs(dOv.id, 2.0, 0);
    assert.equal(live().applyPhotoOverlaysToModel("ph1").ok, true);
    const door = live().project.openings.find((o) => o.type === "DOOR")!;
    live().select([door.id]);
    const del = live().deleteSelected();
    assert.equal(del.ok, true);
    assert.equal(live().project.openings.length, 0);
    const ov = live().project.reality?.photos[0]?.overlays?.[0];
    assert.ok(ov);
    assert.equal(ov!.applied, false);
    assert.equal(ov!.linkedObjectId, undefined);
  });
});
