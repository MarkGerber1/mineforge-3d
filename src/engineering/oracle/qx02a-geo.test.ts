import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyFailure } from "../../ai/failure.ts";
import { TEST_ASIC_A } from "../../equipment/asic-catalog.ts";
import { TEST_RACK_A, emptyRectangularProject } from "../../project/factory.ts";
import { saveScheduler } from "../../project/save-scheduler.ts";
import { useProjectStore } from "../../project/store.ts";
import { aabb3Intersects, asBuiltAabb3, rackAabb3 } from "../aabb3.ts";
import {
  fanIsSpatiallyValid,
  openingFullyOnAssignedWall,
  originDeltaForWallResize,
  resizeRectangularRoom,
  validateOpening,
} from "../geometry.ts";
import { alignRacks, generateAutoLayout } from "../layout.ts";
import { validateRacksConfiguration } from "../placement.ts";
import { geometryFingerprint } from "../reality.ts";
import { createWallDragContext, wallCursor, wallDragLengthM } from "../room-resize.ts";
import { applyPatchValidated } from "../upgrade.ts";
import type { AsBuiltObject, Opening, Rack } from "../types.ts";

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

function fanAt(x: number, y: number, id = "f1") {
  return { id, specId: "FAN_STRONG", name: "f", x, y, arrangement: "single" as const, count: 1, dirtyFilter: false };
}

function southDoor(): Opening {
  return {
    id: "door_s",
    type: "DOOR",
    wallId: "south",
    widthM: 1,
    heightM: 2.1,
    bottomElevationM: 0,
    offsetFromWallStartM: 2,
    name: "Door",
  };
}

function asBuiltAt(x: number, y: number, id = "col1"): AsBuiltObject {
  return {
    id,
    kind: "column",
    name: id,
    x,
    y,
    z: 0,
    widthM: 0.4,
    heightM: 2.8,
    depthM: 0.4,
    provenance: "USER_CONFIRMED",
    confidence: "HIGH",
  };
}

function perRackCapacity(): number {
  return 24;
}

describe("MF-SWEEP-001 wall drag event-count invariant", () => {
  it("GEO-WEST-01 west inward 0→1.000 is 7.000 for 1/2/10/50 events", () => {
    const ctx = createWallDragContext("west", 8, 5, 0, 2.5);
    for (const n of [1, 2, 10, 50]) {
      const lastX = 1;
      const events = Array.from({ length: n }, (_, i) => ({ x: (lastX * (i + 1)) / n, y: 2.5 }));
      const lengths = events.map((e) => wallDragLengthM(ctx, e.x, e.y));
      assert.equal(wallDragLengthM(ctx, events[n - 1]!.x, events[n - 1]!.y), 7);
      assert.equal(lengths[lengths.length - 1], 7);
    }
  });

  it("GEO-WEST-02 west outward to x=-1 is 9.000 regardless of event count", () => {
    const ctx = createWallDragContext("west", 8, 5, 0, 2.5);
    for (const n of [1, 2, 10, 50]) {
      const lastX = -1;
      const events = Array.from({ length: n }, (_, i) => ({ x: (lastX * (i + 1)) / n, y: 2.5 }));
      assert.equal(wallDragLengthM(ctx, events[n - 1]!.x, events[n - 1]!.y), 9);
    }
  });

  it("GEO-SOUTH-01 south inward 0→1.000 is 4.000 for 1/2/10/50 events", () => {
    const ctx = createWallDragContext("south", 8, 5, 4, 0);
    for (const n of [1, 2, 10, 50]) {
      const lastY = 1;
      const events = Array.from({ length: n }, (_, i) => ({ x: 4, y: (lastY * (i + 1)) / n }));
      assert.equal(wallDragLengthM(ctx, events[n - 1]!.x, events[n - 1]!.y), 4);
    }
  });

  it("GEO-SOUTH-02 south outward to y=-1 is 6.000 regardless of event count", () => {
    const ctx = createWallDragContext("south", 8, 5, 4, 0);
    for (const n of [1, 2, 10, 50]) {
      const lastY = -1;
      const events = Array.from({ length: n }, (_, i) => ({ x: 4, y: (lastY * (i + 1)) / n }));
      assert.equal(wallDragLengthM(ctx, events[n - 1]!.x, events[n - 1]!.y), 6);
    }
  });

  it("east/north still use start+delta (not previous preview)", () => {
    const e = createWallDragContext("east", 8, 5, 8, 2.5);
    const n = createWallDragContext("north", 8, 5, 4, 5);
    assert.equal(wallDragLengthM(e, 9, 2.5), 9);
    assert.equal(wallDragLengthM(n, 4, 6.25), 6.25);
    const e2 = [8.3, 8.8, 9].map((x) => wallDragLengthM(e, x, 2.5));
    assert.equal(e2[2], 9);
  });

  it("store preview moves never accumulate west origin shift", () => {
    for (const n of [1, 2, 10, 50]) {
      live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
      live().addRack(rackAt(4, 1, "r"));
      const ctx = createWallDragContext("west", 8, 5, 0, 2.5);
      for (let i = 1; i <= n; i++) {
        const x = i / n;
        live().resizeWall("west", wallDragLengthM(ctx, x, 2.5), true);
      }
      const committed = live().resizeWall("west", 7, false);
      assert.equal(committed.ok, true);
      const s = live();
      assert.equal(s.project.room.widthM, 7);
      assert.equal(s.project.racks[0]!.x, 3);
      assert.equal(s.preview, null);
    }
  });
});

describe("MF-SWEEP-002 preview never leaks into canonical", () => {
  it("GEO-CANON-01 setPreview then canonical mutation uses project", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    const fp = geometryFingerprint(live().project);
    live().resizeWall("east", 9, true);
    assert.equal(live().project.room.widthM, 8);
    assert.equal(live().preview?.room.widthM, 9);
    const added = live().addOpening(southDoor());
    assert.equal(added.ok, true);
    assert.equal(live().project.room.widthM, 8);
    assert.equal(live().project.openings.length, 1);
    assert.equal(live().preview, null);
    assert.notEqual(geometryFingerprint(live().project), fp);
  });

  it("FAN FAIL + wall resize does not drop canonical fan", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.fans = [fanAt(6, 2)];
    live().loadProject(p);
    assert.equal(live().project.fans.length, 1);
    live().setFailureSim("fan-fail");
    assert.equal(live().live().fans.length, 0);
    assert.equal(live().project.fans.length, 1);
    const ok = live().resizeWall("east", 9, false);
    assert.equal(ok.ok, true);
    assert.equal(live().project.room.widthM, 9);
    assert.equal(live().project.fans.length, 1);
    assert.equal(live().project.fans[0]!.x, 6);
    live().setFailureSim("none");
    assert.equal(live().project.fans.length, 1);
    assert.equal(live().live().fans.length, 1);
  });

  it("POWER CUT + opening edit leaves electrical canonical", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.electrical.availablePowerW = 100000;
    p.electrical.known = true;
    p.openings = [southDoor()];
    live().loadProject(p);
    const before = live().project.electrical.availablePowerW;
    live().setFailureSim("power-cut");
    assert.ok(live().live().electrical.availablePowerW < before);
    const res = live().updateOpening("door_s", { offsetFromWallStartM: 2.5 }, false);
    assert.equal(res.ok, true);
    assert.equal(live().project.electrical.availablePowerW, before);
    assert.equal(live().project.openings[0]!.offsetFromWallStartM, 2.5);
    live().setFailureSim("none");
    assert.equal(live().project.electrical.availablePowerW, before);
  });

  it("dirty-filter / intake / exhaust simulations stay non-canonical", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.openings = [
      southDoor(),
      {
        id: "in1",
        type: "INTAKE",
        wallId: "west",
        widthM: 1.2,
        heightM: 0.9,
        bottomElevationM: 0.4,
        offsetFromWallStartM: 1,
      },
      {
        id: "ex1",
        type: "EXHAUST",
        wallId: "east",
        widthM: 1.4,
        heightM: 0.9,
        bottomElevationM: 0.4,
        offsetFromWallStartM: 1,
      },
    ];
    p.ventilation.dirtyFilter = false;
    live().loadProject(p);
    const fp = geometryFingerprint(live().project);
    live().setFailureSim("dirty-filter");
    assert.equal(live().project.ventilation.dirtyFilter, false);
    live().setFailureSim("intake-blocked");
    assert.equal(live().project.openings.find((o) => o.id === "in1")!.widthM, 1.2);
    assert.ok(live().live().openings.find((o) => o.id === "in1")!.widthM < 1.2);
    live().resizeWall("north", 5.5, false);
    live().setFailureSim("exhaust-blocked");
    live().setFailureSim("none");
    assert.equal(live().project.openings.find((o) => o.id === "in1")!.widthM, 1.2);
    assert.equal(live().project.openings.find((o) => o.id === "ex1")!.widthM, 1.4);
    assert.equal(live().project.room.depthM, 5.5);
    assert.notEqual(geometryFingerprint(live().project), fp);
  });
});

describe("MF-SWEEP-003 full coordinate-frame rebase", () => {
  it("GEO-WEST-03 west resize keeps east-relative rack and as-built, collision invariant", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.racks = [rackAt(4, 1.5, "r")];
    p.reality!.asBuilt = [asBuiltAt(4.1, 1.55, "col")];
    p.reality!.findings = [
      {
        id: "fnd",
        kind: "column",
        summary: "col",
        confidence: "HIGH",
        status: "PENDING",
        estimated: {
          kind: "column",
          name: "est",
          x: 4.1,
          y: 1.55,
          z: 0,
          widthM: 0.4,
          heightM: 2.8,
          depthM: 0.4,
          provenance: "USER_CONFIRMED",
          confidence: "HIGH",
        },
      },
    ];
    const beforeHit = aabb3Intersects(rackAabb3(p.racks[0]!), asBuiltAabb3(p.reality!.asBuilt[0]!));
    const eastGapRack = 8 - p.racks[0]!.x;
    const eastGapCol = 8 - p.reality!.asBuilt[0]!.x;
    const next = resizeRectangularRoom(p, "west", 7);
    assert.equal(next.room.widthM, 7);
    assert.equal(next.racks[0]!.x, 3);
    assert.ok(Math.abs(next.reality!.asBuilt[0]!.x - 3.1) < 1e-9);
    assert.equal(7 - next.racks[0]!.x, eastGapRack);
    assert.ok(Math.abs(7 - next.reality!.asBuilt[0]!.x - eastGapCol) < 1e-9);
    assert.equal(next.racks[0]!.y, p.racks[0]!.y);
    assert.ok(Math.abs(next.reality!.findings[0]!.estimated!.x - 3.1) < 1e-9);
    const afterHit = aabb3Intersects(rackAabb3(next.racks[0]!), asBuiltAabb3(next.reality!.asBuilt[0]!));
    assert.equal(afterHit, beforeHit);
    assert.equal(originDeltaForWallResize("west", 8, 7).dx, -1);
  });

  it("GEO-SOUTH-03 south resize keeps north-relative geometry", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.racks = [rackAt(2, 2, "r")];
    p.reality!.asBuilt = [asBuiltAt(2.1, 2.1, "col")];
    const northGap = 5 - 2;
    const next = resizeRectangularRoom(p, "south", 4);
    assert.equal(next.room.depthM, 4);
    assert.equal(next.racks[0]!.y, 1);
    assert.equal(next.reality!.asBuilt[0]!.y, 1.1);
    assert.equal(4 - next.racks[0]!.y, northGap);
  });

  it("GEO-WEST-04 undo/redo restores exact rebase states", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().addRack(rackAt(4, 1, "r"));
    live().addAsBuilt(asBuiltAt(5, 2));
    const pre = geometryFingerprint(live().project);
    live().resizeWall("west", 7, false);
    const mid = geometryFingerprint(live().project);
    assert.equal(live().project.racks[0]!.x, 3);
    live().undo();
    assert.equal(geometryFingerprint(live().project), pre);
    live().redo();
    assert.equal(geometryFingerprint(live().project), mid);
  });
});

describe("MF-SWEEP-013 shared rack transform validation", () => {
  it("GEO-ALIGN-01 align left overlap is rejected, canonical unchanged", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.racks = [rackAt(1, 1, "a"), rackAt(3, 1.1, "b")];
    live().loadProject(p);
    live().select(["a", "b"]);
    const fp = geometryFingerprint(live().project);
    const res = live().alignSelection("left");
    assert.equal(res.ok, false);
    assert.ok(res.errors.length > 0);
    assert.equal(geometryFingerprint(live().project), fp);
    assert.equal(live().project.racks.find((r) => r.id === "b")!.x, 3);
  });

  it("align/center/distribute/rotate/duplicate each go through validator", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.racks = [rackAt(1, 2, "a"), rackAt(3.5, 1, "b")];
    live().loadProject(p);
    live().select(["a", "b"]);
    assert.equal(live().alignSelection("bottom").ok, true);
    assert.equal(live().project.racks.find((r) => r.id === "a")!.y, 1);

    const p2 = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p2.racks = [rackAt(1, 1, "a"), rackAt(3.5, 1, "b"), rackAt(6, 1, "c")];
    live().loadProject(p2);
    live().select(["a", "b", "c"]);
    assert.equal(live().alignSelection("centerY").ok, true);
    live().select(["a", "b", "c"]);
    assert.equal(live().distributeSelection("x").ok, true);

    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().addRack(rackAt(3, 2, "spin"));
    live().select(["spin"]);
    assert.equal(live().rotateSelectedRack().ok, true);
    assert.equal(live().project.racks[0]!.rotationDeg, 90);

    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().addRack(rackAt(1, 1, "solo"));
    live().select(["solo"]);
    const dup = live().duplicateSelectedRack();
    assert.equal(dup.ok, true, dup.errors.join("; "));
    assert.equal(live().project.racks.length, 2);

    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().addRack(rackAt(6.2, 4.3, "edge"));
    live().select(["edge"]);
    const rot = live().rotateSelectedRack();
    assert.equal(rot.ok, false);
    assert.equal(live().project.racks[0]!.rotationDeg, 0);
  });

  it("outside / door-swing transforms do not commit", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.openings = [southDoor()];
    p.racks = [rackAt(0.4, 1.2, "a"), rackAt(3, 2.2, "b")];
    const aligned = alignRacks(p.racks, ["a", "b"], "left");
    const v = validateRacksConfiguration(p, aligned, ["a", "b"]);
    assert.equal(v.ok, true);
    p.racks = [rackAt(2.05, 1.5, "a"), rackAt(4, 0.05, "b")];
    live().loadProject(p);
    live().select(["a", "b"]);
    const fp = geometryFingerprint(live().project);
    const res = live().alignSelection("bottom");
    assert.equal(res.ok, false);
    assert.equal(geometryFingerprint(live().project), fp);
  });
});

describe("MF-SWEEP-014 auto layout target", () => {
  it("GEO-AUTO-01 target matrix 0 / 1 / perRack-1 / perRack / perRack+1", () => {
    const perRack = perRackCapacity();
    assert.equal(perRack, 24);
    const run = (target: number) => {
      const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
      p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: target, imported: TEST_ASIC_A };
      return generateAutoLayout(p, TEST_ASIC_A);
    };
    assert.deepEqual(run(0), []);
    const t1 = run(1);
    assert.equal(t1.length, 1);
    assert.equal(t1[0]!.asicCount, 1);
    const t23 = run(perRack - 1);
    assert.equal(t23.length, 1);
    assert.equal(t23[0]!.asicCount, perRack - 1);
    const t24 = run(perRack);
    assert.equal(t24.length, 1);
    assert.equal(t24[0]!.asicCount, perRack);
    const t25 = run(perRack + 1);
    assert.equal(t25.length, 2);
    assert.equal(t25[0]!.asicCount, perRack);
    assert.equal(t25[1]!.asicCount, 1);
    assert.ok(t25.every((r) => r.asicCount <= perRack));

    live().loadProject(
      (() => {
        const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
        p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 0, imported: TEST_ASIC_A };
        return p;
      })(),
    );
    const auto = live().autoLayout();
    assert.equal(auto.ok, true);
    assert.equal(live().project.racks.length, 0);
  });
});

describe("MF-SWEEP-015 applyPatch validation", () => {
  it("GEO-PATCH-01 valid opening patch accepted", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.openings = [
      {
        id: "ex",
        type: "EXHAUST",
        wallId: "east",
        widthM: 0.9,
        heightM: 0.9,
        bottomElevationM: 0.4,
        offsetFromWallStartM: 1,
      },
    ];
    const nextOpenings = p.openings.map((o) => (o.id === "ex" ? { ...o, widthM: 1.4 } : o));
    const res = applyPatchValidated(p, { openings: nextOpenings });
    assert.equal(res.ok, true);
    assert.equal(res.project.openings[0]!.widthM, 1.4);
  });

  it("GEO-PATCH-02 over-wall patch rejected, canonical unchanged", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.openings = [
      {
        id: "ex",
        type: "EXHAUST",
        wallId: "east",
        widthM: 0.9,
        heightM: 0.9,
        bottomElevationM: 0.4,
        offsetFromWallStartM: 1,
      },
    ];
    const original = structuredClone(p);
    const tooWide = p.openings.map((o) => (o.id === "ex" ? { ...o, widthM: 9 } : o));
    const res = applyPatchValidated(p, { openings: tooWide });
    assert.equal(res.ok, false);
    assert.equal(res.project.openings[0]!.widthM, 0.9);
    assert.deepEqual(p.openings, original.openings);
    live().loadProject(p);
    live().propose({
      id: "bad",
      summary: "widen past wall",
      detail: "invalid",
      patch: { openings: tooWide },
      fromGrok: true,
    });
    const applied = live().applyProposed();
    assert.equal(applied.ok, false);
    assert.equal(live().project.openings[0]!.widthM, 0.9);
  });

  it("east/west longitudinal span is depth, not width", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.openings = [
      {
        id: "ex",
        type: "EXHAUST",
        wallId: "east",
        widthM: 1.4,
        heightM: 0.9,
        bottomElevationM: 0.4,
        offsetFromWallStartM: 3.8,
      },
    ];
    const span = 5 - 3.8;
    const too = p.openings.map((o) => (o.id === "ex" ? { ...o, widthM: span + 0.5 } : o));
    const res = applyPatchValidated(p, { openings: too });
    assert.equal(res.ok, false);
    const okw = p.openings.map((o) => (o.id === "ex" ? { ...o, widthM: span } : o));
    assert.equal(applyPatchValidated(p, { openings: okw }).ok, true);
  });
});

describe("MF-SWEEP-017 fan spatial integrity", () => {
  it("GEO-FAN-01 east/north shrink past fan is not a valid operational fan", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.fans = [fanAt(7.2, 4.2)];
    assert.equal(fanIsSpatiallyValid(p, p.fans[0]!), true);
    const east = resizeRectangularRoom(p, "east", 7.0);
    assert.equal(fanIsSpatiallyValid(east, east.fans[0]!), false);
    const north = resizeRectangularRoom(p, "north", 4.5);
    assert.equal(fanIsSpatiallyValid(north, north.fans[0]!), false);
    live().loadProject(p);
    live().resizeWall("east", 7.0, false);
    assert.equal(live().project.fans[0]!.x, 7.2);
    assert.equal(fanIsSpatiallyValid(live().project, live().project.fans[0]!), false);
    assert.equal(live().result.fan.pass, null);
    assert.match(live().result.fan.reason, /outside/);
  });

  it("GEO-FAN-02 west/south rebase keeps fan physically inside when it started inside", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.fans = [fanAt(3, 2)];
    const w = resizeRectangularRoom(p, "west", 7);
    assert.equal(w.fans[0]!.x, 2);
    assert.equal(fanIsSpatiallyValid(w, w.fans[0]!), true);
    const s = resizeRectangularRoom(p, "south", 4);
    assert.equal(s.fans[0]!.y, 1);
    assert.equal(fanIsSpatiallyValid(s, s.fans[0]!), true);
    live().loadProject(p);
    live().resizeWall("west", 7, false);
    live().undo();
    assert.equal(live().project.fans[0]!.x, 3);
    live().redo();
    assert.equal(live().project.fans[0]!.x, 2);
  });
});

describe("MF-SWEEP-023 wall cursor", () => {
  it("east/west ew-resize, north/south ns-resize", () => {
    assert.equal(wallCursor("east"), "ew-resize");
    assert.equal(wallCursor("west"), "ew-resize");
    assert.equal(wallCursor("north"), "ns-resize");
    assert.equal(wallCursor("south"), "ns-resize");
  });
});

describe("GEO-OPEN-01 assigned wall AABB", () => {
  it("north opening claimed as south is invalid", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    const north: Opening = {
      id: "n1",
      type: "INTAKE",
      wallId: "north",
      widthM: 1.4,
      heightM: 0.9,
      bottomElevationM: 0.4,
      offsetFromWallStartM: 2,
    };
    p.openings = [north];
    assert.equal(validateOpening(p, north).ok, true);
    assert.equal(openingFullyOnAssignedWall(p, north, "north"), true);
    assert.equal(openingFullyOnAssignedWall(p, north, "south"), false);
    const east: Opening = { ...north, id: "e1", wallId: "east", offsetFromWallStartM: 1 };
    assert.equal(openingFullyOnAssignedWall(p, east, "east"), true);
    assert.equal(openingFullyOnAssignedWall(p, east, "west"), false);
  });
});

describe("GEO-CANON-02 2D/3D/Inspector/undo share project", () => {
  it("after geometry mutation live equals canonical when sim is off", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    live().addRack(rackAt(2, 2, "r"));
    live().setFan("FAN_STRONG", 1, "single");
    live().resizeWall("west", 7, false);
    const s = live();
    assert.equal(s.failureSim, "none");
    assert.equal(s.preview, null);
    assert.equal(s.live(), s.project);
    assert.equal(s.canonical(), s.project);
    assert.equal(s.result.geometry.floorAreaM2, 7 * 5);
    live().undo();
    assert.equal(live().project.room.widthM, 8);
    live().redo();
    assert.equal(live().project.room.widthM, 7);
    assert.equal(live().result.geometry.floorAreaM2, 35);
  });
});

describe("failure applyFailure still clones", () => {
  it("does not mutate source", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5 });
    src.fans = [fanAt(4, 2)];
    const failed = applyFailure(src, "fan-fail");
    assert.equal(failed.fans.length, 0);
    assert.equal(src.fans.length, 1);
  });
});
