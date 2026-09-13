import { defaultRackTemplate } from "./layout.ts";
import { analyzeRacks, rackAsicCapacity } from "./racks.ts";
import type { AsicSpec, Project, Rack } from "./types.ts";

export interface FeasibleSpacePacking {
  asicCount: number;
  rackCount: number;
  racks: Rack[];
  orientationDeg: 0 | 90;
}

const SIDE_GAP = 0.1;
const EPS = 1e-9;

type Tmpl = ReturnType<typeof defaultRackTemplate>;

function emptyPack(rot: 0 | 90 = 0): FeasibleSpacePacking {
  return { asicCount: 0, rackCount: 0, racks: [], orientationDeg: rot };
}

function aabbSize(tmpl: Tmpl, rot: 0 | 90): { alongX: number; alongY: number } {
  if (rot === 90) return { alongX: tmpl.depthM, alongY: tmpl.widthM };
  return { alongX: tmpl.widthM, alongY: tmpl.depthM };
}

function mkRack(
  tmpl: Tmpl,
  id: string,
  x: number,
  y: number,
  toward: Rack["airflowToward"],
  rot: 0 | 90,
): Rack {
  return {
    ...tmpl,
    id,
    name: id,
    x,
    y,
    rotationDeg: rot,
    asicCount: 0,
    airflowToward: toward,
  };
}

function fillAlongX(
  tmpl: Tmpl,
  rot: 0 | 90,
  roomW: number,
  y: number,
  toward: Rack["airflowToward"],
  prefix: string,
): Rack[] {
  const { alongX } = aabbSize(tmpl, rot);
  if (alongX <= 0) return [];
  const out: Rack[] = [];
  let x = 0;
  let i = 0;
  while (x + alongX <= roomW + EPS) {
    out.push(mkRack(tmpl, `${prefix}_${i}`, x, y, toward, rot));
    x += alongX + SIDE_GAP;
    i += 1;
    if (i > 400) break;
  }
  return out;
}

function fillAlongY(
  tmpl: Tmpl,
  rot: 0 | 90,
  roomD: number,
  x: number,
  toward: Rack["airflowToward"],
  prefix: string,
): Rack[] {
  const { alongY } = aabbSize(tmpl, rot);
  if (alongY <= 0) return [];
  const out: Rack[] = [];
  let y = 0;
  let i = 0;
  while (y + alongY <= roomD + EPS) {
    out.push(mkRack(tmpl, `${prefix}_${i}`, x, y, toward, rot));
    y += alongY + SIDE_GAP;
    i += 1;
    if (i > 400) break;
  }
  return out;
}

function evaluate(
  project: Project,
  asic: AsicSpec,
  racks: Rack[],
  rot: 0 | 90,
): FeasibleSpacePacking {
  if (!racks.length) return emptyPack(rot);
  const first = analyzeRacks({ ...project, racks }, asic);
  const blocked = new Set(first.perRackCapacity.filter((x) => x.blocked).map((x) => x.id));
  const kept = racks.filter((r) => !blocked.has(r.id));
  if (!kept.length) return emptyPack(rot);
  if (kept.length === racks.length) {
    return { asicCount: first.usableCapacity, rackCount: racks.length, racks, orientationDeg: rot };
  }
  const second = analyzeRacks({ ...project, racks: kept }, asic);
  const blocked2 = new Set(second.perRackCapacity.filter((x) => x.blocked).map((x) => x.id));
  const final = kept.filter((r) => !blocked2.has(r.id));
  return {
    asicCount: second.usableCapacity,
    rackCount: final.length,
    racks: final,
    orientationDeg: rot,
  };
}

function packSameDirNS(
  project: Project,
  asic: AsicSpec,
  tmpl: Tmpl,
  rot: 0 | 90,
  toward: "north" | "south",
): FeasibleSpacePacking {
  const { alongY } = aabbSize(tmpl, rot);
  const front = Math.max(0, project.constraints.frontServiceClearanceM);
  const rear = Math.max(0, project.constraints.rearServiceClearanceM);
  const roomW = project.room.widthM;
  const roomD = project.room.depthM;
  const pitch = alongY + Math.max(front, rear);
  const racks: Rack[] = [];
  if (toward === "south") {
    let y = front;
    let row = 0;
    while (y + alongY + rear <= roomD + EPS) {
      racks.push(...fillAlongX(tmpl, rot, roomW, y, "south", `ss${rot}_${row}`));
      y += pitch;
      row += 1;
      if (row > 80) break;
    }
  } else {
    let y = roomD - front - alongY;
    let row = 0;
    while (y + EPS >= rear) {
      racks.push(...fillAlongX(tmpl, rot, roomW, y, "north", `sn${rot}_${row}`));
      y -= pitch;
      row += 1;
      if (row > 80) break;
    }
  }
  return evaluate(project, asic, racks, rot);
}

function packSameDirEW(
  project: Project,
  asic: AsicSpec,
  tmpl: Tmpl,
  rot: 0 | 90,
  toward: "east" | "west",
): FeasibleSpacePacking {
  const { alongX } = aabbSize(tmpl, rot);
  const front = Math.max(0, project.constraints.frontServiceClearanceM);
  const rear = Math.max(0, project.constraints.rearServiceClearanceM);
  const roomW = project.room.widthM;
  const roomD = project.room.depthM;
  const pitch = alongX + Math.max(front, rear);
  const racks: Rack[] = [];
  if (toward === "west") {
    let x = front;
    let col = 0;
    while (x + alongX + rear <= roomW + EPS) {
      racks.push(...fillAlongY(tmpl, rot, roomD, x, "west", `sw${rot}_${col}`));
      x += pitch;
      col += 1;
      if (col > 80) break;
    }
  } else {
    let x = roomW - front - alongX;
    let col = 0;
    while (x + EPS >= rear) {
      racks.push(...fillAlongY(tmpl, rot, roomD, x, "east", `se${rot}_${col}`));
      x -= pitch;
      col += 1;
      if (col > 80) break;
    }
  }
  return evaluate(project, asic, racks, rot);
}

function packFacingNS(project: Project, asic: AsicSpec, tmpl: Tmpl, rot: 0 | 90): FeasibleSpacePacking {
  const { alongY } = aabbSize(tmpl, rot);
  const front = Math.max(0, project.constraints.frontServiceClearanceM);
  const rear = Math.max(0, project.constraints.rearServiceClearanceM);
  const aisle = Math.max(0, project.constraints.minAisleM);
  const gap = Math.max(aisle, front);
  const roomW = project.room.widthM;
  const roomD = project.room.depthM;
  const racks: Rack[] = [];
  let y = rear;
  let pair = 0;
  while (y + alongY + gap + alongY + rear <= roomD + EPS) {
    racks.push(...fillAlongX(tmpl, rot, roomW, y, "north", `fn${rot}_${pair}`));
    const ySouth = y + alongY + gap;
    racks.push(...fillAlongX(tmpl, rot, roomW, ySouth, "south", `fs${rot}_${pair}`));
    y = ySouth + alongY + rear + rear;
    pair += 1;
    if (pair > 40) break;
  }
  return evaluate(project, asic, racks, rot);
}

function packFacingEW(project: Project, asic: AsicSpec, tmpl: Tmpl, rot: 0 | 90): FeasibleSpacePacking {
  const { alongX } = aabbSize(tmpl, rot);
  const front = Math.max(0, project.constraints.frontServiceClearanceM);
  const rear = Math.max(0, project.constraints.rearServiceClearanceM);
  const aisle = Math.max(0, project.constraints.minAisleM);
  const gap = Math.max(aisle, front);
  const roomW = project.room.widthM;
  const roomD = project.room.depthM;
  const racks: Rack[] = [];
  let x = rear;
  let pair = 0;
  while (x + alongX + gap + alongX + rear <= roomW + EPS) {
    racks.push(...fillAlongY(tmpl, rot, roomD, x, "east", `fe${rot}_${pair}`));
    const xWest = x + alongX + gap;
    racks.push(...fillAlongY(tmpl, rot, roomD, xWest, "west", `fw${rot}_${pair}`));
    x = xWest + alongX + rear + rear;
    pair += 1;
    if (pair > 40) break;
  }
  return evaluate(project, asic, racks, rot);
}

function packBackToBackNS(project: Project, asic: AsicSpec, tmpl: Tmpl, rot: 0 | 90): FeasibleSpacePacking {
  const { alongY } = aabbSize(tmpl, rot);
  const front = Math.max(0, project.constraints.frontServiceClearanceM);
  const rear = Math.max(0, project.constraints.rearServiceClearanceM);
  const aisle = Math.max(0, project.constraints.minAisleM);
  const roomW = project.room.widthM;
  const roomD = project.room.depthM;
  const racks: Rack[] = [];
  let y = front;
  let n = 0;
  while (y + alongY + rear + alongY + front <= roomD + EPS) {
    racks.push(...fillAlongX(tmpl, rot, roomW, y, "south", `bs${rot}_${n}`));
    const yN = y + alongY + rear;
    racks.push(...fillAlongX(tmpl, rot, roomW, yN, "north", `bn${rot}_${n}`));
    y = yN + alongY + Math.max(aisle, front);
    n += 1;
    if (n > 40) break;
  }
  return evaluate(project, asic, racks, rot);
}

/**
 * Conservative deterministic rectangular packing. Every counted rack has a
 * body + required service envelope that analyzeRacks() accepts.
 */
export function feasibleSpacePacking(
  project: Project,
  asic: AsicSpec | null,
  tmpl: Tmpl = defaultRackTemplate(),
): FeasibleSpacePacking {
  if (!asic) return emptyPack();
  const dummy: Rack = {
    ...tmpl,
    id: "tmpl",
    name: "tmpl",
    x: 0,
    y: 0,
    rotationDeg: 0,
    asicCount: 0,
    airflowToward: "south",
  };
  if (rackAsicCapacity(dummy, asic) <= 0) return emptyPack();

  const candidates: FeasibleSpacePacking[] = [];
  for (const rot of [0, 90] as const) {
    candidates.push(packSameDirNS(project, asic, tmpl, rot, "south"));
    candidates.push(packSameDirNS(project, asic, tmpl, rot, "north"));
    candidates.push(packSameDirEW(project, asic, tmpl, rot, "west"));
    candidates.push(packSameDirEW(project, asic, tmpl, rot, "east"));
    candidates.push(packFacingNS(project, asic, tmpl, rot));
    candidates.push(packFacingEW(project, asic, tmpl, rot));
    candidates.push(packBackToBackNS(project, asic, tmpl, rot));
  }
  candidates.sort((a, b) => b.asicCount - a.asicCount || b.rackCount - a.rackCount);
  return candidates[0] ?? emptyPack();
}
