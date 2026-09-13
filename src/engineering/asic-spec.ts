import type { AsicSpec } from "./types.ts";

export type AsicSpecOk = { ok: true };
export type AsicSpecErr = { ok: false; errors: string[] };
export type AsicSpecResult = AsicSpecOk | AsicSpecErr;

function finitePositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

function finiteNonNegative(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

/**
 * Intrinsic ASIC-spec relations. Used for imported specs (canonical reject)
 * and resolved catalog specs (Engineering BLOCKER, never silent repair).
 */
export function validateAsicSpecRelations(asic: AsicSpec, tag = asic.model || asic.id): AsicSpecResult {
  const errors: string[] = [];
  const label = `ASIC ${tag}`;

  if (!finiteNonNegative(asic.hashrateThs)) errors.push(`${label}: hashrateThs должно быть конечным ≥ 0.`);
  if (!finitePositive(asic.typicalPowerW)) errors.push(`${label}: typicalPowerW должно быть конечным > 0.`);
  if (!finitePositive(asic.designPowerW)) errors.push(`${label}: designPowerW должно быть конечным > 0.`);
  if (
    Number.isFinite(asic.typicalPowerW) &&
    Number.isFinite(asic.designPowerW) &&
    asic.designPowerW < asic.typicalPowerW
  ) {
    errors.push(`${label}: designPowerW меньше typicalPowerW.`);
  }
  if (!finitePositive(asic.voltageMin)) errors.push(`${label}: voltageMin должно быть конечным > 0.`);
  if (!finitePositive(asic.voltageMax)) errors.push(`${label}: voltageMax должно быть конечным > 0.`);
  if (
    Number.isFinite(asic.voltageMin) &&
    Number.isFinite(asic.voltageMax) &&
    asic.voltageMin > asic.voltageMax
  ) {
    errors.push(`${label}: voltageMin больше voltageMax.`);
  }
  if (asic.currentA != null && !finiteNonNegative(asic.currentA)) {
    errors.push(`${label}: currentA должно быть конечным ≥ 0.`);
  }
  if (!finitePositive(asic.widthM)) errors.push(`${label}: ширина должна быть конечной > 0.`);
  if (!finitePositive(asic.heightM)) errors.push(`${label}: высота должна быть конечной > 0.`);
  if (!finitePositive(asic.lengthM)) errors.push(`${label}: длина должна быть конечной > 0.`);
  if (!finitePositive(asic.weightKg)) errors.push(`${label}: масса должна быть конечной > 0.`);
  if (asic.manufacturerAirflowM3h != null && !finiteNonNegative(asic.manufacturerAirflowM3h)) {
    errors.push(`${label}: расход должен быть конечным ≥ 0.`);
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

export function supplyVoltageCompatible(asic: AsicSpec, voltageV: number): boolean {
  return asic.voltageMin - 1e-12 <= voltageV && voltageV <= asic.voltageMax + 1e-12;
}
