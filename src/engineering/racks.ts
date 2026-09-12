import type { AsicSpec, Project, Rack } from "./types.ts";
import {
  aabbInside,
  aabbOverlap,
  doorSwingAabb,
  rackAabb,
  roomAabb,
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

  const blocked = new Set<string>([
    ...asBuiltHits.map((h) => h.id),
    ...ceilingHits.filter((h) => project.racks.some((r) => r.id === h.id)).map((h) => h.id),
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
