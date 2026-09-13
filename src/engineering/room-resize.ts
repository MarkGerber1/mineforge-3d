import { MAX_ROOM_DIM_M, MIN_ROOM_DIM_M } from "./constants.ts";
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
