/**
 * True 3D axis-aligned boxes. Collision requires overlap on X and Y and Z.
 * Plan (XY) overlap with Z-separation is not a collision.
 */
import { openingWorldRect, rackAabb } from "./geometry.ts";
import type { AsBuiltObject, Opening, Project, Rack } from "./types.ts";

export interface Aabb3 {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  z1: number;
  z2: number;
}

const EPS = 1e-9;

export function aabb3(x1: number, x2: number, y1: number, y2: number, z1: number, z2: number): Aabb3 {
  return {
    x1: Math.min(x1, x2),
    x2: Math.max(x1, x2),
    y1: Math.min(y1, y2),
    y2: Math.max(y1, y2),
    z1: Math.min(z1, z2),
    z2: Math.max(z1, z2),
  };
}

export function aabb3OverlapX(a: Aabb3, b: Aabb3): number {
  return Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
}
export function aabb3OverlapY(a: Aabb3, b: Aabb3): number {
  return Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
}
export function aabb3OverlapZ(a: Aabb3, b: Aabb3): number {
  return Math.min(a.z2, b.z2) - Math.max(a.z1, b.z1);
}

/** Smallest overlapping axis length; 0 if any axis is separated. */
export function aabb3Overlap(a: Aabb3, b: Aabb3): number {
  const ox = aabb3OverlapX(a, b);
  const oy = aabb3OverlapY(a, b);
  const oz = aabb3OverlapZ(a, b);
  if (ox <= EPS || oy <= EPS || oz <= EPS) return 0;
  return Math.min(ox, oy, oz);
}

export function aabb3Intersects(a: Aabb3, b: Aabb3): boolean {
  return aabb3Overlap(a, b) > 0;
}

export function aabb3VolumeOverlap(a: Aabb3, b: Aabb3): number {
  const ox = aabb3OverlapX(a, b);
  const oy = aabb3OverlapY(a, b);
  const oz = aabb3OverlapZ(a, b);
  if (ox <= EPS || oy <= EPS || oz <= EPS) return 0;
  return ox * oy * oz;
}

export function aabb3Inside(inner: Aabb3, outer: Aabb3, eps = EPS): boolean {
  return (
    inner.x1 >= outer.x1 - eps &&
    inner.y1 >= outer.y1 - eps &&
    inner.z1 >= outer.z1 - eps &&
    inner.x2 <= outer.x2 + eps &&
    inner.y2 <= outer.y2 + eps &&
    inner.z2 <= outer.z2 + eps
  );
}

/** Floor-mounted rack: z = 0 … heightM. */
export function rackAabb3(r: Rack): Aabb3 {
  const p = rackAabb(r);
  return aabb3(p.x1, p.x2, p.y1, p.y2, 0, r.heightM);
}

export function asBuiltAabb3(obj: AsBuiltObject): Aabb3 {
  return aabb3(obj.x, obj.x + obj.widthM, obj.y, obj.y + obj.depthM, obj.z, obj.z + obj.heightM);
}

export function roomEnvelope3(project: Project): Aabb3 {
  const { widthM, depthM, heightM } = project.room;
  return aabb3(0, widthM, 0, depthM, 0, heightM);
}

/** Physical ceiling plane as a thin slab at z = room.heightM. */
export function ceilingAabb3(project: Project, thicknessM = 0.02): Aabb3 {
  const h = project.room.heightM;
  const { widthM, depthM } = project.room;
  return aabb3(0, widthM, 0, depthM, h, h + thicknessM);
}

export function exceedsCeiling(box: Aabb3, ceilingM: number, eps = EPS): boolean {
  return box.z2 > ceilingM + eps;
}

export function openingAabb3(project: Project, o: Opening, wallThicknessM = 0.08): Aabb3 {
  const r = openingWorldRect(project, o);
  const alongX = Math.abs(r.x2 - r.x1);
  const alongY = Math.abs(r.y2 - r.y1);
  const t = wallThicknessM;
  if (alongX >= alongY) {
    const yMid = (r.y1 + r.y2) / 2;
    return aabb3(Math.min(r.x1, r.x2), Math.max(r.x1, r.x2), yMid - t / 2, yMid + t / 2, r.z1, r.z2);
  }
  const xMid = (r.x1 + r.x2) / 2;
  return aabb3(xMid - t / 2, xMid + t / 2, Math.min(r.y1, r.y2), Math.max(r.y1, r.y2), r.z1, r.z2);
}
