import type {
  BottleneckKind,
  CalcTrace,
  CapacitySlot,
  HudSafetyKind,
  ProjectStatus,
  SafeConfidence,
} from "./types.ts";

export interface CapacityInputs {
  requested: number;
  maxByElectrical: number | null;
  electricalKnown: boolean;
  electricalDetail: string;
  electricalTrace: CalcTrace[];
  maxByVentilation: number | null;
  ventilationKnown: boolean;
  ventilationDetail: string;
  ventilationTrace: CalcTrace[];
  maxBySpace: number | null;
  spaceKnown: boolean;
  spaceDetail: string;
  spaceTrace: CalcTrace[];
  maxByRack: number | null;
  rackKnown: boolean;
  rackDetail: string;
  rackTrace: CalcTrace[];
  maxByFloor: number | null;
  floorKnown: boolean;
  floorDetail: string;
  floorTrace: CalcTrace[];
  maxByUser: number | null;
  userKnown: boolean;
  geometryValid: boolean;
  asicKnown: boolean;
  exhaustKnown: boolean;
  intakeKnown: boolean;
  openingsValid: boolean;
  fanKnown: boolean;
  floorUnknown: boolean;
  hasBlocker: boolean;
  hasCriticalConflict: boolean;
}

export function calculateCapacity(input: CapacityInputs) {
  const slots: CapacitySlot[] = [
    {
      kind: "ELECTRICAL",
      label: "Electrical",
      value: input.maxByElectrical,
      known: input.electricalKnown,
      detail: input.electricalDetail,
      trace: input.electricalTrace,
    },
    {
      kind: "VENTILATION",
      label: "Ventilation",
      value: input.maxByVentilation,
      known: input.ventilationKnown,
      detail: input.ventilationDetail,
      trace: input.ventilationTrace,
    },
    {
      kind: "SPACE",
      label: "Physical space",
      value: input.maxBySpace,
      known: input.spaceKnown,
      detail: input.spaceDetail,
      trace: input.spaceTrace,
    },
    {
      kind: "RACK",
      label: "Rack capacity",
      value: input.maxByRack,
      known: input.rackKnown,
      detail: input.rackDetail,
      trace: input.rackTrace,
    },
    {
      kind: "FLOOR",
      label: "Floor loading",
      value: input.maxByFloor,
      known: input.floorKnown,
      detail: input.floorDetail,
      trace: input.floorTrace,
    },
  ];
  if (input.userKnown && input.maxByUser != null) {
    slots.push({
      kind: "USER",
      label: "User constraint",
      value: input.maxByUser,
      known: true,
      detail: "Explicit user cap.",
      trace: [],
    });
  }

  const knownValues = slots.filter((s) => s.known && s.value != null).map((s) => s.value as number);
  const safe = knownValues.length ? Math.min(...knownValues) : null;
  const bottlenecks: BottleneckKind[] =
    safe == null ? ["UNKNOWN"] : slots.filter((s) => s.known && s.value === safe).map((s) => s.kind);

  const requiredMissing =
    !input.asicKnown || !input.geometryValid || !input.exhaustKnown || !input.intakeKnown || !input.openingsValid;

  let confidence: SafeConfidence = "VERIFIED";
  if (requiredMissing || input.hasBlocker) confidence = "INCOMPLETE";
  else if (input.hasCriticalConflict) confidence = "CRITICAL";
  else if (input.floorUnknown || !input.fanKnown || !input.electricalKnown) confidence = "PRELIMINARY";

  let status: ProjectStatus = "PASS";
  if (confidence === "INCOMPLETE") status = "INCOMPLETE";
  else if (confidence === "CRITICAL") status = "FAIL";
  else if (safe != null && input.requested > safe) status = "FAIL";
  else if (confidence === "PRELIMINARY") status = "WARNING";

  const safety = hudSafetyKind({
    confidence,
    requested: input.requested,
    safe,
    hasBlocker: input.hasBlocker,
    hasCriticalConflict: input.hasCriticalConflict,
  });
  const verified = safety === "VERIFIED";

  const why: CalcTrace[] = [];
  if (safe != null) {
    why.push({
      id: "safe",
      label: "SAFE COUNT",
      formula: "min(electrical, ventilation, space, rack, floor, user) among known constraints",
      inputs: Object.fromEntries(slots.map((s) => [s.kind, s.value ?? "UNKNOWN"])),
      raw: safe,
      unit: "ASIC",
      display: String(safe),
    });
    for (const b of bottlenecks) {
      const slot = slots.find((s) => s.kind === b);
      if (slot) why.push(...slot.trace);
    }
  }

  return {
    requested: input.requested,
    slots,
    safe,
    bottlenecks,
    confidence,
    status,
    safety,
    verified,
    why,
  };
}

export function hudSafetyKind(input: {
  confidence: SafeConfidence;
  requested: number;
  safe: number | null;
  hasBlocker: boolean;
  hasCriticalConflict: boolean;
}): HudSafetyKind {
  if (input.hasBlocker || input.confidence === "INCOMPLETE") return "INCOMPLETE";
  if (input.hasCriticalConflict || input.confidence === "CRITICAL") return "CRITICAL";
  if (input.confidence === "PRELIMINARY") return "PRELIMINARY";
  if (input.safe != null && input.requested > input.safe) return "OVER_CAPACITY";
  return "VERIFIED";
}

export const HUD_SAFETY_LABEL_RU: Record<HudSafetyKind, string> = {
  VERIFIED: "ПРОВЕРЕНО",
  PRELIMINARY: "ПРЕДВАРИТЕЛЬНО",
  INCOMPLETE: "НЕПОЛНО",
  CRITICAL: "КРИТИЧНО",
  OVER_CAPACITY: "ПРЕВЫШЕНИЕ",
};

/**
 * Feasible rectangular packing upper bound used as a numeric diagnostic.
 * A rack is counted only when body + mandatory front/rear service envelopes
 * fit in the room in that orientation. Never exceeds the body grid.
 * Pipeline VERIFIED SAFE uses feasibleSpacePacking() (same rules as analyzeRacks).
 */
export function theoreticalSpaceCapacity(
  roomWidthM: number,
  roomDepthM: number,
  rackWidthM: number,
  rackDepthM: number,
  perRack: number,
  front: number,
  rear: number,
  aisle: number,
): number {
  if (perRack <= 0) return 0;
  const n0 = Math.max(
    sameDirCount(roomWidthM, roomDepthM, rackWidthM, rackDepthM, front, rear),
    facingPairCount(roomWidthM, roomDepthM, rackWidthM, rackDepthM, front, rear, aisle),
    sameDirCount(roomDepthM, roomWidthM, rackDepthM, rackWidthM, front, rear),
    facingPairCount(roomDepthM, roomWidthM, rackDepthM, rackWidthM, front, rear, aisle),
  );
  const n90 = Math.max(
    sameDirCount(roomWidthM, roomDepthM, rackDepthM, rackWidthM, front, rear),
    facingPairCount(roomWidthM, roomDepthM, rackDepthM, rackWidthM, front, rear, aisle),
    sameDirCount(roomDepthM, roomWidthM, rackWidthM, rackDepthM, front, rear),
    facingPairCount(roomDepthM, roomWidthM, rackWidthM, rackDepthM, front, rear, aisle),
  );
  const packed = Math.max(n0, n90);
  const body0 = bodyGrid(roomWidthM, roomDepthM, rackWidthM, rackDepthM);
  const body90 = bodyGrid(roomWidthM, roomDepthM, rackDepthM, rackWidthM);
  const hardCap = Math.max(body0, body90);
  return Math.min(packed, hardCap) * perRack;
}

function bodyGrid(roomW: number, roomD: number, rackW: number, rackD: number): number {
  if (rackW <= 0 || rackD <= 0) return 0;
  if (roomW + 1e-12 < rackW || roomD + 1e-12 < rackD) return 0;
  return Math.floor((roomW + 1e-12) / rackW) * Math.floor((roomD + 1e-12) / rackD);
}

function countAlong(room: number, item: number, extraPitch: number): number {
  if (item <= 0) return 0;
  if (room + 1e-12 < item) return 0;
  const step = Math.max(item, item + extraPitch);
  return 1 + Math.floor((room - item + 1e-12) / step);
}

function rowsWithService(room: number, body: number, front: number, rear: number): number {
  if (body <= 0) return 0;
  const first = Math.max(0, front) + body + Math.max(0, rear);
  if (room + 1e-12 < first) return 0;
  const step = body + Math.max(Math.max(0, front), Math.max(0, rear));
  return 1 + Math.floor((room - first + 1e-12) / step);
}

function sameDirCount(
  roomW: number,
  roomD: number,
  rackW: number,
  rackD: number,
  front: number,
  rear: number,
): number {
  const nx = countAlong(roomW, rackW, 0.1);
  const ny = rowsWithService(roomD, rackD, front, rear);
  return nx * ny;
}

function facingPairCount(
  roomW: number,
  roomD: number,
  rackW: number,
  rackD: number,
  front: number,
  rear: number,
  aisle: number,
): number {
  const nx = countAlong(roomW, rackW, 0.1);
  if (nx <= 0) return 0;
  const gap = Math.max(Math.max(0, aisle), Math.max(0, front));
  const pair = Math.max(0, rear) + rackD + gap + rackD + Math.max(0, rear);
  if (roomD + 1e-12 < pair) return 0;
  const between = rackD + gap + rackD + Math.max(0, rear) + Math.max(0, rear);
  const pairs = 1 + Math.floor((roomD - pair + 1e-12) / Math.max(between, pair));
  return nx * 2 * Math.max(0, pairs);
}
