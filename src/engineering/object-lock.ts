/**
 * One deletion-permission rule for 2D, 3D, Photo, and AI.
 * Locked means locked regardless of mutation source.
 */
import type { Project } from "./types.ts";

export const OBJECT_LOCKED_RU = "Объект заблокирован и не может быть удалён.";

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
