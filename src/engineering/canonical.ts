import {
  MAX_FAN_GROUP_COUNT,
  MAX_RACK_ASIC_COUNT,
  MAX_RACK_SHELVES,
  MAX_RESERVE_PCT,
  MAX_ROOM_DIM_M,
  MAX_ROOM_HEIGHT_M,
  MAX_SHAFT_LENGTH_M,
  MIN_DELTA_T_K,
  MAX_DELTA_T_K,
  MIN_FAN_GROUP_COUNT,
  MIN_RACK_SHELVES,
  MIN_RESERVE_PCT,
  isSupportedRackRotationDeg,
} from "./constants.ts";
import { validateAsicSpecRelations } from "./asic-spec.ts";
import { validateAvailablePowerW } from "./electrical.ts";
import { resolveAsic, type Catalogs } from "./pipeline.ts";
import { rackAsicCapacity, validateRackAsicCount } from "./racks.ts";
import { validateRoomHeightM, validateRoomLengthM } from "./room-resize.ts";
import type { AsicSpec, AsBuiltObject, FanInstance, Opening, Project, Rack, VentComponent } from "./types.ts";

export type CanonicalOk = { ok: true };
export type CanonicalErr = { ok: false; errors: string[] };
export type CanonicalResult = CanonicalOk | CanonicalErr;

export type RequestedOk = { ok: true; count: number };
export type RequestedErr = {
  ok: false;
  code: "NAN" | "INFINITY" | "NEGATIVE" | "FRACTION";
  reason: string;
};
export type RequestedResult = RequestedOk | RequestedErr;

export function validateRequestedCount(count: number): RequestedResult {
  if (Number.isNaN(count)) {
    return { ok: false, code: "NAN", reason: "Запрошенное количество ASIC должно быть целым числом." };
  }
  if (!Number.isFinite(count)) {
    return { ok: false, code: "INFINITY", reason: "Запрошенное количество ASIC должно быть конечным числом." };
  }
  if (count < 0) {
    return { ok: false, code: "NEGATIVE", reason: "Запрошенное количество ASIC не может быть отрицательным." };
  }
  if (!Number.isInteger(count)) {
    return { ok: false, code: "FRACTION", reason: "Дробное количество ASIC недопустимо." };
  }
  return { ok: true, count };
}

function pushFinite(errors: string[], n: number, label: string): boolean {
  if (Number.isNaN(n)) {
    errors.push(`${label}: значение не является числом.`);
    return false;
  }
  if (!Number.isFinite(n)) {
    errors.push(`${label}: значение должно быть конечным.`);
    return false;
  }
  return true;
}

function pushMin(errors: string[], n: number, min: number, label: string, extra?: string): boolean {
  if (n < min) {
    errors.push(extra ?? `${label}: значение меньше допустимого (${min}).`);
    return false;
  }
  return true;
}

function pushMax(errors: string[], n: number, max: number, label: string, extra?: string): boolean {
  if (n > max) {
    errors.push(extra ?? `${label}: значение больше допустимого (${max}).`);
    return false;
  }
  return true;
}

function pushPositive(errors: string[], n: number, label: string): boolean {
  if (!(n > 0)) {
    errors.push(`${label}: значение должно быть больше нуля.`);
    return false;
  }
  return true;
}

function pushNonNegative(errors: string[], n: number, label: string): boolean {
  if (n < 0) {
    errors.push(`${label}: значение не может быть отрицательным.`);
    return false;
  }
  return true;
}

function pushInteger(errors: string[], n: number, label: string): boolean {
  if (!Number.isInteger(n)) {
    errors.push(`${label}: должно быть целым числом.`);
    return false;
  }
  return true;
}

export function validateDeltaTK(k: number): CanonicalResult {
  const errors: string[] = [];
  if (!pushFinite(errors, k, "ΔT")) return { ok: false, errors };
  if (k < MIN_DELTA_T_K) errors.push(`ΔT: минимум ${MIN_DELTA_T_K} K.`);
  if (k > MAX_DELTA_T_K) errors.push(`ΔT: максимум ${MAX_DELTA_T_K} K.`);
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateReservePct(pct: number): CanonicalResult {
  const errors: string[] = [];
  if (!pushFinite(errors, pct, "Резерв")) return { ok: false, errors };
  if (pct < MIN_RESERVE_PCT || pct > MAX_RESERVE_PCT) {
    errors.push(`Резерв: допустимо ${MIN_RESERVE_PCT}…${MAX_RESERVE_PCT} %.`);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validateFanCount(count: number): CanonicalResult {
  const errors: string[] = [];
  if (!pushFinite(errors, count, "Количество вентиляторов")) return { ok: false, errors };
  if (!pushInteger(errors, count, "Количество вентиляторов")) return { ok: false, errors };
  if (count < MIN_FAN_GROUP_COUNT) errors.push("Количество вентиляторов: минимум 1.");
  if (count > MAX_FAN_GROUP_COUNT) {
    errors.push(`Количество вентиляторов: максимум ${MAX_FAN_GROUP_COUNT}.`);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

function validateFacilityLoadW(n: number, label: string, errors: string[]): void {
  if (!pushFinite(errors, n, label)) return;
  pushNonNegative(errors, n, label);
}

function validateOpeningPrimitives(o: Opening, errors: string[]): void {
  const tag = o.name ?? o.id;
  // Spatial >0 / on-wall rules stay in validateOpening (Engineering fail-closed).
  // Domain here only rejects non-finite primitives so NaN cannot reach SAFE.
  pushFinite(errors, o.widthM, `Проём ${tag} ширина`);
  pushFinite(errors, o.heightM, `Проём ${tag} высота`);
  pushFinite(errors, o.bottomElevationM, `Проём ${tag} отметка низа`);
  pushFinite(errors, o.offsetFromWallStartM, `Проём ${tag} смещение`);
}

function validateVentComponent(c: VentComponent, errors: string[]): void {
  const tag = c.name || c.id;
  if (pushFinite(errors, c.lengthM, `Сеть ${tag} длина`)) {
    pushNonNegative(errors, c.lengthM, `Сеть ${tag} длина`);
    pushMax(errors, c.lengthM, MAX_SHAFT_LENGTH_M, `Сеть ${tag} длина`, `Сеть ${tag} длина: максимум ${MAX_SHAFT_LENGTH_M} м.`);
  }
  if (pushFinite(errors, c.frictionFactor, `Сеть ${tag} трение`)) {
    pushNonNegative(errors, c.frictionFactor, `Сеть ${tag} трение`);
  }
  if (pushFinite(errors, c.kLocal, `Сеть ${tag} K`)) {
    pushNonNegative(errors, c.kLocal, `Сеть ${tag} K`);
  }
  if (pushFinite(errors, c.extraPressurePa, `Сеть ${tag} доп. давление`)) {
    pushNonNegative(errors, c.extraPressurePa, `Сеть ${tag} доп. давление`);
  }
  if (c.shape === "round") {
    if (c.diameterM == null) {
      errors.push(`Сеть ${tag}: для круглого сечения нужен диаметр.`);
    } else if (pushFinite(errors, c.diameterM, `Сеть ${tag} диаметр`)) {
      pushPositive(errors, c.diameterM, `Сеть ${tag} диаметр`);
    }
  } else {
    if (c.widthM == null || c.heightM == null) {
      errors.push(`Сеть ${tag}: для прямоугольного сечения нужны ширина и высота.`);
    } else {
      if (pushFinite(errors, c.widthM, `Сеть ${tag} ширина`)) pushPositive(errors, c.widthM, `Сеть ${tag} ширина`);
      if (pushFinite(errors, c.heightM, `Сеть ${tag} высота`)) pushPositive(errors, c.heightM, `Сеть ${tag} высота`);
    }
  }
  if (c.diameterM != null && c.shape !== "round") {
    if (pushFinite(errors, c.diameterM, `Сеть ${tag} диаметр`)) pushPositive(errors, c.diameterM, `Сеть ${tag} диаметр`);
  }
}

function validateRackGeometry(r: Rack, errors: string[]): void {
  const tag = r.name || r.id;
  pushFinite(errors, r.x, `Стойка ${tag} X`);
  pushFinite(errors, r.y, `Стойка ${tag} Y`);
  if (pushFinite(errors, r.widthM, `Стойка ${tag} ширина`)) {
    pushPositive(errors, r.widthM, `Стойка ${tag} ширина`);
    pushMax(errors, r.widthM, MAX_ROOM_DIM_M, `Стойка ${tag} ширина`);
  }
  if (pushFinite(errors, r.depthM, `Стойка ${tag} глубина`)) {
    pushPositive(errors, r.depthM, `Стойка ${tag} глубина`);
    pushMax(errors, r.depthM, MAX_ROOM_DIM_M, `Стойка ${tag} глубина`);
  }
  if (pushFinite(errors, r.heightM, `Стойка ${tag} высота`)) {
    pushPositive(errors, r.heightM, `Стойка ${tag} высота`);
    pushMax(errors, r.heightM, MAX_ROOM_HEIGHT_M, `Стойка ${tag} высота`);
  }
  if (pushFinite(errors, r.rotationDeg, `Стойка ${tag} поворот`)) {
    if (!isSupportedRackRotationDeg(r.rotationDeg)) {
      errors.push(`Стойка ${tag} поворот: допустимы 0/90/180/270°.`);
    }
  }
  if (pushFinite(errors, r.shelves, `Стойка ${tag} полки`)) {
    if (pushInteger(errors, r.shelves, `Стойка ${tag} полки`)) {
      pushMin(errors, r.shelves, MIN_RACK_SHELVES, `Стойка ${tag} полки`);
      pushMax(errors, r.shelves, MAX_RACK_SHELVES, `Стойка ${tag} полки`, `Стойка ${tag} полки: максимум ${MAX_RACK_SHELVES}.`);
    }
  }
  if (pushFinite(errors, r.usableShelfWidthM, `Стойка ${tag} полка ширина`)) {
    if (pushPositive(errors, r.usableShelfWidthM, `Стойка ${tag} полка ширина`)) {
      if (Number.isFinite(r.widthM) && r.usableShelfWidthM > r.widthM + 1e-12) {
        errors.push(`Стойка ${tag}: полезная ширина полки больше корпуса.`);
      }
    }
  }
  if (pushFinite(errors, r.usableShelfDepthM, `Стойка ${tag} полка глубина`)) {
    if (pushPositive(errors, r.usableShelfDepthM, `Стойка ${tag} полка глубина`)) {
      if (Number.isFinite(r.depthM) && r.usableShelfDepthM > r.depthM + 1e-12) {
        errors.push(`Стойка ${tag}: полезная глубина полки больше корпуса.`);
      }
    }
  }
}

function validateFanInstance(f: FanInstance, errors: string[]): void {
  const tag = f.name || f.id;
  pushFinite(errors, f.x, `Вентилятор ${tag} X`);
  pushFinite(errors, f.y, `Вентилятор ${tag} Y`);
  const c = validateFanCount(f.count);
  if (!c.ok) errors.push(...c.errors.map((e) => `Вентилятор ${tag}: ${e}`));
}

function validateImportedAsic(asic: AsicSpec, errors: string[]): void {
  const tag = asic.model || asic.id;
  const rel = validateAsicSpecRelations(asic, tag);
  if (!rel.ok) errors.push(...rel.errors);
}

function validateAsBuilt(obj: AsBuiltObject, errors: string[]): void {
  const tag = `As-built ${obj.name || obj.id}`;
  pushFinite(errors, obj.x, `${tag} X`);
  pushFinite(errors, obj.y, `${tag} Y`);
  pushFinite(errors, obj.z, `${tag} Z`);
  if (pushFinite(errors, obj.widthM, `${tag} ширина`)) pushPositive(errors, obj.widthM, `${tag} ширина`);
  if (pushFinite(errors, obj.heightM, `${tag} высота`)) pushPositive(errors, obj.heightM, `${tag} высота`);
  if (pushFinite(errors, obj.depthM, `${tag} глубина`)) pushPositive(errors, obj.depthM, `${tag} глубина`);
}

function validateNonSafetyFinite(n: number, label: string, errors: string[]): void {
  pushFinite(errors, n, label);
}

/**
 * Single reusable canonical Project-domain boundary for safety-critical numbers.
 * Fail closed. Never clamp or round. Catalog-dependent rack capacity is included
 * when the ASIC specification is resolvable.
 *
 * QX-02B-R5: every SAFETY_DRIVING / SAFETY_GEOMETRY numeric on Project is
 * checked here. Ingress paths must call this function; they must not invent
 * a second set of ranges.
 */
export function validateCanonicalProjectDomains(project: Project, catalogs: Catalogs): CanonicalResult {
  const errors: string[] = [];

  const w = validateRoomLengthM(project.room.widthM);
  if (!w.ok) errors.push(`Ширина: ${w.reason}`);
  const d = validateRoomLengthM(project.room.depthM);
  if (!d.ok) errors.push(`Глубина: ${d.reason}`);
  const h = validateRoomHeightM(project.room.heightM);
  if (!h.ok) errors.push(`Высота: ${h.reason}`);
  if (pushFinite(errors, project.room.wallThicknessM, "Толщина стены")) {
    pushPositive(errors, project.room.wallThicknessM, "Толщина стены");
    pushMax(errors, project.room.wallThicknessM, MAX_ROOM_DIM_M, "Толщина стены");
  }

  if (project.electrical.known) {
    const pwr = validateAvailablePowerW(project.electrical.availablePowerW);
    if (!pwr.ok) errors.push(`Электричество: ${pwr.reason}`);
  } else if (!Number.isFinite(project.electrical.availablePowerW)) {
    errors.push("Электричество: мощность должна быть конечным числом.");
  }

  const e = project.electrical;
  if (pushFinite(errors, e.voltageV, "Напряжение")) pushPositive(errors, e.voltageV, "Напряжение");
  if (pushFinite(errors, e.frequencyHz, "Частота")) pushPositive(errors, e.frequencyHz, "Частота");
  const reserve = validateReservePct(e.reservePct);
  if (!reserve.ok) errors.push(...reserve.errors);
  validateFacilityLoadW(e.auxiliaryW, "Собственные нужды", errors);
  validateFacilityLoadW(e.lightingW, "Освещение", errors);
  validateFacilityLoadW(e.networkW, "Сеть", errors);

  const dT = validateDeltaTK(project.thermal.deltaTK);
  if (!dT.ok) errors.push(...dT.errors);
  validateNonSafetyFinite(project.thermal.outdoorTempC, "Наружная температура", errors);
  validateNonSafetyFinite(project.thermal.intakeTempC, "Температура всасывания", errors);
  validateNonSafetyFinite(project.ventilation.outdoorTempC, "Наружная температура вентиляции", errors);

  if (pushFinite(errors, project.ventilation.dirtyFilterExtraPa, "Грязный фильтр")) {
    pushNonNegative(errors, project.ventilation.dirtyFilterExtraPa, "Грязный фильтр");
  }
  for (const c of project.ventilation.components) validateVentComponent(c, errors);

  const req = validateRequestedCount(project.fleet.requestedCount);
  if (!req.ok) errors.push(req.reason);
  if (project.fleet.imported) validateImportedAsic(project.fleet.imported, errors);

  const asic = resolveAsic(project, catalogs);
  for (const r of project.racks) {
    validateRackGeometry(r, errors);
    const cap = asic ? rackAsicCapacity(r, asic) : MAX_RACK_ASIC_COUNT;
    const c = validateRackAsicCount(r.asicCount, cap);
    if (!c.ok) errors.push(`${r.name}: ${c.reason}`);
  }

  for (const f of project.fans) validateFanInstance(f, errors);

  const cons = project.constraints;
  if (pushFinite(errors, cons.frontServiceClearanceM, "Фронтальный проход")) {
    pushNonNegative(errors, cons.frontServiceClearanceM, "Фронтальный проход");
  }
  if (pushFinite(errors, cons.rearServiceClearanceM, "Тыльный проход")) {
    pushNonNegative(errors, cons.rearServiceClearanceM, "Тыльный проход");
  }
  if (pushFinite(errors, cons.minAisleM, "Минимальный проход")) {
    pushNonNegative(errors, cons.minAisleM, "Минимальный проход");
  }
  if (cons.maxFloorLoadPa != null) {
    if (pushFinite(errors, cons.maxFloorLoadPa, "Нагрузка на перекрытие")) {
      pushPositive(errors, cons.maxFloorLoadPa, "Нагрузка на перекрытие");
    }
  }
  if (!cons.floorLoadingUnknown) {
    if (cons.maxFloorLoadPa == null) {
      errors.push("Нагрузка на перекрытие: если известна, задайте допустимое давление > 0 Па.");
    }
  }

  for (const o of project.openings) validateOpeningPrimitives(o, errors);
  for (const obj of project.reality?.asBuilt ?? []) validateAsBuilt(obj, errors);

  return errors.length ? { ok: false, errors } : { ok: true };
}
