import { AIR_CP_J_KG_K, AIR_DENSITY_KG_M3 } from "./constants.ts";
import type { AsicSpec, CalcTrace, Project } from "./types.ts";
import { formatM3h, m3sToM3h } from "./units.ts";

export function thermalAirflowM3s(
  heatW: number,
  deltaTK: number,
  rho = AIR_DENSITY_KG_M3,
  cp = AIR_CP_J_KG_K,
): number {
  if (deltaTK <= 0 || rho <= 0 || cp <= 0) return Infinity;
  return heatW / (rho * cp * deltaTK);
}

export function calculateThermal(project: Project, asic: AsicSpec | null, typicalTotalW: number) {
  const traces: CalcTrace[] = [];
  const n = project.fleet.requestedCount;
  const asicHeatW = asic ? typicalTotalW : 0;
  const auxiliaryHeatW =
    project.electrical.auxiliaryW + project.electrical.lightingW + project.electrical.networkW;
  const fanHeat = project.fans.reduce((s, f) => s + (f.count > 0 ? f.count * 0 : 0), 0);
  const totalHeatW = asicHeatW + auxiliaryHeatW + fanHeat;
  const dT = project.thermal.deltaTK;
  const qM3s = thermalAirflowM3s(totalHeatW, dT);
  const qM3h = m3sToM3h(qM3s);
  const equipmentAirflowM3h = asic?.manufacturerAirflowM3h != null ? n * asic.manufacturerAirflowM3h : 0;
  const designAirflowM3h = Math.max(qM3h, equipmentAirflowM3h);
  const dominant: "thermal" | "equipment" | "none" =
    totalHeatW <= 0 && equipmentAirflowM3h <= 0 ? "none" : qM3h >= equipmentAirflowM3h ? "thermal" : "equipment";

  traces.push({
    id: "P_heat",
    label: "Facility thermal load",
    formula: "P_asic_typical + P_aux (100% of electrical load becomes heat)",
    inputs: { P_asic_W: asicHeatW, P_aux_W: auxiliaryHeatW },
    raw: totalHeatW,
    unit: "W",
    display: `${totalHeatW} W`,
  });
  traces.push({
    id: "Q_thermal",
    label: "Thermal airflow",
    formula: "Q = P / (ρ × Cp × ΔT)",
    inputs: { P_W: totalHeatW, rho: AIR_DENSITY_KG_M3, Cp: AIR_CP_J_KG_K, dT_K: dT },
    raw: qM3h,
    unit: "m³/h",
    display: formatM3h(qM3h),
  });
  traces.push({
    id: "Q_equip",
    label: "Equipment airflow",
    formula: "N × Q_asic",
    inputs: { N: n, Q_asic_m3h: asic?.manufacturerAirflowM3h ?? 0 },
    raw: equipmentAirflowM3h,
    unit: "m³/h",
    display: formatM3h(equipmentAirflowM3h),
  });
  traces.push({
    id: "Q_design",
    label: "Design airflow requirement",
    formula: "max(Q_thermal, Q_equipment)",
    inputs: { Q_thermal_m3h: qM3h, Q_equip_m3h: equipmentAirflowM3h },
    raw: designAirflowM3h,
    unit: "m³/h",
    display: formatM3h(designAirflowM3h),
  });

  return {
    asicHeatW,
    auxiliaryHeatW,
    totalHeatW,
    thermalAirflowM3s: qM3s,
    thermalAirflowM3h: qM3h,
    equipmentAirflowM3h,
    designAirflowM3h,
    designAirflowM3s: designAirflowM3h / 3600,
    dominant,
    traces,
  };
}

export function requiredAirflowPerAsicM3h(
  asic: AsicSpec,
  deltaTK: number,
  extraHeatPerAsicW = 0,
): number {
  const heat = asic.typicalPowerW + extraHeatPerAsicW;
  const thermal = m3sToM3h(thermalAirflowM3s(heat, deltaTK));
  const equip = asic.manufacturerAirflowM3h ?? 0;
  return Math.max(thermal, equip);
}
