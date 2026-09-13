import { validateOpening, wallLength } from "./geometry.ts";
import type { Opening, Project, WallId } from "./types.ts";

const REASSIGNABLE: ReadonlySet<Opening["type"]> = new Set([
  "DOOR",
  "INTAKE",
  "EXHAUST",
  "TECHNICAL",
  "SHAFT_CONNECTION",
  "CUSTOM",
]);

export function clampOpeningOffset(project: Project, wallId: WallId, widthM: number, offsetM: number): number {
  const L = wallLength(project, wallId);
  const max = Math.max(0, L - widthM);
  if (!Number.isFinite(offsetM)) return 0;
  return Math.min(max, Math.max(0, offsetM));
}

/**
 * Move a door / intake / exhaust / technical opening to another wall.
 * Keeps width, height, elevation. Recalculates offset (ratio of old wall,
 * or an explicit offset) and validates placement. Invalid → REJECT.
 */
export function reassignOpeningWall(
  project: Project,
  openingId: string,
  wallId: WallId,
  offsetM?: number,
): { ok: true; project: Project; opening: Opening } | { ok: false; errors: string[]; project: Project } {
  const src = project.openings.find((o) => o.id === openingId);
  if (!src) return { ok: false, errors: ["Проём не найден."], project };
  if (src.locked) return { ok: false, errors: ["Проём заблокирован."], project };
  if (!REASSIGNABLE.has(src.type)) {
    return { ok: false, errors: [`Тип ${src.type} нельзя перенести на другую стену.`], project };
  }
  if (src.wallId === wallId && (offsetM == null || Math.abs(offsetM - src.offsetFromWallStartM) < 1e-9)) {
    return { ok: true, project, opening: src };
  }
  const L = wallLength(project, wallId);
  if (src.widthM > L + 1e-9) {
    return {
      ok: false,
      errors: [`Ширина ${src.widthM.toFixed(3)} m больше стены ${wallId} (${L.toFixed(3)} m).`],
      project,
    };
  }
  const oldL = wallLength(project, src.wallId);
  const ratio = oldL > 1e-9 ? src.offsetFromWallStartM / oldL : 0;
  const raw = offsetM != null && Number.isFinite(offsetM) ? offsetM : ratio * L;
  const offset = clampOpeningOffset(project, wallId, src.widthM, raw);
  const nextOpening: Opening = { ...src, wallId, offsetFromWallStartM: offset };
  const others = project.openings.filter((o) => o.id !== openingId);
  const v = validateOpening({ ...project, openings: [...others, nextOpening] }, nextOpening, others);
  if (!v.ok) return { ok: false, errors: v.errors, project };
  return {
    ok: true,
    project: {
      ...project,
      openings: project.openings.map((o) => (o.id === openingId ? nextOpening : o)),
    },
    opening: nextOpening,
  };
}
