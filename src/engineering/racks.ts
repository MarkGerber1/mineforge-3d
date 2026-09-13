import type { AsicSpec, Project, Rack } from "./types.ts";
import { MAX_RACK_ASIC_COUNT } from "./constants.ts";
import {
  aabbInside,
  aabbOverlap,
  doorSwingAabb,
  rackAabb,
  roomAabb,
  type Aabb,
} from "./geometry.ts";
import {
  aabb3Intersects,
  asBuiltAabb3,
  exceedsCeiling,
  rackAabb3,
  roomEnvelope3,
} from "./aabb3.ts";

export function asicsPerShelf(rack: Rack, asic: AsicSpec, sideSpacingM = 0): number {
  const pitch = asic.widthM + sideSpacingM;
  if (pitch <= 0) return 0;
  if (asic.lengthM > rack.usableShelfDepthM + 1e-9) return 0;
  if (asic.heightM > rack.heightM + 1e-9) return 0;
  return Math.floor((rack.usableShelfWidthM + 1e-12) / pitch);
}

export function rackAsicCapacity(rack: Rack, asic: AsicSpec, sideSpacingM = 0): number {
  return asicsPerShelf(rack, asic, sideSpacingM) * rack.shelves;
}

export type AsicCountOk = { ok: true; count: number };
export type AsicCountErr = {
  ok: false;
  code: "BLANK" | "PARSE" | "NAN" | "INFINITY" | "NEGATIVE" | "FRACTION" | "MAX" | "CAPACITY";
  reason: string;
};
export type AsicCountResult = AsicCountOk | AsicCountErr;

export function validateRackAsicCount(count: number, perRackCapacity: number): AsicCountResult {
  if (Number.isNaN(count)) {
    return { ok: false, code: "NAN", reason: "Количество ASIC должно быть целым числом." };
  }
  if (!Number.isFinite(count)) {
    return { ok: false, code: "INFINITY", reason: "Количество ASIC должно быть конечным числом." };
  }
  if (count < 0) {
    return { ok: false, code: "NEGATIVE", reason: "Количество ASIC не может быть отрицательным." };
  }
  if (!Number.isInteger(count)) {
    return { ok: false, code: "FRACTION", reason: "Дробное количество ASIC недопустимо." };
  }
  if (count > MAX_RACK_ASIC_COUNT) {
    return { ok: false, code: "MAX", reason: `Количество ASIC не может превышать ${MAX_RACK_ASIC_COUNT}.` };
  }
  const cap = Math.max(0, Math.floor(perRackCapacity));
  if (count > cap) {
    return { ok: false, code: "CAPACITY", reason: `На стойке не больше ${cap} ASIC.` };
  }
  return { ok: true, count };
}

export function validateRackAsicCountInput(raw: string, perRackCapacity: number): AsicCountResult {
  if (!raw.trim()) {
    return { ok: false, code: "BLANK", reason: "Введите количество ASIC." };
  }
  const s = raw.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    return { ok: false, code: "PARSE", reason: "Количество ASIC должно быть целым числом." };
  }
  const n = Number(s);
  return validateRackAsicCount(n, perRackCapacity);
}

function oppositeToward(d: Rack["airflowToward"]): Rack["airflowToward"] {
  if (d === "north") return "south";
  if (d === "south") return "north";
  if (d === "east") return "west";
  return "east";
}

/** Intake-side clearance strip, not including the rack body. Empty if depth ≤ 0. */
export function frontServiceAabb(r: Rack, front: number): Aabb | null {
  return clearanceStrip(r, front, r.airflowToward);
}

/** Exhaust-side clearance strip, not including the rack body. Empty if depth ≤ 0. */
export function rearServiceAabb(r: Rack, rear: number): Aabb | null {
  return clearanceStrip(r, rear, oppositeToward(r.airflowToward));
}

function clearanceStrip(r: Rack, depth: number, toward: Rack["airflowToward"]): Aabb | null {
  if (!(depth > 0)) return null;
  const bb = rackAabb(r);
  switch (toward) {
    case "south":
      return { x1: bb.x1, y1: bb.y1 - depth, x2: bb.x2, y2: bb.y1 };
    case "north":
      return { x1: bb.x1, y1: bb.y2, x2: bb.x2, y2: bb.y2 + depth };
    case "west":
      return { x1: bb.x1 - depth, y1: bb.y1, x2: bb.x1, y2: bb.y2 };
    case "east":
      return { x1: bb.x2, y1: bb.y1, x2: bb.x2 + depth, y2: bb.y2 };
  }
}

export function serviceAabb(r: Rack, front: number, rear: number) {
  const bb = rackAabb(r);
  switch (r.airflowToward) {
    case "south":
      return { x1: bb.x1, y1: bb.y1 - front, x2: bb.x2, y2: bb.y2 + rear };
    case "north":
      return { x1: bb.x1, y1: bb.y1 - rear, x2: bb.x2, y2: bb.y2 + front };
    case "west":
      return { x1: bb.x1 - front, y1: bb.y1, x2: bb.x2 + rear, y2: bb.y2 };
    case "east":
      return { x1: bb.x1 - rear, y1: bb.y1, x2: bb.x2 + front, y2: bb.y2 };
  }
}

/**
 * Clear gap between intake faces of two opposing racks that look at each other
 * (projections overlap on the perpendicular axis). Null if they do not face.
 * Exact minAisleM is accepted (>=). Negative gap means faces have crossed.
 */
export function facingAisleGapM(a: Rack, b: Rack): number | null {
  if (oppositeToward(a.airflowToward) !== b.airflowToward) return null;
  const aa = rackAabb(a);
  const bb = rackAabb(b);
  const axis = a.airflowToward === "north" || a.airflowToward === "south" ? "y" : "x";
  if (axis === "y") {
    const ox = Math.min(aa.x2, bb.x2) - Math.max(aa.x1, bb.x1);
    if (ox <= 1e-9) return null;
    const aFront = a.airflowToward === "north" ? aa.y2 : aa.y1;
    const bFront = b.airflowToward === "north" ? bb.y2 : bb.y1;
    const southFront = a.airflowToward === "north" ? aFront : bFront;
    const northFront = a.airflowToward === "north" ? bFront : aFront;
    return northFront - southFront;
  }
  const oy = Math.min(aa.y2, bb.y2) - Math.max(aa.y1, bb.y1);
  if (oy <= 1e-9) return null;
  const aFront = a.airflowToward === "east" ? aa.x2 : aa.x1;
  const bFront = b.airflowToward === "east" ? bb.x2 : bb.x1;
  const westFront = a.airflowToward === "east" ? aFront : bFront;
  const eastFront = a.airflowToward === "east" ? bFront : aFront;
  return eastFront - westFront;
}

export function analyzeRacks(project: Project, asic: AsicSpec | null) {
  const envelope = roomEnvelope3(project);
  const ceilingHits: Array<{ id: string; reason: string }> = [];
  const perRackCapacity = project.racks.map((r) => {
    if (!asic) return { id: r.id, perShelf: 0, total: 0, blocked: false };
    const perShelf = asicsPerShelf(r, asic);
    const box = rackAabb3(r);
    const overCeil = exceedsCeiling(box, envelope.z2);

    if (overCeil) {
      ceilingHits.push({
        id: r.id,
        reason: `${r.name} top ${(r.heightM).toFixed(3)} m exceeds ceiling ${envelope.z2.toFixed(3)} m.`,
      });
    }
    return { id: r.id, perShelf, total: perShelf * r.shelves, blocked: false };
  });

  const collisions: Array<{ a: string; b: string; overlapM: number; reason: string }> = [];
  for (let i = 0; i < project.racks.length; i++) {
    for (let j = i + 1; j < project.racks.length; j++) {
      const a = project.racks[i];
      const b = project.racks[j];
      if (!aabb3Intersects(rackAabb3(a), rackAabb3(b))) continue;
      const o = aabbOverlap(rackAabb(a), rackAabb(b));
      collisions.push({
        a: a.id,
        b: b.id,
        overlapM: o,
        reason: `${a.name} overlaps ${b.name} in XYZ.`,
      });
    }
  }

  const room = roomAabb(project);
  const wallHits: Array<{ id: string; reason: string }> = [];
  for (const r of project.racks) {
    const bb = rackAabb(r);
    if (!aabbInside(bb, room)) {
      wallHits.push({ id: r.id, reason: `${r.name} intersects a wall or sits outside the room.` });
    }
  }

  const doorHits: Array<{ id: string; reason: string }> = [];
  for (const door of project.openings.filter((o) => o.type === "DOOR")) {
    const swing = doorSwingAabb(project, door);
    if (!swing) continue;
    for (const r of project.racks) {
      const o = aabbOverlap(rackAabb(r), swing);
      if (o > 0) {
        doorHits.push({
          id: r.id,
          reason: `${r.name} overlaps door swing of ${door.name ?? door.id} by ${(o * 1000).toFixed(0)} mm.`,
        });
      }
    }
  }

  const recirculation: Array<{ from: string; to: string; distanceM: number }> = [];
  const exhaustGap = 0.6;
  for (const a of project.racks) {
    for (const b of project.racks) {
      if (a.id === b.id) continue;
      if (facesOpposing(a, b)) {
        const d = exhaustToIntakeDistance(a, b);
        if (d >= 0 && d < exhaustGap) {
          recirculation.push({ from: a.id, to: b.id, distanceM: d });
        }
      }
    }
  }

  const placedAsics = project.racks.reduce((s, r) => s + r.asicCount, 0);

  const asBuiltHits: Array<{ id: string; objectId: string; reason: string }> = [];
  for (const obj of project.reality?.asBuilt ?? []) {
    const ob = asBuiltAabb3(obj);
    if (exceedsCeiling(ob, envelope.z2)) {
      ceilingHits.push({
        id: obj.id,
        reason: `As-built ${obj.kind} «${obj.name}» exceeds ceiling ${envelope.z2.toFixed(3)} m.`,
      });
    }
    for (const r of project.racks) {
      if (!aabb3Intersects(rackAabb3(r), ob)) continue;
      asBuiltHits.push({
        id: r.id,
        objectId: obj.id,
        reason: `${r.name} collides in XYZ with as-built ${obj.kind} «${obj.name}».`,
      });
    }
  }

  const front = project.constraints.frontServiceClearanceM;
  const rear = project.constraints.rearServiceClearanceM;
  const aisle = project.constraints.minAisleM;
  const clearanceHits: Array<{ id: string; reason: string }> = [];

  for (const r of project.racks) {
    const fBox = frontServiceAabb(r, front);
    if (fBox && !aabbInside(fBox, room)) {
      clearanceHits.push({
        id: r.id,
        reason: `${r.name} front service ${front.toFixed(3)} m is not accessible inside the room.`,
      });
    }
    const rBox = rearServiceAabb(r, rear);
    if (rBox && !aabbInside(rBox, room)) {
      clearanceHits.push({
        id: r.id,
        reason: `${r.name} rear service ${rear.toFixed(3)} m is not accessible inside the room.`,
      });
    }
  }

  for (let i = 0; i < project.racks.length; i++) {
    for (let j = i + 1; j < project.racks.length; j++) {
      const a = project.racks[i];
      const b = project.racks[j];
      const aBody = rackAabb(a);
      const bBody = rackAabb(b);
      const aFront = frontServiceAabb(a, front);
      const bFront = frontServiceAabb(b, front);
      const aRear = rearServiceAabb(a, rear);
      const bRear = rearServiceAabb(b, rear);
      if (aFront && aabbOverlap(aFront, bBody) > 0) {
        clearanceHits.push({
          id: a.id,
          reason: `${a.name} front service collides with ${b.name}.`,
        });
      }
      if (bFront && aabbOverlap(bFront, aBody) > 0) {
        clearanceHits.push({
          id: b.id,
          reason: `${b.name} front service collides with ${a.name}.`,
        });
      }
      if (aRear && aabbOverlap(aRear, bBody) > 0) {
        clearanceHits.push({
          id: a.id,
          reason: `${a.name} rear service collides with ${b.name}.`,
        });
      }
      if (bRear && aabbOverlap(bRear, aBody) > 0) {
        clearanceHits.push({
          id: b.id,
          reason: `${b.name} rear service collides with ${a.name}.`,
        });
      }
      const gap = facingAisleGapM(a, b);
      if (gap != null && gap + 1e-9 < aisle) {
        clearanceHits.push({
          id: a.id,
          reason: `Aisle ${gap.toFixed(3)} m between ${a.name} and ${b.name} is below min ${aisle.toFixed(3)} m.`,
        });
        clearanceHits.push({
          id: b.id,
          reason: `Aisle ${gap.toFixed(3)} m between ${b.name} and ${a.name} is below min ${aisle.toFixed(3)} m.`,
        });
      }
    }
  }

  const blocked = new Set<string>([
    ...asBuiltHits.map((h) => h.id),
    ...ceilingHits.filter((h) => project.racks.some((r) => r.id === h.id)).map((h) => h.id),
    ...collisions.flatMap((c) => [c.a, c.b]),
    ...wallHits.map((h) => h.id),
    ...doorHits.map((h) => h.id),
    ...clearanceHits.map((h) => h.id),
  ]);
  for (const row of perRackCapacity) {
    if (blocked.has(row.id)) row.blocked = true;
  }

  const totalCapacity = perRackCapacity.reduce((s, x) => s + x.total, 0);
  const usableCapacity = perRackCapacity.reduce((s, x) => s + (x.blocked ? 0 : x.total), 0);

  return {
    perRackCapacity,
    totalCapacity,
    usableCapacity,
    collisions,
    wallHits,
    doorHits,
    ceilingHits,
    clearanceHits,
    recirculation,
    placedAsics,
    asBuiltHits,
  };
}

function facesOpposing(a: Rack, b: Rack): boolean {
  const opp: Record<Rack["airflowToward"], Rack["airflowToward"]> = {
    north: "south",
    south: "north",
    east: "west",
    west: "east",
  };
  return opp[a.airflowToward] === b.airflowToward;
}

function exhaustToIntakeDistance(a: Rack, b: Rack): number {
  const aa = rackAabb(a);
  const bb = rackAabb(b);
  switch (a.airflowToward) {
    case "north":
      return bb.y1 - aa.y2;
    case "south":
      return aa.y1 - bb.y2;
    case "east":
      return bb.x1 - aa.x2;
    case "west":
      return aa.x1 - bb.x2;
  }
}
