import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TEST_RACK_A, emptyRectangularProject } from "../../project/factory.ts";
import { saveScheduler } from "../../project/save-scheduler.ts";
import { useProjectStore } from "../../project/store.ts";
import { duplicateRackOffset, uniqueRackId } from "../layout.ts";
import { validateRacksConfiguration } from "../placement.ts";
import { geometryFingerprint } from "../reality.ts";
import { pickWallHit, resolveWallDragTarget } from "../room-resize.ts";
import type { Rack } from "../types.ts";

saveScheduler.setSave(async () => undefined);

function live() {
  return useProjectStore.getState();
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

function measureFp(m: { a: { x: number; y: number } | null; b: { x: number; y: number } | null }) {
  return JSON.stringify(m);
}

function ids(racks: Rack[]) {
  return racks.map((r) => r.id);
}

function unique(list: string[]) {
  return new Set(list).size === list.length;
}

describe("R1 DUP-ID unique rack identity", () => {
  it("DUP-ID-01 duplicate once yields a unique new id", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().addRack(rackAt(1, 1, "src"));
    live().select(["src"]);
    const res = live().duplicateSelectedRack();
    assert.equal(res.ok, true, res.errors.join("; "));
    const racks = live().project.racks;
    assert.equal(racks.length, 2);
    assert.ok(unique(ids(racks)));
    assert.ok(racks.some((r) => r.id === "src"));
    assert.ok(racks.some((r) => r.id !== "src"));
    assert.notEqual(racks.find((r) => r.id !== "src")!.id, "src");
  });

  it("DUP-ID-02 select original, Duplicate twice → 3 unique ids", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().addRack(rackAt(1, 1, "src"));
    live().select(["src"]);
    assert.equal(live().duplicateSelectedRack().ok, true);
    assert.equal(live().duplicateSelectedRack().ok, true);
    const racks = live().project.racks;
    assert.equal(racks.length, 3);
    assert.ok(unique(ids(racks)), String(ids(racks)));
  });

  it("DUP-ID-03 duplicate the same original 3 times → unique ids", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().addRack(rackAt(1, 1, "src"));
    live().select(["src"]);
    for (let i = 0; i < 3; i++) {
      const r = live().duplicateSelectedRack();
      assert.equal(r.ok, true, r.errors.join("; "));
    }
    const racks = live().project.racks;
    assert.equal(racks.length, 4);
    assert.ok(unique(ids(racks)), String(ids(racks)));
  });

  it("DUP-ID-04 ten duplicates: unique ids or fail-closed; never duplicate ids", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().addRack(rackAt(1, 1, "src"));
    live().select(["src"]);
    for (let i = 0; i < 10; i++) {
      live().duplicateSelectedRack();
      assert.ok(unique(ids(live().project.racks)), String(ids(live().project.racks)));
    }
    assert.ok(live().project.racks.length >= 2);
    assert.ok(unique(ids(live().project.racks)));
  });

  it("DUP-ID-05 artificial nextRacks with two identical ids FAIL", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.racks = [rackAt(1, 1, "a")];
    const twin = { ...rackAt(3, 1, "a"), name: "imposter" };
    const v = validateRacksConfiguration(p, [p.racks[0]!, twin], ["a"]);
    assert.equal(v.ok, false);
    assert.equal(v.code, "DUPLICATE_ID");
  });

  it("DUP-ID-06 duplicate-id bypass cannot commit overlap", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().addRack(rackAt(1, 1, "src"));
    const src = live().project.racks[0]!;
    const fake = { ...src, x: src.x, y: src.y };
    const v = validateRacksConfiguration(live().project, [src, fake], [src.id]);
    assert.equal(v.ok, false);
    assert.equal(v.code, "DUPLICATE_ID");
    const fp = geometryFingerprint(live().project);
    live().select(["src"]);
    const beforeSel = [...live().selectedIds];
    const overlapping = duplicateRackOffset([src], "src", 0, 0);
    assert.ok(overlapping);
    overlapping.id = src.id;
    const next = [...live().project.racks, overlapping];
    const v2 = validateRacksConfiguration(live().project, next, [overlapping.id]);
    assert.equal(v2.ok, false);
    assert.equal(geometryFingerprint(live().project), fp);
    assert.deepEqual(live().selectedIds, beforeSel);
  });

  it("DUP-ID-07 undo/redo after duplicate keeps ids", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().addRack(rackAt(1, 1, "src"));
    live().select(["src"]);
    assert.equal(live().duplicateSelectedRack().ok, true);
    const after = ids(live().project.racks).slice().sort();
    assert.equal(after.length, 2);
    live().undo();
    assert.deepEqual(ids(live().project.racks), ["src"]);
    live().redo();
    assert.deepEqual(ids(live().project.racks).slice().sort(), after);
  });

  it("uniqueRackId is collision-free for the same base", () => {
    const existing = ["r1", "r1_copy"];
    assert.equal(uniqueRackId(existing, "r1"), "r1_copy2");
    assert.equal(uniqueRackId(["r1"], "r1"), "r1_copy");
    const many = ["src"];
    const out = new Set<string>(many);
    for (let i = 0; i < 20; i++) {
      const id = uniqueRackId(out, "src");
      assert.equal(out.has(id), false);
      out.add(id);
    }
  });

  it("invalid duplication leaves canonical and selection unchanged", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().addRack(rackAt(6.2, 4.2, "edge"));
    live().select(["edge"]);
    const fp = geometryFingerprint(live().project);
    const sel = [...live().selectedIds];
    const res = live().duplicateSelectedRack();
    assert.equal(res.ok, false);
    assert.ok(res.errors[0]);
    assert.equal(geometryFingerprint(live().project), fp);
    assert.deepEqual(live().selectedIds, sel);
    assert.ok(live().lastMutationError);
  });
});

describe("R2 WALL-CORNER nearest wall is authoritative", () => {
  const W = 8;
  const D = 5;
  const tol = 0.67;

  it("WALL-CORNER-01 NW / near-NW west even if event.target is north", () => {
    assert.equal(resolveWallDragTarget(0, 4.7, W, D, tol, "north"), "west");
    assert.equal(resolveWallDragTarget(0, 4.58, W, D, tol, "north"), "west");
    assert.equal(pickWallHit(0, 4.7, W, D, tol), "west");
    const eventTargetFirst = "north" as const;
    const oldImpl = eventTargetFirst || pickWallHit(0, 4.7, W, D, tol);
    assert.equal(oldImpl, "north");
  });

  it("WALL-CORNER-02 near north but not west → north", () => {
    assert.equal(resolveWallDragTarget(1.2, 5, W, D, tol, "west"), "north");
    assert.equal(resolveWallDragTarget(1.2, 5, W, D, tol, "north"), "north");
  });

  it("WALL-CORNER-03 NE corner is deterministic (east over north on tie)", () => {
    assert.equal(pickWallHit(8, 5, W, D, tol), "east");
    assert.equal(resolveWallDragTarget(8, 5, W, D, tol, "north"), "east");
    assert.equal(resolveWallDragTarget(8, 4.7, W, D, tol, "north"), "east");
  });

  it("WALL-CORNER-04 SW corner is deterministic (west over south on tie)", () => {
    assert.equal(pickWallHit(0, 0, W, D, tol), "west");
    assert.equal(resolveWallDragTarget(0, 0, W, D, tol, "south"), "west");
    assert.equal(resolveWallDragTarget(0, 0.3, W, D, tol, "south"), "west");
  });

  it("WALL-CORNER-05 SE corner is deterministic (east over south on tie)", () => {
    assert.equal(pickWallHit(8, 0, W, D, tol), "east");
    assert.equal(resolveWallDragTarget(8, 0, W, D, tol, "south"), "east");
    assert.equal(resolveWallDragTarget(8, 0.3, W, D, tol, "south"), "east");
  });

  it("WALL-CORNER-06 mid-wall west/south/east/north unchanged", () => {
    assert.equal(resolveWallDragTarget(0, 2.5, W, D, tol, "north"), "west");
    assert.equal(resolveWallDragTarget(1.5, 0, W, D, tol, "west"), "south");
    assert.equal(resolveWallDragTarget(8, 2.5, W, D, tol, "south"), "east");
    assert.equal(resolveWallDragTarget(4, 5, W, D, tol, "east"), "north");
    assert.equal(resolveWallDragTarget(4, 2.5, W, D, tol, null), null);
  });
});

describe("R3 MEASURE-HIST undo/redo restores A/B", () => {
  it("MEASURE-HIST-01 west resize shifts A/B; undo restores exact originals", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    const a = { x: 2, y: 1.5 };
    const b = { x: 4, y: 3 };
    live().setMeasure({ a, b });
    const before = measureFp(live().measure);
    const ok = live().resizeWall("west", 7, false);
    assert.equal(ok.ok, true);
    assert.equal(live().measure.a?.x, 1);
    assert.equal(live().measure.a?.y, 1.5);
    assert.equal(live().measure.b?.x, 3);
    assert.equal(live().measure.b?.y, 3);
    live().undo();
    assert.equal(live().project.room.widthM, 8);
    assert.equal(measureFp(live().measure), before);
    assert.equal(live().measure.a?.x, 2);
    assert.equal(live().measure.b?.x, 4);
  });

  it("MEASURE-HIST-02 redo restores shifted A/B", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().setMeasure({ a: { x: 2, y: 1.5 }, b: { x: 4, y: 3 } });
    live().resizeWall("west", 7, false);
    const shifted = measureFp(live().measure);
    live().undo();
    live().redo();
    assert.equal(live().project.room.widthM, 7);
    assert.equal(measureFp(live().measure), shifted);
    assert.equal(live().measure.a?.x, 1);
    assert.equal(live().measure.b?.x, 3);
  });

  it("MEASURE-HIST-03 south resize / undo / redo on dy", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().setMeasure({ a: { x: 2, y: 1.5 }, b: { x: 4, y: 3 } });
    const before = measureFp(live().measure);
    live().resizeWall("south", 4, false);
    assert.equal(live().measure.a?.y, 0.5);
    assert.equal(live().measure.b?.y, 2);
    const shifted = measureFp(live().measure);
    live().undo();
    assert.equal(measureFp(live().measure), before);
    live().redo();
    assert.equal(measureFp(live().measure), shifted);
  });

  it("MEASURE-HIST-04 east/north do not shift A/B through resize/undo/redo", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().setMeasure({ a: { x: 2, y: 1.5 }, b: { x: 4, y: 3 } });
    const before = measureFp(live().measure);
    live().resizeWall("east", 9, false);
    assert.equal(measureFp(live().measure), before);
    live().undo();
    assert.equal(measureFp(live().measure), before);
    live().redo();
    assert.equal(measureFp(live().measure), before);
    live().resizeWall("north", 6, false);
    assert.equal(measureFp(live().measure), before);
    live().undo();
    assert.equal(measureFp(live().measure), before);
  });

  it("MEASURE-HIST-05 west then south, undo/undo, redo/redo fingerprints", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().setMeasure({ a: { x: 2, y: 1.5 }, b: { x: 4, y: 3 } });
    const s0 = {
      g: geometryFingerprint(live().project),
      m: measureFp(live().measure),
      w: live().project.room.widthM,
      d: live().project.room.depthM,
    };
    live().resizeWall("west", 7, false);
    const s1 = {
      g: geometryFingerprint(live().project),
      m: measureFp(live().measure),
      w: live().project.room.widthM,
      d: live().project.room.depthM,
    };
    live().resizeWall("south", 4, false);
    const s2 = {
      g: geometryFingerprint(live().project),
      m: measureFp(live().measure),
      w: live().project.room.widthM,
      d: live().project.room.depthM,
    };
    live().undo();
    assert.equal(geometryFingerprint(live().project), s1.g);
    assert.equal(measureFp(live().measure), s1.m);
    assert.equal(live().project.room.widthM, 7);
    assert.equal(live().project.room.depthM, 5);
    live().undo();
    assert.equal(geometryFingerprint(live().project), s0.g);
    assert.equal(measureFp(live().measure), s0.m);
    live().redo();
    assert.equal(geometryFingerprint(live().project), s1.g);
    assert.equal(measureFp(live().measure), s1.m);
    live().redo();
    assert.equal(geometryFingerprint(live().project), s2.g);
    assert.equal(measureFp(live().measure), s2.m);
    assert.equal(live().project.room.widthM, 7);
    assert.equal(live().project.room.depthM, 4);
  });

  it("MEASURE-HIST-06 cancel wall preview leaves measure unchanged", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().setMeasure({ a: { x: 2, y: 1.5 }, b: { x: 4, y: 3 } });
    const before = measureFp(live().measure);
    const fp = geometryFingerprint(live().project);
    live().resizeWall("west", 7, true);
    assert.equal(live().project.room.widthM, 8);
    assert.equal(measureFp(live().measure), before);
    live().setPreview(null);
    assert.equal(measureFp(live().measure), before);
    assert.equal(geometryFingerprint(live().project), fp);
    assert.equal(live().preview, null);
  });
});
