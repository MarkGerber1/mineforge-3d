import { MAX_ROOM_DIM_M, MIN_ROOM_DIM_M } from "./constants.ts";
import type { AsBuiltObject, FanInstance, Opening, Project, Rack, RealityFinding, RealityState, WallId } from "./types.ts";

export function wallLength(project: Project, wallId: WallId): number {
  if (wallId === "north" || wallId === "south") return project.room.widthM;
  return project.room.depthM;
}

export function oppositeWall(wall: WallId): WallId {
  if (wall === "east") return "west";
  if (wall === "west") return "east";
  if (wall === "north") return "south";
  return "north";
}

export function roomMetrics(widthM: number, depthM: number, heightM: number) {
  const floorAreaM2 = widthM * depthM;
  const volumeM3 = floorAreaM2 * heightM;
  const perimeterM = 2 * (widthM + depthM);
  return { floorAreaM2, volumeM3, perimeterM };
}

export function analyzeGeometry(project: Project) {
  const { widthM, depthM, heightM } = project.room;
  const valid =
    widthM >= MIN_ROOM_DIM_M &&
    depthM >= MIN_ROOM_DIM_M &&
    heightM >= MIN_ROOM_DIM_M &&
    widthM <= MAX_ROOM_DIM_M &&
    depthM <= MAX_ROOM_DIM_M &&
    heightM <= 50;
  return { ...roomMetrics(widthM, depthM, heightM), valid };
}

export function openingAreaM2(o: Opening): number {
  return o.widthM * o.heightM;
}

export function openingTopElevation(o: Opening): number {
  return o.bottomElevationM + o.heightM;
}

export function openingMaxWidthOnWallM(project: Project, o: Opening): number {
  return Math.max(0, wallLength(project, o.wallId) - o.offsetFromWallStartM);
}

export function openingInsideWall(project: Project, o: Opening): boolean {
  const L = wallLength(project, o.wallId);
  const H = project.room.heightM;
  const eps = 1e-9;
  return (
    o.widthM > eps &&
    o.heightM > eps &&
    o.offsetFromWallStartM >= -eps &&
    o.offsetFromWallStartM + o.widthM <= L + eps &&
    o.bottomElevationM >= -eps &&
    o.bottomElevationM + o.heightM <= H + eps
  );
}

export function openingsOverlap(a: Opening, b: Opening): boolean {
  if (a.wallId !== b.wallId) return false;
  const a1 = a.offsetFromWallStartM;
  const a2 = a.offsetFromWallStartM + a.widthM;
  const b1 = b.offsetFromWallStartM;
  const b2 = b.offsetFromWallStartM + b.widthM;
  const xOverlap = Math.min(a2, b2) - Math.max(a1, b1);
  if (xOverlap <= 1e-9) return false;
  const ay1 = a.bottomElevationM;
  const ay2 = a.bottomElevationM + a.heightM;
  const by1 = b.bottomElevationM;
  const by2 = b.bottomElevationM + b.heightM;
  const yOverlap = Math.min(ay2, by2) - Math.max(ay1, by1);
  return yOverlap > 1e-9;
}

export interface OpeningValidation {
  ok: boolean;
  errors: string[];
  areaM2: number;
  topElevationM: number;
  insideWall: boolean;
}

export function validateOpening(
  project: Project,
  o: Opening,
  others: Opening[] = project.openings.filter((x) => x.id !== o.id),
): OpeningValidation {
  const errors: string[] = [];
  const L = wallLength(project, o.wallId);
  const H = project.room.heightM;
  if (o.widthM <= 0 || o.heightM <= 0) errors.push("Opening size must be positive.");
  if (o.widthM > L + 1e-9) errors.push("Opening is wider than the wall.");
  if (o.offsetFromWallStartM < -1e-9) errors.push("Opening starts before the wall.");
  if (o.offsetFromWallStartM + o.widthM > L + 1e-9) errors.push("Opening extends past the wall end.");
  if (o.bottomElevationM < -1e-9) errors.push("Opening is below the floor.");
  if (o.bottomElevationM + o.heightM > H + 1e-9) errors.push("Opening extends above the ceiling.");
  if (!openingFullyOnAssignedWall(project, o)) {
    errors.push("Проём не лежит на назначенной стене.");
  }
  for (const other of others) {
    if (openingsOverlap(o, other)) errors.push(`Opening overlaps ${other.name ?? other.id}.`);
  }
  const insideWall = openingInsideWall(project, o) && openingFullyOnAssignedWall(project, o) && errors.length === 0;
  return {
    ok: errors.length === 0,
    errors,
    areaM2: openingAreaM2(o),
    topElevationM: openingTopElevation(o),
    insideWall,
  };
}

export function analyzeOpenings(project: Project) {
  const items = project.openings.map((o) => {
    const v = validateOpening(project, o);
    return { id: o.id, areaM2: v.areaM2, topElevationM: v.topElevationM, insideWall: v.insideWall, errors: v.errors };
  });
  return { valid: items.every((i) => i.errors.length === 0), items };
}

export function canPlaceOpening(project: Project, o: Opening): boolean {
  return validateOpening(project, o).ok;
}

export interface Aabb {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function rackAabb(r: Rack): Aabb {
  const rot = ((r.rotationDeg % 360) + 360) % 360;
  if (rot === 90 || rot === 270) {
    return { x1: r.x, y1: r.y, x2: r.x + r.depthM, y2: r.y + r.widthM };
  }
  return { x1: r.x, y1: r.y, x2: r.x + r.widthM, y2: r.y + r.depthM };
}

/** Plan footprint. Origin is the min-corner, matching setFan placement. */
export const FAN_FOOTPRINT_M = 0.8;

export function fanAabb(f: FanInstance): Aabb {
  return { x1: f.x, y1: f.y, x2: f.x + FAN_FOOTPRINT_M, y2: f.y + FAN_FOOTPRINT_M };
}

export function fanInsideRoom(project: Project, f: FanInstance, eps = 1e-9): boolean {
  return aabbInside(fanAabb(f), roomAabb(project), eps);
}

export function fanIsSpatiallyValid(project: Project, f: FanInstance): boolean {
  return fanInsideRoom(project, f);
}

export function aabbOverlap(a: Aabb, b: Aabb): number {
  const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (ox <= 1e-9 || oy <= 1e-9) return 0;
  return Math.min(ox, oy);
}

export function aabbIntersects(a: Aabb, b: Aabb): boolean {
  return aabbOverlap(a, b) > 0;
}

export function roomAabb(project: Project): Aabb {
  return { x1: 0, y1: 0, x2: project.room.widthM, y2: project.room.depthM };
}

export function aabbInside(inner: Aabb, outer: Aabb, eps = 1e-9): boolean {
  return inner.x1 >= outer.x1 - eps && inner.y1 >= outer.y1 - eps && inner.x2 <= outer.x2 + eps && inner.y2 <= outer.y2 + eps;
}

/** Thickened wall slab in plan. Thickness extends both inward and outward. */
export function wallPlanAabb(project: Project, wall: WallId, thicknessM = project.room.wallThicknessM): Aabb {
  const t = Math.max(thicknessM, 1e-6);
  const { widthM: w, depthM: d } = project.room;
  switch (wall) {
    case "south":
      return { x1: -t, y1: -t, x2: w + t, y2: t };
    case "north":
      return { x1: -t, y1: d - t, x2: w + t, y2: d + t };
    case "west":
      return { x1: -t, y1: -t, x2: t, y2: d + t };
    case "east":
      return { x1: w - t, y1: -t, x2: w + t, y2: d + t };
  }
}

export function openingPlanAabb(project: Project, o: Opening, thicknessM = project.room.wallThicknessM): Aabb {
  const r = openingWorldRect(project, o);
  const t = Math.max(thicknessM, 1e-6);
  const alongX = Math.abs(r.x2 - r.x1);
  const alongY = Math.abs(r.y2 - r.y1);
  if (alongX >= alongY) {
    const yMid = (r.y1 + r.y2) / 2;
    return { x1: Math.min(r.x1, r.x2), y1: yMid - t / 2, x2: Math.max(r.x1, r.x2), y2: yMid + t / 2 };
  }
  const xMid = (r.x1 + r.x2) / 2;
  return { x1: xMid - t / 2, y1: Math.min(r.y1, r.y2), x2: xMid + t / 2, y2: Math.max(r.y1, r.y2) };
}

/**
 * Opening world geometry (from o.wallId) must lie on the claimed wall slab
 * and must not lie on the opposite wall. A north opening claimed as south fails.
 */
export function openingFullyOnAssignedWall(project: Project, o: Opening, claimedWall: WallId = o.wallId): boolean {
  if (o.wallId !== claimedWall) return false;
  const hole = openingPlanAabb(project, o);
  const assigned = wallPlanAabb(project, claimedWall);
  if (!aabbInside(hole, assigned, 1e-6)) return false;
  const opposite = oppositeWall(claimedWall);
  const opp = wallPlanAabb(project, opposite);
  if (aabbInside(hole, opp, 1e-6)) return false;
  return true;
}

export function doorSwingAabb(project: Project, door: Opening): Aabb | null {
  if (door.type !== "DOOR") return null;
  const swing = door.widthM;
  const off = door.offsetFromWallStartM;
  switch (door.wallId) {
    case "south":
      return { x1: off, y1: 0, x2: off + door.widthM, y2: swing };
    case "north":
      return { x1: off, y1: project.room.depthM - swing, x2: off + door.widthM, y2: project.room.depthM };
    case "west":
      return { x1: 0, y1: off, x2: swing, y2: off + door.widthM };
    case "east":
      return { x1: project.room.widthM - swing, y1: off, x2: project.room.widthM, y2: off + door.widthM };
  }
}

function translateOpening(o: Opening, dx: number, dy: number): Opening {
  if ((o.wallId === "north" || o.wallId === "south") && Math.abs(dx) > 1e-15) {
    return { ...o, offsetFromWallStartM: o.offsetFromWallStartM + dx };
  }
  if ((o.wallId === "east" || o.wallId === "west") && Math.abs(dy) > 1e-15) {
    return { ...o, offsetFromWallStartM: o.offsetFromWallStartM + dy };
  }
  return { ...o };
}

function translateAsBuilt(obj: AsBuiltObject, dx: number, dy: number): AsBuiltObject {
  return { ...obj, x: obj.x + dx, y: obj.y + dy };
}

function translateFinding(f: RealityFinding, dx: number, dy: number): RealityFinding {
  const estimated = f.estimated ? { ...f.estimated, x: f.estimated.x + dx, y: f.estimated.y + dy } : f.estimated;
  const opening = f.opening ? translateOpening(f.opening, dx, dy) : f.opening;
  return { ...f, estimated, opening };
}

export function translateRoomContents(project: Project, dx: number, dy: number): {
  racks: Rack[];
  openings: Opening[];
  fans: FanInstance[];
  reality: RealityState | undefined;
} {
  const racks = project.racks.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
  const openings = project.openings.map((o) => translateOpening(o, dx, dy));
  const fans = project.fans.map((f) => ({ ...f, x: f.x + dx, y: f.y + dy }));
  const prev = project.reality;
  const reality = prev
    ? {
        ...prev,
        asBuilt: prev.asBuilt.map((o) => translateAsBuilt(o, dx, dy)),
        findings: prev.findings.map((f) => translateFinding(f, dx, dy)),
      }
    : prev;
  return { racks, openings, fans, reality };
}

export function originDeltaForWallResize(wall: WallId, prevLengthM: number, newLengthM: number): { dx: number; dy: number } {
  const delta = newLengthM - prevLengthM;
  if (wall === "west") return { dx: delta, dy: 0 };
  if (wall === "south") return { dx: 0, dy: delta };
  return { dx: 0, dy: 0 };
}

export function resizeRectangularRoom(
  project: Project,
  wall: WallId,
  newLengthM: number,
): Project {
  const room = { ...project.room };
  let dx = 0;
  let dy = 0;
  if (wall === "east") {
    dx = 0;
    dy = 0;
    room.widthM = newLengthM;
  } else if (wall === "west") {
    dx = newLengthM - room.widthM;
    dy = 0;
    room.widthM = newLengthM;
  } else if (wall === "north") {
    dx = 0;
    dy = 0;
    room.depthM = newLengthM;
  } else {
    dx = 0;
    dy = newLengthM - room.depthM;
    room.depthM = newLengthM;
  }
  const shifted = translateRoomContents(project, dx, dy);
  return {
    ...project,
    room,
    racks: shifted.racks,
    openings: shifted.openings,
    fans: shifted.fans,
    reality: shifted.reality,
    updatedAt: Date.now(),
  };
}

export function wallWorldSegment(project: Project, wall: WallId): { x1: number; y1: number; x2: number; y2: number } {
  const { widthM: w, depthM: d } = project.room;
  switch (wall) {
    case "south":
      return { x1: 0, y1: 0, x2: w, y2: 0 };
    case "north":
      return { x1: 0, y1: d, x2: w, y2: d };
    case "west":
      return { x1: 0, y1: 0, x2: 0, y2: d };
    case "east":
      return { x1: w, y1: 0, x2: w, y2: d };
  }
}

export function openingWorldRect(project: Project, o: Opening) {
  const wall = wallWorldSegment(project, o.wallId);
  const t = o.offsetFromWallStartM;
  const alongX = wall.x2 - wall.x1;
  const alongY = wall.y2 - wall.y1;
  const len = Math.hypot(alongX, alongY) || 1;
  const ux = alongX / len;
  const uy = alongY / len;
  const x1 = wall.x1 + ux * t;
  const y1 = wall.y1 + uy * t;
  const x2 = wall.x1 + ux * (t + o.widthM);
  const y2 = wall.y1 + uy * (t + o.widthM);
  return { x1, y1, x2, y2, z1: o.bottomElevationM, z2: o.bottomElevationM + o.heightM };
}
