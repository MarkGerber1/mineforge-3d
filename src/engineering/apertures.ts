import { wallLength } from "./geometry.ts";
import type { Opening, Project, WallId } from "./types.ts";

export interface WallPanel {
  wallId: WallId;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export interface WorldBox {
  position: [number, number, number];
  size: [number, number, number];
}

const WALLS: WallId[] = ["south", "north", "west", "east"];

export function openingLocalRect(o: Opening): { u0: number; u1: number; v0: number; v1: number } {
  return {
    u0: o.offsetFromWallStartM,
    u1: o.offsetFromWallStartM + o.widthM,
    v0: o.bottomElevationM,
    v1: o.bottomElevationM + o.heightM,
  };
}

function uniqSorted(xs: number[], eps = 1e-9): number[] {
  const s = [...xs].sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of s) {
    if (!out.length || Math.abs(out[out.length - 1]! - x) > eps) out.push(x);
  }
  return out;
}

function cellInHole(
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  holes: Array<{ u0: number; u1: number; v0: number; v1: number }>,
): boolean {
  const uc = (u0 + u1) / 2;
  const vc = (v0 + v1) / 2;
  return holes.some((h) => uc > h.u0 + 1e-9 && uc < h.u1 - 1e-9 && vc > h.v0 + 1e-9 && vc < h.v1 - 1e-9);
}

export function segmentWallPanels(project: Project, wallId: WallId): WallPanel[] {
  const L = wallLength(project, wallId);
  const H = project.room.heightM;
  const holes = project.openings.filter((o) => o.wallId === wallId).map(openingLocalRect);
  const us = uniqSorted([
    0,
    L,
    ...holes.flatMap((h) => [Math.max(0, Math.min(L, h.u0)), Math.max(0, Math.min(L, h.u1))]),
  ]);
  const vs = uniqSorted([
    0,
    H,
    ...holes.flatMap((h) => [Math.max(0, Math.min(H, h.v0)), Math.max(0, Math.min(H, h.v1))]),
  ]);
  const panels: WallPanel[] = [];
  for (let i = 0; i < us.length - 1; i++) {
    for (let j = 0; j < vs.length - 1; j++) {
      const u0 = us[i]!;
      const u1 = us[i + 1]!;
      const v0 = vs[j]!;
      const v1 = vs[j + 1]!;
      if (u1 - u0 < 1e-9 || v1 - v0 < 1e-9) continue;
      if (cellInHole(u0, u1, v0, v1, holes)) continue;
      panels.push({ wallId, u0, u1, v0, v1 });
    }
  }
  return panels;
}

export function segmentAllWalls(project: Project): WallPanel[] {
  return WALLS.flatMap((w) => segmentWallPanels(project, w));
}

export function panelOverlapsOpening(panel: WallPanel, o: Opening, eps = 1e-9): boolean {
  if (panel.wallId !== o.wallId) return false;
  const h = openingLocalRect(o);
  const ou = Math.min(panel.u1, h.u1) - Math.max(panel.u0, h.u0);
  const ov = Math.min(panel.v1, h.v1) - Math.max(panel.v0, h.v0);
  return ou > eps && ov > eps;
}

export function anyPanelOverlapsOpening(panels: WallPanel[], o: Opening): boolean {
  return panels.some((p) => panelOverlapsOpening(p, o));
}

/** Three.js box for a wall panel. CAD y → Twin z. Elevation → Twin y. */
export function panelWorldBox(project: Project, panel: WallPanel, thicknessM = 0.08): WorldBox {
  const uC = (panel.u0 + panel.u1) / 2;
  const vC = (panel.v0 + panel.v1) / 2;
  const uS = panel.u1 - panel.u0;
  const vS = panel.v1 - panel.v0;
  const t = thicknessM;
  const w = project.room.widthM;
  const d = project.room.depthM;
  switch (panel.wallId) {
    case "south":
      return { position: [uC, vC, 0], size: [uS, vS, t] };
    case "north":
      return { position: [uC, vC, d], size: [uS, vS, t] };
    case "west":
      return { position: [0, vC, uC], size: [t, vS, uS] };
    case "east":
      return { position: [w, vC, uC], size: [t, vS, uS] };
  }
}

/** True if (u,v) on a wall lies inside a canonical opening (the aperture). */
export function wallPointIsAperture(project: Project, wallId: WallId, u: number, v: number): boolean {
  return project.openings
    .filter((o) => o.wallId === wallId)
    .some((o) => {
      const h = openingLocalRect(o);
      return u > h.u0 + 1e-9 && u < h.u1 - 1e-9 && v > h.v0 + 1e-9 && v < h.v1 - 1e-9;
    });
}
