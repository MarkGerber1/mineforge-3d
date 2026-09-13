import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyRectangularProject } from "../../project/factory.ts";
import type { Opening } from "../types.ts";
import {
  anyPanelOverlapsOpening,
  segmentAllWalls,
  segmentWallPanels,
  wallPointIsAperture,
} from "../apertures.ts";
import { applyFinding } from "../reality.ts";
import { geometryFingerprint } from "../reality.ts";
import { useProjectStore } from "../../project/store.ts";
import { saveScheduler } from "../../project/save-scheduler.ts";
import { emptyReality } from "../types.ts";

function door(partial: Partial<Opening> & Pick<Opening, "id" | "wallId">): Opening {
  return {
    type: "DOOR",
    widthM: 1,
    heightM: 2.1,
    bottomElevationM: 0,
    offsetFromWallStartM: 1,
    name: "door",
    ...partial,
  };
}

function intake(partial: Partial<Opening> & Pick<Opening, "id" | "wallId">): Opening {
  return {
    type: "INTAKE",
    widthM: 1.4,
    heightM: 0.9,
    bottomElevationM: 0.4,
    offsetFromWallStartM: 1.2,
    name: "intake",
    ...partial,
  };
}

saveScheduler.setSave(async () => undefined);

describe("TWIN-OPENING-01 door creates a real aperture", () => {
  it("wall panels do not cover door volume; door center is aperture", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.openings = [door({ id: "d1", wallId: "south" })];
    const panels = segmentWallPanels(p, "south");
    assert.equal(anyPanelOverlapsOpening(panels, p.openings[0]!), false);
    assert.equal(wallPointIsAperture(p, "south", 1.5, 1.0), true);
    assert.equal(wallPointIsAperture(p, "south", 0.2, 1.0), false);
  });
});

describe("TWIN-OPENING-02 INTAKE/EXHAUST width height bottomElevationM", () => {
  it("raised opening leaves wall below sill", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    const o = intake({ id: "in1", wallId: "east" });
    p.openings = [o];
    const panels = segmentWallPanels(p, "east");
    assert.equal(anyPanelOverlapsOpening(panels, o), false);
    assert.equal(wallPointIsAperture(p, "east", o.offsetFromWallStartM + 0.2, 0.1), false);
    assert.equal(wallPointIsAperture(p, "east", o.offsetFromWallStartM + 0.2, 0.8), true);
    const below = panels.some((g) => g.v0 <= 0 + 1e-9 && g.v1 <= o.bottomElevationM + 1e-9 && g.u0 < o.offsetFromWallStartM + o.widthM && g.u1 > o.offsetFromWallStartM);
    assert.equal(below, true);
  });
});

describe("TWIN-OPENING-03 all four wall orientations", () => {
  it("aperture exists on N/S/E/W", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 6, heightM: 2.8 });
    p.openings = [
      door({ id: "s", wallId: "south", offsetFromWallStartM: 2 }),
      door({ id: "n", wallId: "north", offsetFromWallStartM: 2 }),
      door({ id: "w", wallId: "west", offsetFromWallStartM: 1.5 }),
      door({ id: "e", wallId: "east", offsetFromWallStartM: 1.5 }),
    ];
    for (const o of p.openings) {
      const panels = segmentWallPanels(p, o.wallId);
      assert.equal(anyPanelOverlapsOpening(panels, o), false, o.wallId);
      const u = o.offsetFromWallStartM + o.widthM / 2;
      const v = o.bottomElevationM + o.heightM / 2;
      assert.equal(wallPointIsAperture(p, o.wallId, u, v), true, o.wallId);
    }
  });
});

describe("TWIN-OPENING-04 moving opening relocates aperture", () => {
  it("old hole is solid, new hole is open", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.openings = [door({ id: "d1", wallId: "south", offsetFromWallStartM: 1 })];
    assert.equal(wallPointIsAperture(p, "south", 1.5, 1), true);
    p.openings = [door({ id: "d1", wallId: "south", offsetFromWallStartM: 4 })];
    assert.equal(wallPointIsAperture(p, "south", 1.5, 1), false);
    assert.equal(wallPointIsAperture(p, "south", 4.5, 1), true);
    assert.equal(anyPanelOverlapsOpening(segmentWallPanels(p, "south"), p.openings[0]!), false);
  });
});

describe("TWIN-OPENING-05 resizing opening updates aperture", () => {
  it("width change expands hole", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.openings = [door({ id: "d1", wallId: "south", offsetFromWallStartM: 1, widthM: 1 })];
    assert.equal(wallPointIsAperture(p, "south", 2.4, 1), false);
    p.openings = [door({ id: "d1", wallId: "south", offsetFromWallStartM: 1, widthM: 2 })];
    assert.equal(wallPointIsAperture(p, "south", 2.4, 1), true);
  });
});

describe("TWIN-OPENING-06 multiple openings do not cover each other", () => {
  it("two south openings both remain empty", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.openings = [
      door({ id: "d1", wallId: "south", offsetFromWallStartM: 0.5, widthM: 1 }),
      intake({ id: "i1", wallId: "south", offsetFromWallStartM: 3, widthM: 1.4 }),
    ];
    const panels = segmentWallPanels(p, "south");
    for (const o of p.openings) {
      assert.equal(anyPanelOverlapsOpening(panels, o), false, o.id);
    }
    const all = segmentAllWalls(p);
    assert.ok(all.length > 4);
  });
});

describe("TWIN-OPENING-07/08 Undo/Redo restore aperture", () => {
  it("undo and redo restore panel holes", () => {
    const live = () => useProjectStore.getState();
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 }));
    const before = geometryFingerprint(live().project);
    const o = door({ id: "d_undo", wallId: "south" });
    const added = live().addOpening(o);
    assert.equal(added.ok, true);
    assert.equal(wallPointIsAperture(live().project, "south", 1.5, 1), true);
    live().undo();
    assert.equal(geometryFingerprint(live().project), before);
    assert.equal(wallPointIsAperture(live().project, "south", 1.5, 1), false);
    live().redo();
    assert.equal(wallPointIsAperture(live().project, "south", 1.5, 1), true);
  });
});

describe("TWIN-OPENING-09 Reality ADD opening is reflected", () => {
  it("confirmed finding aperture matches canonical opening", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.reality = {
      ...emptyReality(),
      findings: [
        {
          id: "find_door",
          kind: "opening",
          summary: "Door from Reality",
          confidence: "HIGH",
          status: "PENDING",
          opening: door({ id: "d_real", wallId: "west" }),
        },
      ],
    };
    const applied = applyFinding(p, "find_door", "ADDED");
    assert.equal(applied.ok, true);
    const doorO = applied.project.openings.find((o) => o.wallId === "west");
    assert.ok(doorO);
    const panels = segmentWallPanels(applied.project, "west");
    assert.equal(anyPanelOverlapsOpening(panels, doorO!), false);
    assert.equal(wallPointIsAperture(applied.project, "west", 1.5, 1.0), true);
  });
});
