import { MAX_RACK_ASIC_COUNT } from "./constants.ts";
import { validateAvailablePowerW } from "./electrical.ts";
import { resolveAsic, type Catalogs } from "./pipeline.ts";
import { rackAsicCapacity, validateRackAsicCount } from "./racks.ts";
import { validateRoomHeightM, validateRoomLengthM } from "./room-resize.ts";
import type { Project } from "./types.ts";

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

/**
 * Single reusable canonical Project-domain boundary for safety-critical numbers.
 * Fail closed. Never clamp or round. Catalog-dependent rack capacity is included
 * when the ASIC specification is resolvable.
 */
export function validateCanonicalProjectDomains(project: Project, catalogs: Catalogs): CanonicalResult {
  const errors: string[] = [];

  const w = validateRoomLengthM(project.room.widthM);
  if (!w.ok) errors.push(`Ширина: ${w.reason}`);
  const d = validateRoomLengthM(project.room.depthM);
  if (!d.ok) errors.push(`Глубина: ${d.reason}`);
  const h = validateRoomHeightM(project.room.heightM);
  if (!h.ok) errors.push(`Высота: ${h.reason}`);

  if (project.electrical.known) {
    const pwr = validateAvailablePowerW(project.electrical.availablePowerW);
    if (!pwr.ok) errors.push(`Электричество: ${pwr.reason}`);
  } else if (!Number.isFinite(project.electrical.availablePowerW)) {
    errors.push("Электричество: мощность должна быть конечным числом.");
  }

  const req = validateRequestedCount(project.fleet.requestedCount);
  if (!req.ok) errors.push(req.reason);

  const asic = resolveAsic(project, catalogs);
  for (const r of project.racks) {
    const cap = asic ? rackAsicCapacity(r, asic) : MAX_RACK_ASIC_COUNT;
    const c = validateRackAsicCount(r.asicCount, cap);
    if (!c.ok) errors.push(`${r.name}: ${c.reason}`);
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
