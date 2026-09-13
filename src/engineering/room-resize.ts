import { MAX_ROOM_DIM_M, MIN_ROOM_DIM_M } from "./constants.ts";
import { originDeltaForWallResize } from "./geometry.ts";
import { parseLengthToMeters } from "./units.ts";
import type { WallId } from "./types.ts";

export type RoomLengthOk = { ok: true; meters: number };
export type RoomLengthErr = {
  ok: false;
  code: "BLANK" | "PARSE" | "ZERO" | "NEGATIVE" | "MIN" | "MAX";
  reason: string;
};
export type RoomLengthResult = RoomLengthOk | RoomLengthErr;

function fmtM(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

export function validateRoomLengthM(meters: number): RoomLengthResult {
  if (!Number.isFinite(meters)) {
    return { ok: false, code: "PARSE", reason: "Некорректный размер." };
  }
  if (meters < 0) {
    return { ok: false, code: "NEGATIVE", reason: "Размер не может быть отрицательным." };
  }
  if (meters === 0) {
    return { ok: false, code: "ZERO", reason: "Размер должен быть больше нуля." };
  }
  if (meters < MIN_ROOM_DIM_M) {
    return { ok: false, code: "MIN", reason: `Минимальный размер стены — ${fmtM(MIN_ROOM_DIM_M)} м.` };
  }
  if (meters > MAX_ROOM_DIM_M) {
    return { ok: false, code: "MAX", reason: `Максимальный размер стены — ${fmtM(MAX_ROOM_DIM_M)} м.` };
  }
  return { ok: true, meters };
}

export function validateRoomLengthInput(raw: string): RoomLengthResult {
  if (!raw.trim()) {
    return { ok: false, code: "BLANK", reason: "Введите размер стены." };
  }
  const m = parseLengthToMeters(raw);
  if (m == null) {
    return { ok: false, code: "PARSE", reason: "Некорректный размер." };
  }
  return validateRoomLengthM(m);
}

export interface WallResizeContract {
  wall: WallId;
  fixed: WallId;
  moving: WallId;
  labelRu: string;
  dim: "widthM" | "depthM";
}

const CONTRACTS: Record<WallId, WallResizeContract> = {
  east: {
    wall: "east",
    fixed: "west",
    moving: "east",
    labelRu: "Западная стена фиксирована · движется восточная",
    dim: "widthM",
  },
  west: {
    wall: "west",
    fixed: "east",
    moving: "west",
    labelRu: "Восточная стена фиксирована · движется западная",
    dim: "widthM",
  },
  north: {
    wall: "north",
    fixed: "south",
    moving: "north",
    labelRu: "Южная стена фиксирована · движется северная",
    dim: "depthM",
  },
  south: {
    wall: "south",
    fixed: "north",
    moving: "south",
    labelRu: "Северная стена фиксирована · движется южная",
    dim: "depthM",
  },
};

export function wallResizeContract(wall: WallId): WallResizeContract {
  return CONTRACTS[wall];
}

/** Immutable pointer-down snapshot. Every pointermove is computed only from this. */
export interface WallDragContext {
  wall: WallId;
  startWidthM: number;
  startDepthM: number;
  startPointerX: number;
  startPointerY: number;
  fixed: WallId;
}

export function createWallDragContext(
  wall: WallId,
  startWidthM: number,
  startDepthM: number,
  startPointerX: number,
  startPointerY: number,
): WallDragContext {
  return {
    wall,
    startWidthM,
    startDepthM,
    startPointerX,
    startPointerY,
    fixed: wallResizeContract(wall).fixed,
  };
}

/**
 * Event-count invariant length. Same start + same final pointer ⇒ same length,
 * regardless of how many intermediate pointermove events were delivered.
 */
export function wallDragLengthM(ctx: WallDragContext, pointerX: number, pointerY: number): number {
  switch (ctx.wall) {
    case "east":
      return ctx.startWidthM + (pointerX - ctx.startPointerX);
    case "west":
      return ctx.startWidthM - (pointerX - ctx.startPointerX);
    case "north":
      return ctx.startDepthM + (pointerY - ctx.startPointerY);
    case "south":
      return ctx.startDepthM - (pointerY - ctx.startPointerY);
  }
}

export function originShiftForResize(
  wall: WallId,
  startWidthM: number,
  startDepthM: number,
  newWidthM: number,
  newDepthM: number,
): { dx: number; dy: number } {
  if (wall === "west") return originDeltaForWallResize("west", startWidthM, newWidthM);
  if (wall === "south") return originDeltaForWallResize("south", startDepthM, newDepthM);
  return { dx: 0, dy: 0 };
}

export function wallCursor(wall: WallId): "ew-resize" | "ns-resize" {
  return wall === "east" || wall === "west" ? "ew-resize" : "ns-resize";
}

/**
 * Nearest wall within a world-space hit tolerance.
 * First-match (south→north→west→east) is forbidden: a pointer on the west
 * wall near the north end must still be West, not North.
 */
export function pickWallHit(
  wx: number,
  wy: number,
  widthM: number,
  depthM: number,
  tolM: number,
): WallId | null {
  if (!(tolM > 0) || !Number.isFinite(wx) || !Number.isFinite(wy)) return null;
  const candidates: Array<{ id: WallId; d: number; along: boolean }> = [
    { id: "west", d: Math.abs(wx), along: wy >= -tolM && wy <= depthM + tolM },
    { id: "east", d: Math.abs(wx - widthM), along: wy >= -tolM && wy <= depthM + tolM },
    { id: "south", d: Math.abs(wy), along: wx >= -tolM && wx <= widthM + tolM },
    { id: "north", d: Math.abs(wy - depthM), along: wx >= -tolM && wx <= widthM + tolM },
  ];
  let best: { id: WallId; d: number } | null = null;
  for (const c of candidates) {
    if (!c.along || c.d > tolM) continue;
    if (!best || c.d < best.d) best = { id: c.id, d: c.d };
  }
  return best?.id ?? null;
}

export function wallIdFromEventTarget(target: EventTarget | null): WallId | null {
  const el = target instanceof Element ? target.closest("[data-mf-wall]") : null;
  const id = el?.getAttribute("data-mf-wall");
  if (id === "east" || id === "west" || id === "south" || id === "north") return id;
  return null;
}

/**
 * Wall chosen for a pointer-down. Nearest geometric wall is authoritative.
 * Overlapping SVG hit-rects (DOM paint / z-order) must not override it.
 */
export function resolveWallDragTarget(
  worldX: number,
  worldY: number,
  widthM: number,
  depthM: number,
  tolM: number,
  eventTargetWall: WallId | null,
): WallId | null {
  return pickWallHit(worldX, worldY, widthM, depthM, tolM) ?? eventTargetWall;
}

