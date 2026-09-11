import { MAX_ROOM_DIM_M, MIN_ROOM_DIM_M } from "./constants.ts";
import type { Opening, Project, Rack, WallId } from "./types.ts";

export function wallLength(project: Project, wallId: WallId): number {
  if (wallId === "north" || wallId === "south") return project.room.widthM;
  return project.room.depthM;
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
  for (const other of others) {
    if (openingsOverlap(o, other)) errors.push(`Opening overlaps ${other.name ?? other.id}.`);
  }
  const insideWall = openingInsideWall(project, o) && errors.length === 0;
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

export function resizeRectangularRoom(
  project: Project,
  wall: WallId,
  newLengthM: number,
): Project {
  const room = { ...project.room };
  const racks = project.racks.map((r) => ({ ...r }));
  const openings = project.openings.map((o) => ({ ...o }));
  const fans = project.fans.map((f) => ({ ...f }));

  if (wall === "east") {
    room.widthM = newLengthM;
  } else if (wall === "west") {
    const delta = newLengthM - room.widthM;
    room.widthM = newLengthM;
    for (const r of racks) r.x += delta;
    for (const f of fans) f.x += delta;
    for (const o of openings) {
      if (o.wallId === "north" || o.wallId === "south") o.offsetFromWallStartM += delta;
    }
  } else if (wall === "north") {
    room.depthM = newLengthM;
  } else {
    const delta = newLengthM - room.depthM;
    room.depthM = newLengthM;
    for (const r of racks) r.y += delta;
    for (const f of fans) f.y += delta;
    for (const o of openings) {
      if (o.wallId === "east" || o.wallId === "west") o.offsetFromWallStartM += delta;
    }
  }
  return { ...project, room, racks, openings, fans, updatedAt: Date.now() };
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
