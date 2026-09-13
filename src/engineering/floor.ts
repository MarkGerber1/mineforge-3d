import { STANDARD_GRAVITY_M_S2 } from "./constants.ts";
import { rackAsicCapacity } from "./racks.ts";
import { feasibleSpacePacking } from "./space-pack.ts";
import type { AsicSpec, CalcTrace, Project, Rack } from "./types.ts";

export type FloorModel = "NET_EQUIPMENT_PAYLOAD";

export interface FloorRackRow {
  id: string;
  footprintM2: number;
  allowableN: number;
  maxAsic: number;
  blocked: boolean;
}

export interface FloorAnalysis {
  known: boolean;
  limitPa: number | null;
  model: FloorModel;
  g: number;
  asicWeightKg: number | null;
  racksUsed: FloorRackRow[];
  totalPayloadN: number | null;
  maxByFloor: number | null;
  pass: boolean | null;
  reason: string;
  traces: CalcTrace[];
}

export function rackPlanFootprintM2(rack: Pick<Rack, "widthM" | "depthM">): number {
  const a = rack.widthM * rack.depthM;
  return Number.isFinite(a) && a > 0 ? a : 0;
}

export function maxAsicByFloorOnRack(rack: Rack, asic: AsicSpec, limitPa: number): number {
  const area = rackPlanFootprintM2(rack);
  if (!(limitPa > 0) || area <= 0 || !(asic.weightKg > 0)) return 0;
  const allowableN = limitPa * area;
  const loadN = asic.weightKg * STANDARD_GRAVITY_M_S2;
  if (!(loadN > 0)) return 0;
  const byFloor = Math.floor(allowableN / loadN + 1e-12);
  const byRack = Math.max(0, rackAsicCapacity(rack, asic));
  return Math.max(0, Math.min(byFloor, byRack));
}

function unknownFloor(reason: string, extra?: Partial<FloorAnalysis>): FloorAnalysis {
  return {
    known: false,
    limitPa: null,
    model: "NET_EQUIPMENT_PAYLOAD",
    g: STANDARD_GRAVITY_M_S2,
    asicWeightKg: extra?.asicWeightKg ?? null,
    racksUsed: extra?.racksUsed ?? [],
    totalPayloadN: null,
    maxByFloor: null,
    pass: null,
    reason,
    traces: extra?.traces ?? [],
  };
}

/**
 * Floor SAFE constraint. OPTION A: maxFloorLoadPa is net equipment payload
 * pressure after structure and rack dead load. Uses demonstrated rack
 * footprints (placed usable racks, or feasibleSpacePacking if none placed).
 */
export function calculateFloorLoading(
  project: Project,
  asic: AsicSpec | null,
  rackStatus: Array<{ id: string; blocked: boolean }>,
): FloorAnalysis {
  if (project.constraints.floorLoadingUnknown) {
    return unknownFloor("Floor loading UNKNOWN. SAFE confidence PRELIMINARY.");
  }
  const limit = project.constraints.maxFloorLoadPa;
  if (limit == null || !Number.isFinite(limit) || !(limit > 0)) {
    return unknownFloor("Floor marked known but no valid net payload limit.");
  }
  if (!asic) {
    return unknownFloor("ASIC unknown — floor payload cannot be screened.", { traces: [] });
  }

  const blocked = new Set(rackStatus.filter((r) => r.blocked).map((r) => r.id));
  let source: Rack[];
  let sourceLabel: string;
  if (project.racks.length) {
    source = project.racks;
    sourceLabel = "placed physically usable racks";
  } else {
    const pack = feasibleSpacePacking(project, asic);
    source = pack.racks;
    sourceLabel = "feasible-space candidate arrangement";
  }

  const rows: FloorRackRow[] = [];
  let total = 0;
  let payloadN = 0;
  for (const rack of source) {
    const area = rackPlanFootprintM2(rack);
    const allowableN = limit * area;
    const isBlocked = blocked.has(rack.id);
    const maxAsic = isBlocked ? 0 : maxAsicByFloorOnRack(rack, asic, limit);
    rows.push({ id: rack.id, footprintM2: area, allowableN, maxAsic, blocked: isBlocked });
    total += maxAsic;
    if (!isBlocked) payloadN += allowableN;
  }

  const requested = project.fleet.requestedCount;
  const pass = requested <= total;
  const traces: CalcTrace[] = [
    {
      id: "floor_limit",
      label: "Net floor payload limit",
      formula: "maxFloorLoadPa (net equipment payload after dead load)",
      inputs: { limit_Pa: limit, g: STANDARD_GRAVITY_M_S2, m_asic_kg: asic.weightKg },
      raw: limit,
      unit: "Pa",
      display: `${limit} Pa`,
    },
    {
      id: "floor_n",
      label: "Max ASIC by floor",
      formula: "Σ floor(limitPa × A_rack / (m_asic × g)) capped by rack capacity; blocked racks = 0",
      inputs: { racks: rows.length, source: sourceLabel, N: total },
      raw: total,
      unit: "ASIC",
      display: String(total),
    },
  ];

  return {
    known: true,
    limitPa: limit,
    model: "NET_EQUIPMENT_PAYLOAD",
    g: STANDARD_GRAVITY_M_S2,
    asicWeightKg: asic.weightKg,
    racksUsed: rows,
    totalPayloadN: payloadN,
    maxByFloor: total,
    pass,
    reason: pass
      ? `Floor screening ${total} ASIC on ${sourceLabel}.`
      : `Floor screening ${total} ASIC < requested ${requested}.`,
    traces,
  };
}
