import { MAX_AVAILABLE_POWER_W, MIN_AVAILABLE_POWER_W, PHASE_COUNT, SUPPLY_VOLTAGE_V } from "./constants.ts";
import { supplyVoltageCompatible } from "./asic-spec.ts";
import type { AsicSpec, CalcTrace, ElectricalSupply, Project } from "./types.ts";
import { formatAmps, formatKw, parsePowerInputToWatts } from "./units.ts";

export type PowerOk = { ok: true; watts: number };
export type PowerErr = {
  ok: false;
  code: "BLANK" | "PARSE" | "NAN" | "INFINITY" | "NEGATIVE" | "ZERO" | "MIN" | "MAX";
  reason: string;
};
export type PowerResult = PowerOk | PowerErr;

function fmtKw(w: number): string {
  return (w / 1000).toFixed(w % 1000 === 0 ? 0 : 3).replace(".", ",");
}

export function validateAvailablePowerW(watts: number): PowerResult {
  if (Number.isNaN(watts)) {
    return { ok: false, code: "NAN", reason: "Некорректная мощность." };
  }
  if (!Number.isFinite(watts)) {
    return { ok: false, code: "INFINITY", reason: "Мощность должна быть конечным числом." };
  }
  if (watts < 0) {
    return { ok: false, code: "NEGATIVE", reason: "Мощность не может быть отрицательной." };
  }
  if (watts === 0) {
    return { ok: false, code: "ZERO", reason: "Укажите выделенную мощность больше нуля." };
  }
  if (watts < MIN_AVAILABLE_POWER_W) {
    return { ok: false, code: "MIN", reason: `Минимальная мощность — ${fmtKw(MIN_AVAILABLE_POWER_W)} kW.` };
  }
  if (watts > MAX_AVAILABLE_POWER_W) {
    return { ok: false, code: "MAX", reason: `Максимальная мощность — ${fmtKw(MAX_AVAILABLE_POWER_W)} kW.` };
  }
  return { ok: true, watts };
}

/** Inspector field is labelled kW; bare numbers default to kW. */
export function validateAvailablePowerInput(raw: string, defaultUnit: "W" | "kW" = "kW"): PowerResult {
  if (!raw.trim()) {
    return { ok: false, code: "BLANK", reason: "Введите мощность." };
  }
  const watts = parsePowerInputToWatts(raw, defaultUnit);
  if (watts == null) {
    return { ok: false, code: "PARSE", reason: "Некорректная мощность." };
  }
  return validateAvailablePowerW(watts);
}

export function typicalCurrentA(asic: AsicSpec, voltageV = SUPPLY_VOLTAGE_V): number {
  return asic.typicalPowerW / voltageV;
}

export function designCurrentA(asic: AsicSpec, voltageV = SUPPLY_VOLTAGE_V): number {
  return asic.designPowerW / voltageV;
}

export function distributePhases(count: number): { l1: number; l2: number; l3: number } {
  const base = Math.floor(count / PHASE_COUNT);
  const rem = count % PHASE_COUNT;
  return { l1: base + (rem > 0 ? 1 : 0), l2: base + (rem > 1 ? 1 : 0), l3: base };
}

export function usableElectricalW(supply: ElectricalSupply): number | null {
  if (!supply.known || supply.availablePowerW <= 0) return null;
  const reserve = Math.max(0, Math.min(0.9, supply.reservePct / 100));
  return supply.availablePowerW * (1 - reserve);
}

export function maxByPower(availableW: number, powerPerAsicW: number): number {
  if (powerPerAsicW <= 0) return 0;
  return Math.floor(availableW / powerPerAsicW);
}

export function calculateElectrical(project: Project, asic: AsicSpec | null) {
  const n = project.fleet.requestedCount;
  const traces: CalcTrace[] = [];
  const voltage = project.electrical.voltageV || SUPPLY_VOLTAGE_V;
  if (!asic) {
    return {
      asic: null,
      typicalTotalW: 0,
      designTotalW: 0,
      typicalCurrentA: 0,
      designCurrentA: 0,
      l1Count: 0,
      l2Count: 0,
      l3Count: 0,
      l1CurrentA: 0,
      l2CurrentA: 0,
      l3CurrentA: 0,
      imbalanceAsic: 0,
      remainingTypicalW: null as number | null,
      remainingDesignW: null as number | null,
      typicalPass: null as boolean | null,
      designPass: null as boolean | null,
      maxByTypical: null as number | null,
      maxByDesign: null as number | null,
      usableCapacityW: usableElectricalW(project.electrical),
      hashrateThs: 0,
      totalWeightKg: 0,
      supplyVoltageCompatible: null as boolean | null,
      traces,
    };
  }

  const voltageCompat = project.electrical.known ? supplyVoltageCompatible(asic, project.electrical.voltageV) : null;
  const iTyp = typicalCurrentA(asic, voltage);
  const iDes = designCurrentA(asic, voltage);
  traces.push({
    id: "I_typ",
    label: "Typical current per ASIC",
    formula: "I = P_typical / U",
    inputs: { P_typical_W: asic.typicalPowerW, U_V: voltage },
    raw: iTyp,
    unit: "A",
    display: formatAmps(iTyp),
  });
  traces.push({
    id: "I_des",
    label: "Design current per ASIC",
    formula: "I = P_design / U",
    inputs: { P_design_W: asic.designPowerW, U_V: voltage },
    raw: iDes,
    unit: "A",
    display: formatAmps(iDes),
  });

  const typicalTotalW = n * asic.typicalPowerW;
  const designTotalW = n * asic.designPowerW;
  traces.push({
    id: "P_typ_total",
    label: "Total typical power",
    formula: "N × P_typical",
    inputs: { N: n, P_typical_W: asic.typicalPowerW },
    raw: typicalTotalW,
    unit: "W",
    display: formatKw(typicalTotalW),
  });
  traces.push({
    id: "P_des_total",
    label: "Total design power",
    formula: "N × P_design",
    inputs: { N: n, P_design_W: asic.designPowerW },
    raw: designTotalW,
    unit: "W",
    display: formatKw(designTotalW),
  });

  const dist = distributePhases(n);
  const l1CurrentA = dist.l1 * iTyp;
  const l2CurrentA = dist.l2 * iTyp;
  const l3CurrentA = dist.l3 * iTyp;
  const imbalanceAsic = Math.max(dist.l1, dist.l2, dist.l3) - Math.min(dist.l1, dist.l2, dist.l3);

  const usable = usableElectricalW(project.electrical);
  const asicPlusAuxTypical = typicalTotalW + project.electrical.auxiliaryW + project.electrical.lightingW + project.electrical.networkW;
  const asicPlusAuxDesign = designTotalW + project.electrical.auxiliaryW + project.electrical.lightingW + project.electrical.networkW;

  let typicalPass: boolean | null = null;
  let designPass: boolean | null = null;
  let remainingTypicalW: number | null = null;
  let remainingDesignW: number | null = null;
  let maxByTypical: number | null = null;
  let maxByDesign: number | null = null;
  if (usable != null) {
    typicalPass = asicPlusAuxTypical <= usable + 1e-9;
    designPass = asicPlusAuxDesign <= usable + 1e-9;
    remainingTypicalW = usable - asicPlusAuxTypical;
    remainingDesignW = usable - asicPlusAuxDesign;
    const aux = project.electrical.auxiliaryW + project.electrical.lightingW + project.electrical.networkW;
    maxByTypical = maxByPower(Math.max(0, usable - aux), asic.typicalPowerW);
    maxByDesign = maxByPower(Math.max(0, usable - aux), asic.designPowerW);
    if (voltageCompat === false) {
      maxByTypical = 0;
      maxByDesign = 0;
      typicalPass = false;
      designPass = false;
    }
    traces.push({
      id: "usable_W",
      label: "Usable electrical capacity",
      formula: "P_available × (1 − reserve)",
      inputs: { P_available_W: project.electrical.availablePowerW, reserve_pct: project.electrical.reservePct },
      raw: usable,
      unit: "W",
      display: formatKw(usable),
    });
  }

  return {
    asic,
    typicalTotalW,
    designTotalW,
    typicalCurrentA: iTyp,
    designCurrentA: iDes,
    l1Count: dist.l1,
    l2Count: dist.l2,
    l3Count: dist.l3,
    l1CurrentA,
    l2CurrentA,
    l3CurrentA,
    imbalanceAsic,
    remainingTypicalW,
    remainingDesignW,
    typicalPass,
    designPass,
    maxByTypical,
    maxByDesign,
    usableCapacityW: usable,
    hashrateThs: n * asic.hashrateThs,
    totalWeightKg: n * asic.weightKg,
    supplyVoltageCompatible: voltageCompat,
    traces,
  };
}
