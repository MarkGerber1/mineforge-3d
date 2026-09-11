import type {
  BottleneckKind,
  CalcTrace,
  CapacitySlot,
  Project,
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
  maxByUser: number | null;
  userKnown: boolean;
  geometryValid: boolean;
  asicKnown: boolean;
  exhaustKnown: boolean;
  fanKnown: boolean;
  floorUnknown: boolean;
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

  let confidence: SafeConfidence = "VERIFIED";
  if (!input.asicKnown || !input.geometryValid || !input.exhaustKnown) confidence = "INCOMPLETE";
  else if (input.floorUnknown || !input.fanKnown || !input.electricalKnown) confidence = "PRELIMINARY";

  let status: ProjectStatus = "PASS";
  if (confidence === "INCOMPLETE") status = "INCOMPLETE";
  else if (safe != null && input.requested > safe) status = "FAIL";
  else if (confidence === "PRELIMINARY") status = "WARNING";

  const why: CalcTrace[] = [];
  if (safe != null) {
    why.push({
      id: "safe",
      label: "SAFE COUNT",
      formula: "min(electrical, ventilation, space, rack, user) among known constraints",
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
    why,
  };
}

export function theoreticalSpaceCapacity(
  floorAreaM2: number,
  rackWidthM: number,
  rackDepthM: number,
  perRack: number,
  front: number,
  rear: number,
  aisle: number,
): number {
  if (perRack <= 0) return 0;
  const cellW = rackWidthM + 0.1;
  const cellD = rackDepthM + front + rear + aisle * 0.5;
  if (cellW <= 0 || cellD <= 0) return 0;
  const n = Math.floor(floorAreaM2 / (cellW * cellD));
  return n * perRack;
}
