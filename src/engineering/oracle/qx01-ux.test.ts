import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_ROOM_DIM_M, MIN_ROOM_DIM_M } from "../constants.ts";
import { resizeRectangularRoom } from "../geometry.ts";
import { validateRackPlacement } from "../placement.ts";
import { geometryFingerprint } from "../reality.ts";
import { validateRoomLengthInput, validateRoomLengthM, wallResizeContract } from "../room-resize.ts";
import { emptyRectangularProject, TEST_RACK_A } from "../../project/factory.ts";
import { saveScheduler } from "../../project/save-scheduler.ts";
import { useProjectStore } from "../../project/store.ts";
import type { Opening, Rack } from "../types.ts";

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

function southDoor(pWidth = 8): Opening {
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

describe("WALL-RESIZE-01 East numeric resize with West fixed", () => {
  it("east moves, origin stays, west face at x=0", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5 });
    src.racks = [rackAt(1, 1)];
    const next = resizeRectangularRoom(src, "east", 9);
    assert.equal(next.room.widthM, 9);
    assert.equal(next.racks[0]!.x, 1);
    assert.equal(wallResizeContract("east").fixed, "west");
    assert.equal(wallResizeContract("east").moving, "east");
  });
});

describe("WALL-RESIZE-02 West numeric resize with East fixed", () => {
  it("west moves and shifts racks", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5 });
    src.racks = [rackAt(2, 1)];
    src.fans = [{ id: "f1", specId: "FAN_STRONG", name: "f", x: 3, y: 2, arrangement: "single", count: 1, dirtyFilter: false }];
    const next = resizeRectangularRoom(src, "west", 9);
    assert.equal(next.room.widthM, 9);
    assert.equal(next.racks[0]!.x, 3);
    assert.equal(next.fans[0]!.x, 4);
    assert.equal(wallResizeContract("west").fixed, "east");
  });
});

describe("WALL-RESIZE-03 North numeric resize with South fixed", () => {
  it("north moves, south origin y=0", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5 });
    src.racks = [rackAt(1, 1)];
    const next = resizeRectangularRoom(src, "north", 6);
    assert.equal(next.room.depthM, 6);
    assert.equal(next.racks[0]!.y, 1);
  });
});

describe("WALL-RESIZE-04 South numeric resize with North fixed", () => {
  it("south moves and shifts racks in y", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5 });
    src.racks = [rackAt(1, 2)];
    const next = resizeRectangularRoom(src, "south", 6);
    assert.equal(next.room.depthM, 6);
    assert.equal(next.racks[0]!.y, 3);
    assert.equal(wallResizeContract("south").fixed, "north");
  });
});

describe("WALL-RESIZE-05 origin-side wall preserves rack/fan coords", () => {
  it("east/north do not translate contents", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5 });
    src.racks = [rackAt(1.25, 1.5)];
    src.fans = [{ id: "f1", specId: "FAN_STRONG", name: "f", x: 4, y: 2, arrangement: "single", count: 1, dirtyFilter: false }];
    const e = resizeRectangularRoom(src, "east", 10);
    const n = resizeRectangularRoom(src, "north", 7);
    assert.equal(e.racks[0]!.x, 1.25);
    assert.equal(e.fans[0]!.x, 4);
    assert.equal(n.racks[0]!.y, 1.5);
    assert.equal(n.fans[0]!.y, 2);
  });
});

describe("WALL-RESIZE-06 perpendicular-wall openings keep placement", () => {
  it("west resize shifts south-wall offsets", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5 });
    src.openings = [southDoor()];
    const next = resizeRectangularRoom(src, "west", 9);
    assert.equal(next.openings[0]!.offsetFromWallStartM, 3);
    const north = resizeRectangularRoom(src, "south", 6);
    assert.equal(north.openings[0]!.offsetFromWallStartM, 2);
  });
});

describe("WALL-RESIZE-07 UI contract labels", () => {
  it("each wall has explicit fixed/moving Russian copy", () => {
    assert.match(wallResizeContract("east").labelRu, /Западная/);
    assert.match(wallResizeContract("west").labelRu, /Восточная/);
    assert.match(wallResizeContract("north").labelRu, /Южная/);
    assert.match(wallResizeContract("south").labelRu, /Северная/);
  });
});

describe("WALL-RESIZE-08 Cancel leaves canonical fingerprint unchanged", () => {
  it("preview then clear does not commit", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    const fp = geometryFingerprint(live().project);
    live().resizeWall("east", 9, true);
    assert.equal(live().project.room.widthM, 8);
    live().setPreview(null);
    assert.equal(geometryFingerprint(live().project), fp);
  });
});

describe("WALL-RESIZE-09/10 Undo/Redo fingerprints", () => {
  it("undo restores pre, redo restores post", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    const pre = geometryFingerprint(live().project);
    const ok = live().resizeWall("south", 6.5, false);
    assert.equal(ok.ok, true);
    const post = geometryFingerprint(live().project);
    assert.equal(live().project.room.depthM, 6.5);
    live().undo();
    assert.equal(geometryFingerprint(live().project), pre);
    live().redo();
    assert.equal(geometryFingerprint(live().project), post);
  });
});

describe("DIM-VALIDATION-01 0.20 m rejected", () => {
  it("visible min reason, project unchanged", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    const fp = geometryFingerprint(live().project);
    const parsed = validateRoomLengthInput("0.20 m");
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.code, "MIN");
    const res = live().resizeWall("east", 0.2, false);
    assert.equal(res.ok, false);
    assert.equal(geometryFingerprint(live().project), fp);
    assert.equal(live().project.room.widthM, 8);
  });
});

describe("DIM-VALIDATION-02 zero rejected", () => {
  it("zero", () => {
    const v = validateRoomLengthInput("0");
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.code, "ZERO");
  });
});

describe("DIM-VALIDATION-03 negative rejected", () => {
  it("negative", () => {
    const v = validateRoomLengthInput("-1 m");
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.code, "NEGATIVE");
  });
});

describe("DIM-VALIDATION-04 invalid text rejected", () => {
  it("garbage", () => {
    const v = validateRoomLengthInput("abc");
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.code, "PARSE");
  });
});

describe("DIM-VALIDATION-05 blank rejected", () => {
  it("blank", () => {
    const v = validateRoomLengthInput("   ");
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.code, "BLANK");
  });
});

describe("DIM-VALIDATION-06 0.50 m accepted exactly", () => {
  it("minimum accepted", () => {
    const v = validateRoomLengthM(MIN_ROOM_DIM_M);
    assert.equal(v.ok, true);
    if (v.ok) assert.equal(v.meters, 0.5);
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    const res = live().resizeWall("east", 0.5, false);
    assert.equal(res.ok, true);
    assert.equal(live().project.room.widthM, 0.5);
  });
});

describe("DIM-VALIDATION-07 above maximum rejected", () => {
  it("201 m", () => {
    const v = validateRoomLengthM(MAX_ROOM_DIM_M + 1);
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.code, "MAX");
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    const fp = geometryFingerprint(live().project);
    assert.equal(live().resizeWall("east", 250, false).ok, false);
    assert.equal(geometryFingerprint(live().project), fp);
  });
});

describe("DIM-VALIDATION-08 invalid preview never mutates canonical", () => {
  it("preview invalid clears preview, canonical intact", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    const fp = geometryFingerprint(live().project);
    const result0 = live().result.geometry.floorAreaM2;
    live().resizeWall("east", 0.2, true);
    assert.equal(live().preview, null);
    assert.equal(geometryFingerprint(live().project), fp);
    assert.equal(live().result.geometry.floorAreaM2, result0);
  });
});

describe("OBJECT-PLACE-01 valid CREATE succeeds", () => {
  it("interior origin commits", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    const res = live().addRack(rackAt(2, 2, "ok"));
    assert.equal(res.ok, true);
    assert.equal(live().project.racks.length, 1);
    assert.equal(live().project.racks[0]!.x, 2);
  });
});

describe("OBJECT-PLACE-02..05 room containment", () => {
  it("partial west/east/north/south and fully outside rejected", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    assert.equal(validateRackPlacement(p, rackAt(-0.1, 1)).code, "OUTSIDE");
    assert.equal(validateRackPlacement(p, rackAt(7.0, 1)).code, "OUTSIDE");
    assert.equal(validateRackPlacement(p, rackAt(1, 4.6)).code, "OUTSIDE");
    assert.equal(validateRackPlacement(p, rackAt(1, -0.05)).code, "OUTSIDE");
    assert.equal(validateRackPlacement(p, rackAt(40, 40)).code, "OUTSIDE");
    live().loadProject(p);
    assert.equal(live().addRack(rackAt(40, 40, "out")).ok, false);
    assert.equal(live().project.racks.length, 0);
    assert.equal(live().moveRack("missing", 40, 40, false).ok, false);
  });
});

describe("OBJECT-PLACE-06 rack-rack overlap CREATE and MOVE", () => {
  it("same rejection for both", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.racks = [rackAt(1, 1, "a")];
    const overlap = rackAt(1.2, 1.1, "b");
    assert.equal(validateRackPlacement(p, overlap).code, "RACK_OVERLAP");
    live().loadProject(p);
    assert.equal(live().addRack(overlap).ok, false);
    assert.equal(live().project.racks.length, 1);
    live().addRack(rackAt(4, 2, "c"));
    const moved = live().moveRack("c", 1.2, 1.1, false);
    assert.equal(moved.ok, false);
    assert.equal(live().project.racks.find((r) => r.id === "c")!.x, 4);
  });
});

describe("OBJECT-PLACE-07 door swing overlap CREATE and MOVE", () => {
  it("swing rejected both ways", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.openings = [southDoor()];
    const inSwing = rackAt(2.1, 0.05, "sw");
    assert.equal(validateRackPlacement(p, inSwing).code, "DOOR_SWING");
    live().loadProject(p);
    assert.equal(live().addRack(inSwing).ok, false);
    live().addRack(rackAt(4, 2, "ok2"));
    assert.equal(live().moveRack("ok2", 2.1, 0.05, false).ok, false);
  });
});

describe("OBJECT-PLACE-08 Snap does not change collision correctness", () => {
  it("overlap is geometric, independent of snap", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    p.racks = [rackAt(1, 1, "a")];
    const raw = validateRackPlacement(p, rackAt(1.05, 1.02, "b"));
    const snapped = validateRackPlacement(p, rackAt(1.05, 1.02, "b"));
    assert.equal(raw.code, snapped.code);
    assert.equal(raw.ok, false);
  });
});

describe("OBJECT-PLACE-09 CREATE stores the pointer origin as canonical coordinates", () => {
  it("2.250, 1.500 maps 1:1 into Project", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    const res = live().addRack(rackAt(2.25, 1.5, "m9"));
    assert.equal(res.ok, true);
    assert.equal(live().project.racks[0]!.x, 2.25);
    assert.equal(live().project.racks[0]!.y, 1.5);
  });
});

describe("OBJECT-PLACE-10 invalid placement does not mutate", () => {
  it("canonical fingerprint unchanged", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5 });
    live().loadProject(p);
    const fp = geometryFingerprint(live().project);
    live().addRack(rackAt(-2, -2, "bad"));
    assert.equal(geometryFingerprint(live().project), fp);
  });
});

describe("OBJECT-PLACE-11 Undo after valid CREATE", () => {
  it("restores exact previous fingerprint", () => {
    live().loadProject(emptyRectangularProject({ widthM: 8, depthM: 5 }));
    const pre = geometryFingerprint(live().project);
    assert.equal(live().addRack(rackAt(2, 2, "u1")).ok, true);
    assert.notEqual(geometryFingerprint(live().project), pre);
    live().undo();
    assert.equal(geometryFingerprint(live().project), pre);
  });
});
