import type { Project } from "./types.ts";

/** Physical Digital Twin ASIC assignment — every canonical rack, including blocked. */
export function placedAsicCount(project: Project): number {
  return project.racks.reduce((s, r) => s + (Number.isFinite(r.asicCount) ? r.asicCount : 0), 0);
}

/**
 * Electrical / thermal demand never understates physical inventory.
 * Canonical projects have placed ≤ requested, so this equals requested.
 */
export function engineeringDemandCount(project: Project): number {
  return Math.max(project.fleet.requestedCount, placedAsicCount(project));
}

export function placedExceedsRequestedReason(placed: number, requested: number): string {
  return `В стойках уже размещено ${placed} ASIC. REQUESTED нельзя уменьшить до ${requested}.`;
}
