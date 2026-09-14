/**
 * One deletion-permission rule for 2D, 3D, Photo, and AI.
 * Locked means locked regardless of mutation source.
 *
 * Identity contract (QX-03R4 R16): TYPED CANONICAL IDENTITY.
 * Lock comparison keys are `kind:id` so a different collection that happens
 * to reuse the same raw string cannot satisfy "still present".
 */
import type { Project } from "./types.ts";

export const OBJECT_LOCKED_RU = "Объект заблокирован и не может быть удалён.";

export type CanonicalCollection =
  | "opening"
  | "rack"
  | "fan"
  | "vent"
  | "asBuilt"
  | "finding"
  | "photo"
  | "video";

export type TypedCanonicalId = { kind: CanonicalCollection; id: string };

export function typedCanonicalKey(kind: CanonicalCollection, id: string): string {
  return `${kind}:${id}`;
}

export function typedCanonicalIds(project: Project): TypedCanonicalId[] {
  const out: TypedCanonicalId[] = [];
  const push = (kind: CanonicalCollection, id: string | undefined) => {
    if (id) out.push({ kind, id });
  };
  for (const o of project.openings) push("opening", o.id);
  for (const r of project.racks) push("rack", r.id);
  for (const f of project.fans) push("fan", f.id);
  for (const c of project.ventilation.components) push("vent", c.id);
  for (const a of project.reality?.asBuilt ?? []) push("asBuilt", a.id);
  for (const f of project.reality?.findings ?? []) push("finding", f.id);
  for (const p of project.reality?.photos ?? []) push("photo", p.id);
  for (const v of project.reality?.videos ?? []) push("video", v.id);
  return out;
}

export function canonicalObjectIds(project: Project): string[] {
  return typedCanonicalIds(project).map((t) => t.id);
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

/**
 * Locked typed identities that exist in `before` and are missing from `after`.
 * A raw ID appearing in a different collection does not count as still present.
 */
export function lockedCanonicalDeletions(before: Project, after: Project): string[] {
  const afterKeys = new Set(typedCanonicalIds(after).map((t) => typedCanonicalKey(t.kind, t.id)));
  const missing: string[] = [];
  for (const t of typedCanonicalIds(before)) {
    if (isCanonicalLocked(before, t.id) && !afterKeys.has(typedCanonicalKey(t.kind, t.id))) {
      missing.push(t.id);
    }
  }
  return missing;
}
