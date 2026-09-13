import type { AsicSpec, Project, Rack } from "./types.ts";
import { aabbInside, aabbOverlap, doorSwingAabb, rackAabb, roomAabb } from "./geometry.ts";
import { asicsPerShelf } from "./racks.ts";

function nid(prefix: string, i: number): string {
  return `${prefix}_${i}`;
}

export function defaultRackTemplate(): Omit<Rack, "id" | "x" | "y" | "name" | "asicCount" | "airflowToward"> {
  return {
    widthM: 1.6,
    depthM: 0.6,
    heightM: 2.0,
    rotationDeg: 0,
    shelves: 4,
    usableShelfWidthM: 1.5,
    usableShelfDepthM: 0.55,
  };
}

/**
 * Deterministic hot/cold aisle heuristic.
 * Rows run along X (width). Intake faces the cold aisle (south of first row).
 * Target semantics: place exactly `fleet.requestedCount` ASICs, never more.
 * target = 0 → no racks. A rack never exceeds per-rack capacity.
 */
export function generateAutoLayout(project: Project, asic: AsicSpec | null): Rack[] {
  if (!asic) return [];
  const tmpl = defaultRackTemplate();
  const perShelf = asicsPerShelf({ ...tmpl, id: "_", name: "_", x: 0, y: 0, rotationDeg: 0, asicCount: 0, airflowToward: "south" }, asic);
  const perRack = perShelf * tmpl.shelves;
  if (perRack <= 0) return [];

  const target = Math.max(0, Math.floor(project.fleet.requestedCount));
  if (target <= 0) return [];

  const front = project.constraints.frontServiceClearanceM;
  const rear = project.constraints.rearServiceClearanceM;
  const aisle = project.constraints.minAisleM;
  const margin = 0.4;
  const room = roomAabb(project);
  const doors = project.openings.filter((o) => o.type === "DOOR").map((d) => doorSwingAabb(project, d)).filter(Boolean);

  const racks: Rack[] = [];
  let y = margin + front;
  let row = 0;
  let id = 1;
  let placed = 0;

  while (y + tmpl.depthM + margin <= project.room.depthM && placed < target) {
    const toward = row % 2 === 0 ? "south" : "north";
    let x = margin;
    while (x + tmpl.widthM + margin <= project.room.widthM && placed < target) {
      const remaining = target - placed;
      if (remaining <= 0) break;
      const candidate: Rack = {
        ...tmpl,
        id: nid("rack", id),
        name: `R${id}`,
        x,
        y,
        asicCount: 0,
        airflowToward: toward,
      };
      const bb = rackAabb(candidate);
      const hitsDoor = doors.some((d) => d && aabbOverlap(bb, d) > 0);
      const inside = aabbInside(bb, room);
      const hitsRack = racks.some((r) => aabbOverlap(bb, rackAabb(r)) > 0);
      if (inside && !hitsDoor && !hitsRack) {
        candidate.asicCount = Math.min(perRack, remaining);
        if (candidate.asicCount <= 0) break;
        placed += candidate.asicCount;
        racks.push(candidate);
        id += 1;
      }
      x += tmpl.widthM + 0.15;
    }
    // hot aisle between back-to-back rows, cold aisle between face-to-face
    if (row % 2 === 0) {
      y += tmpl.depthM + rear + rear; // back-to-back hot
    } else {
      y += tmpl.depthM + front + aisle; // face-to-face cold
    }
    row += 1;
    if (row > 20) break;
  }
  return racks;
}

export type AlignEdge = "left" | "right" | "top" | "bottom" | "centerX" | "centerY";

export function alignRacks(racks: Rack[], ids: string[], edge: AlignEdge): Rack[] {
  const sel = racks.filter((r) => ids.includes(r.id));
  if (sel.length < 2) return racks;
  const bbs = sel.map((r) => ({ r, bb: rackAabb(r) }));
  let target = 0;
  if (edge === "left") target = Math.min(...bbs.map((b) => b.bb.x1));
  if (edge === "right") target = Math.max(...bbs.map((b) => b.bb.x2));
  if (edge === "top") target = Math.max(...bbs.map((b) => b.bb.y2));
  if (edge === "bottom") target = Math.min(...bbs.map((b) => b.bb.y1));
  if (edge === "centerX") target = bbs.reduce((s, b) => s + (b.bb.x1 + b.bb.x2) / 2, 0) / bbs.length;
  if (edge === "centerY") target = bbs.reduce((s, b) => s + (b.bb.y1 + b.bb.y2) / 2, 0) / bbs.length;
  return racks.map((r) => {
    if (!ids.includes(r.id)) return r;
    const bb = rackAabb(r);
    const next = { ...r };
    if (edge === "left") next.x = target;
    if (edge === "right") next.x = target - (bb.x2 - bb.x1);
    if (edge === "bottom") next.y = target;
    if (edge === "top") next.y = target - (bb.y2 - bb.y1);
    if (edge === "centerX") next.x = target - (bb.x2 - bb.x1) / 2;
    if (edge === "centerY") next.y = target - (bb.y2 - bb.y1) / 2;
    return next;
  });
}

export function distributeRacks(racks: Rack[], ids: string[], axis: "x" | "y"): Rack[] {
  const sel = racks.filter((r) => ids.includes(r.id));
  if (sel.length < 3) return racks;
  const ordered = [...sel].sort((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const span = axis === "x" ? last.x - first.x : last.y - first.y;
  const step = span / (ordered.length - 1);
  const pos = new Map<string, number>();
  ordered.forEach((r, i) => pos.set(r.id, (axis === "x" ? first.x : first.y) + i * step));
  return racks.map((r) => {
    const p = pos.get(r.id);
    if (p == null) return r;
    return axis === "x" ? { ...r, x: p } : { ...r, y: p };
  });
}

export function rotateRack90(racks: Rack[], id: string): Rack[] {
  return racks.map((r) => {
    if (r.id !== id) return r;
    return { ...r, rotationDeg: (r.rotationDeg + 90) % 360 };
  });
}

/**
 * Collision-free rack id. Never Date.now()-only: same millisecond in one
 * logical operation must still yield distinct ids.
 */
export function uniqueRackId(existingIds: Iterable<string>, base: string): string {
  const taken = new Set(existingIds);
  const stem = `${base || "rack"}_copy`;
  if (!taken.has(stem)) return stem;
  for (let n = 2; n < 10000; n++) {
    const id = `${stem}${n}`;
    if (!taken.has(id)) return id;
  }
  return `${stem}_${taken.size}`;
}

export function duplicateRackOffset(racks: Rack[], id: string, dx?: number, dy = 0.2): Rack | null {
  const src = racks.find((r) => r.id === id);
  if (!src) return null;
  const bb = rackAabb(src);
  const shiftX = dx ?? bb.x2 - bb.x1 + 0.2;
  return {
    ...src,
    id: uniqueRackId(
      racks.map((r) => r.id),
      src.id,
    ),
    name: `${src.name}′`,
    x: src.x + shiftX,
    y: src.y + dy,
  };
}

