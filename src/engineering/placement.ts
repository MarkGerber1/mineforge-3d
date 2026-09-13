import { aabbInside, aabbOverlap, doorSwingAabb, rackAabb, roomAabb } from "./geometry.ts";
import type { Project, Rack } from "./types.ts";

export interface PlacementResult {
  ok: boolean;
  errors: string[];
  code: "OK" | "OUTSIDE" | "RACK_OVERLAP" | "DOOR_SWING" | "DUPLICATE_ID";
}

export function validateRackPlacement(
  project: Project,
  rack: Rack,
  opts?: { ignoreIds?: Iterable<string> },
): PlacementResult {
  const ignore = new Set(opts?.ignoreIds ?? []);
  const bb = rackAabb(rack);
  if (!aabbInside(bb, roomAabb(project))) {
    return {
      ok: false,
      errors: ["Стойка должна быть полностью внутри помещения."],
      code: "OUTSIDE",
    };
  }
  for (const other of project.racks) {
    if (other.id === rack.id || ignore.has(other.id)) continue;
    if (aabbOverlap(bb, rackAabb(other)) > 0) {
      return {
        ok: false,
        errors: [`Стойка пересекается с ${other.name}.`],
        code: "RACK_OVERLAP",
      };
    }
  }
  for (const door of project.openings.filter((o) => o.type === "DOOR")) {
    const sw = doorSwingAabb(project, door);
    if (sw && aabbOverlap(bb, sw) > 0) {
      return {
        ok: false,
        errors: ["Стойка пересекает зону открывания двери."],
        code: "DOOR_SWING",
      };
    }
  }
  return { ok: true, errors: [], code: "OK" };
}

export function validateRacksConfiguration(
  project: Project,
  nextRacks: Rack[],
  movingIds: string[],
): PlacementResult {
  const seen = new Set<string>();
  for (const r of nextRacks) {
    if (seen.has(r.id)) {
      return {
        ok: false,
        errors: ["В конфигурации есть стойки с одинаковым идентификатором."],
        code: "DUPLICATE_ID",
      };
    }
    seen.add(r.id);
  }
  const next = { ...project, racks: nextRacks };
  for (const id of movingIds) {
    const rack = nextRacks.find((r) => r.id === id);
    if (!rack) continue;
    const v = validateRackPlacement(next, rack, { ignoreIds: [rack.id] });
    if (!v.ok) return v;
  }
  return { ok: true, errors: [], code: "OK" };
}
