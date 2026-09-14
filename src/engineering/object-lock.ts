/**
 * One deletion-permission rule for 2D, 3D, Photo, and AI.
 * Locked means locked regardless of mutation source.
 */
import type { Project } from "./types.ts";

export const OBJECT_LOCKED_RU = "Объект заблокирован и не может быть удалён.";

export function canonicalObjectIds(project: Project): string[] {
  const ids: string[] = [];
  const push = (id: string | undefined) => {
    if (id) ids.push(id);
  };
  for (const o of project.openings) push(o.id);
  for (const r of project.racks) push(r.id);
  for (const f of project.fans) push(f.id);
  for (const c of project.ventilation.components) push(c.id);
  for (const a of project.reality?.asBuilt ?? []) push(a.id);
  for (const f of project.reality?.findings ?? []) push(f.id);
  for (const p of project.reality?.photos ?? []) push(p.id);
  for (const v of project.reality?.videos ?? []) push(v.id);
  return ids;
}

export function isCanonicalLocked(project: Project, id: string): boolean {
  if (!id) return false;
  if (project.lockedObjectIds.includes(id)) return true;
  const opening = project.openings.find((o) => o.id === id);
  if (opening?.locked) return true;
  const rack = project.racks.find((r) => r.id === id);
  if (rack?.locked) return true;
  return false;
}

export function lockedDeletionTargets(project: Project, ids: Iterable<string>): string[] {
  return [...ids].filter((id) => isCanonicalLocked(project, id));
}

/** Locked IDs that exist in `before` and are missing from `after`. */
export function lockedCanonicalDeletions(before: Project, after: Project): string[] {
  const afterIds = new Set(canonicalObjectIds(after));
  const missing: string[] = [];
  for (const id of canonicalObjectIds(before)) {
    if (isCanonicalLocked(before, id) && !afterIds.has(id)) missing.push(id);
  }
  return missing;
}
