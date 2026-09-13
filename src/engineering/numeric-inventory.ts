/**
 * QX-02B-R5 complete numeric inventory.
 *
 * Every numeric field that can appear on canonical Project is classified.
 * SAFETY_DRIVING / SAFETY_GEOMETRY are enforced by validateCanonicalProjectDomains.
 * NON_SAFETY_METADATA is documented so the completeness walker does not treat
 * it as an unclassified safety hole.
 *
 * Classification is test-visible: DOMAIN-INV-01 walks a fully populated Project
 * and requires every numeric path to match an entry here.
 */
import type { AsicSpec, Project } from "./types.ts";
import { TEST_ASIC_A } from "../equipment/asic-catalog.ts";
import { undergroundParkingFarm } from "../project/factory.ts";

export type NumericClass = "SAFETY_DRIVING" | "SAFETY_GEOMETRY" | "NON_SAFETY_METADATA";

export interface NumericInventoryEntry {
  path: string;
  class: NumericClass;
  rule: string;
  /** Documented invalid sample used by the table-driven contract test. */
  invalid: number;
}

export const SAFETY_NUMERIC_INVENTORY: NumericInventoryEntry[] = [
  // Room
  { path: "room.widthM", class: "SAFETY_DRIVING", rule: "finite; MIN_ROOM_DIM_M…MAX_ROOM_DIM_M", invalid: 0 },
  { path: "room.depthM", class: "SAFETY_DRIVING", rule: "finite; MIN_ROOM_DIM_M…MAX_ROOM_DIM_M", invalid: 0 },
  { path: "room.heightM", class: "SAFETY_DRIVING", rule: "finite; MIN_ROOM_DIM_M…MAX_ROOM_HEIGHT_M", invalid: 0.2 },
  { path: "room.wallThicknessM", class: "SAFETY_GEOMETRY", rule: "finite; > 0; ≤ MAX_ROOM_DIM_M", invalid: 0 },

  // Openings — primitives; spatial wall-fit remains validateOpening
  { path: "openings[].widthM", class: "SAFETY_DRIVING", rule: "finite; spatial >0 remains validateOpening", invalid: Number.NaN },
  { path: "openings[].heightM", class: "SAFETY_DRIVING", rule: "finite; spatial >0 remains validateOpening", invalid: Number.NaN },
  { path: "openings[].bottomElevationM", class: "SAFETY_GEOMETRY", rule: "finite", invalid: Number.NaN },
  { path: "openings[].offsetFromWallStartM", class: "SAFETY_GEOMETRY", rule: "finite", invalid: Number.POSITIVE_INFINITY },

  // Electrical
  { path: "electrical.availablePowerW", class: "SAFETY_DRIVING", rule: "finite; when known: MIN…MAX_AVAILABLE_POWER_W", invalid: 11_250_000 },
  { path: "electrical.voltageV", class: "SAFETY_DRIVING", rule: "finite; > 0", invalid: 0 },
  { path: "electrical.frequencyHz", class: "SAFETY_DRIVING", rule: "finite; > 0", invalid: -50 },
  { path: "electrical.phases", class: "NON_SAFETY_METADATA", rule: "literal 3 (schema)", invalid: 1 },
  { path: "electrical.reservePct", class: "SAFETY_DRIVING", rule: "finite; 0…90; no silent clamp", invalid: 91 },
  { path: "electrical.auxiliaryW", class: "SAFETY_DRIVING", rule: "finite; ≥ 0", invalid: -1_000_000 },
  { path: "electrical.lightingW", class: "SAFETY_DRIVING", rule: "finite; ≥ 0", invalid: -1 },
  { path: "electrical.networkW", class: "SAFETY_DRIVING", rule: "finite; ≥ 0", invalid: -1 },

  // Thermal
  { path: "thermal.deltaTK", class: "SAFETY_DRIVING", rule: "finite; MIN_DELTA_T_K…MAX_DELTA_T_K", invalid: 100 },
  { path: "thermal.outdoorTempC", class: "NON_SAFETY_METADATA", rule: "finite (visual / failure overlay; not in Q=P/(ρCpΔT))", invalid: Number.NaN },
  { path: "thermal.intakeTempC", class: "NON_SAFETY_METADATA", rule: "finite (visual Twin3D; not in SAFE)", invalid: Number.POSITIVE_INFINITY },

  { path: "ventilation.outdoorTempC", class: "NON_SAFETY_METADATA", rule: "finite; unused by pressure / SAFE", invalid: Number.NaN },
  { path: "ventilation.dirtyFilterExtraPa", class: "SAFETY_DRIVING", rule: "finite; ≥ 0 (dirty filter must never improve duty)", invalid: -200 },
  { path: "ventilation.components[].lengthM", class: "SAFETY_DRIVING", rule: "finite; ≥ 0; ≤ MAX_SHAFT_LENGTH_M", invalid: -10 },
  { path: "ventilation.components[].frictionFactor", class: "SAFETY_DRIVING", rule: "finite; ≥ 0", invalid: -1 },
  { path: "ventilation.components[].kLocal", class: "SAFETY_DRIVING", rule: "finite; ≥ 0", invalid: -1 },
  { path: "ventilation.components[].extraPressurePa", class: "SAFETY_DRIVING", rule: "finite; ≥ 0", invalid: -500 },
  { path: "ventilation.components[].widthM", class: "SAFETY_DRIVING", rule: "rect: finite > 0 when required", invalid: 0 },
  { path: "ventilation.components[].heightM", class: "SAFETY_DRIVING", rule: "rect: finite > 0 when required", invalid: 0 },
  { path: "ventilation.components[].diameterM", class: "SAFETY_DRIVING", rule: "round: finite > 0 when required", invalid: 0 },

  // Fleet / requested
  { path: "fleet.requestedCount", class: "SAFETY_DRIVING", rule: "finite integer ≥ 0", invalid: -1 },

  // Imported ASIC (Engineering source when fleet.imported.id === asicId)
  { path: "fleet.imported.hashrateThs", class: "SAFETY_DRIVING", rule: "finite; ≥ 0", invalid: -1 },
  { path: "fleet.imported.typicalPowerW", class: "SAFETY_DRIVING", rule: "finite; > 0", invalid: 0 },
  { path: "fleet.imported.designPowerW", class: "SAFETY_DRIVING", rule: "finite; > 0; ≥ typicalPowerW", invalid: -1 },
  { path: "fleet.imported.voltageMin", class: "SAFETY_DRIVING", rule: "finite; > 0; ≤ voltageMax", invalid: -230 },
  { path: "fleet.imported.voltageMax", class: "SAFETY_DRIVING", rule: "finite; > 0; ≥ voltageMin", invalid: 0 },
  { path: "fleet.imported.currentA", class: "SAFETY_DRIVING", rule: "if present: finite; ≥ 0", invalid: -1 },
  { path: "fleet.imported.widthM", class: "SAFETY_DRIVING", rule: "finite; > 0 (rack packing)", invalid: 0 },
  { path: "fleet.imported.heightM", class: "SAFETY_DRIVING", rule: "finite; > 0", invalid: 0 },
  { path: "fleet.imported.lengthM", class: "SAFETY_DRIVING", rule: "finite; > 0", invalid: -0.4 },
  { path: "fleet.imported.weightKg", class: "SAFETY_DRIVING", rule: "finite; > 0", invalid: 0 },
  { path: "fleet.imported.manufacturerAirflowM3h", class: "SAFETY_DRIVING", rule: "if present: finite; ≥ 0", invalid: -1 },
  { path: "fleet.imported.noiseDba", class: "NON_SAFETY_METADATA", rule: "if present: finite (acoustic only)", invalid: Number.NaN },

  // Racks
  { path: "racks[].x", class: "SAFETY_GEOMETRY", rule: "finite", invalid: Number.NaN },
  { path: "racks[].y", class: "SAFETY_GEOMETRY", rule: "finite", invalid: Number.POSITIVE_INFINITY },
  { path: "racks[].widthM", class: "SAFETY_DRIVING", rule: "finite; > 0; ≤ MAX_ROOM_DIM_M", invalid: 0 },
  { path: "racks[].depthM", class: "SAFETY_DRIVING", rule: "finite; > 0; ≤ MAX_ROOM_DIM_M", invalid: -0.6 },
  { path: "racks[].heightM", class: "SAFETY_DRIVING", rule: "finite; > 0; ≤ MAX_ROOM_HEIGHT_M", invalid: 0 },
  { path: "racks[].rotationDeg", class: "SAFETY_DRIVING", rule: "0 | 90 | 180 | 270", invalid: 45 },
  { path: "racks[].shelves", class: "SAFETY_DRIVING", rule: "finite integer; 1…MAX_RACK_SHELVES", invalid: 3.7 },
  { path: "racks[].usableShelfWidthM", class: "SAFETY_DRIVING", rule: "finite; > 0; ≤ rack widthM", invalid: 0 },
  { path: "racks[].usableShelfDepthM", class: "SAFETY_DRIVING", rule: "finite; > 0; ≤ rack depthM", invalid: 10 },
  { path: "racks[].asicCount", class: "SAFETY_DRIVING", rule: "finite integer; 0…per-rack / MAX_RACK_ASIC_COUNT", invalid: -1 },

  // Fans
  { path: "fans[].x", class: "SAFETY_GEOMETRY", rule: "finite (spatial validity remains QX-02A/B)", invalid: Number.NaN },
  { path: "fans[].y", class: "SAFETY_GEOMETRY", rule: "finite", invalid: Number.NEGATIVE_INFINITY },
  { path: "fans[].count", class: "SAFETY_DRIVING", rule: "finite integer; MIN_FAN_GROUP_COUNT…MAX_FAN_GROUP_COUNT", invalid: 0 },

  // Constraints
  { path: "constraints.frontServiceClearanceM", class: "SAFETY_DRIVING", rule: "finite; ≥ 0", invalid: -1 },
  { path: "constraints.rearServiceClearanceM", class: "SAFETY_DRIVING", rule: "finite; ≥ 0", invalid: -1 },
  { path: "constraints.minAisleM", class: "SAFETY_DRIVING", rule: "finite; ≥ 0", invalid: -1 },
  { path: "constraints.maxFloorLoadPa", class: "SAFETY_DRIVING", rule: "if floorLoadingUnknown=false: required finite > 0; net payload Pa. If unknown: optional", invalid: 0 },

  // As-built — collision geometry
  { path: "reality.asBuilt[].x", class: "SAFETY_GEOMETRY", rule: "finite", invalid: Number.NaN },
  { path: "reality.asBuilt[].y", class: "SAFETY_GEOMETRY", rule: "finite", invalid: Number.POSITIVE_INFINITY },
  { path: "reality.asBuilt[].z", class: "SAFETY_GEOMETRY", rule: "finite", invalid: Number.NaN },
  { path: "reality.asBuilt[].widthM", class: "SAFETY_GEOMETRY", rule: "finite; > 0", invalid: 0 },
  { path: "reality.asBuilt[].heightM", class: "SAFETY_GEOMETRY", rule: "finite; > 0", invalid: -1 },
  { path: "reality.asBuilt[].depthM", class: "SAFETY_GEOMETRY", rule: "finite; > 0", invalid: 0 },

  // Metadata / Reality evidence (not Engineering until ADD copies into asBuilt/openings)
  { path: "schemaVersion", class: "NON_SAFETY_METADATA", rule: "literal 1", invalid: 2 },
  { path: "createdAt", class: "NON_SAFETY_METADATA", rule: "timestamp", invalid: Number.NaN },
  { path: "updatedAt", class: "NON_SAFETY_METADATA", rule: "timestamp", invalid: Number.NaN },
  { path: "reality.photos[].createdAt", class: "NON_SAFETY_METADATA", rule: "timestamp", invalid: Number.NaN },
  { path: "reality.photos[].widthPx", class: "NON_SAFETY_METADATA", rule: "pixel metadata", invalid: -1 },
  { path: "reality.photos[].heightPx", class: "NON_SAFETY_METADATA", rule: "pixel metadata", invalid: -1 },
  { path: "reality.photos[].timestampMs", class: "NON_SAFETY_METADATA", rule: "video-frame timestamp", invalid: -1 },
  { path: "reality.photos[].calibration.scaleMPerPx", class: "NON_SAFETY_METADATA", rule: "photo scale; ADD copies geometry", invalid: Number.NaN },
  { path: "reality.photos[].calibration.lengthM", class: "NON_SAFETY_METADATA", rule: "known A–B length", invalid: Number.NaN },
  { path: "reality.photos[].markers[].nx", class: "NON_SAFETY_METADATA", rule: "normalized photo coords", invalid: Number.NaN },
  { path: "reality.photos[].markers[].ny", class: "NON_SAFETY_METADATA", rule: "normalized photo coords", invalid: Number.NaN },
  { path: "reality.photos[].markers[].lengthM", class: "NON_SAFETY_METADATA", rule: "optional marker length", invalid: Number.NaN },
  { path: "reality.videos[].createdAt", class: "NON_SAFETY_METADATA", rule: "timestamp", invalid: Number.NaN },
  { path: "reality.videos[].durationMs", class: "NON_SAFETY_METADATA", rule: "media duration", invalid: Number.NaN },
  { path: "reality.videos[].widthPx", class: "NON_SAFETY_METADATA", rule: "pixel metadata", invalid: Number.NaN },
  { path: "reality.videos[].heightPx", class: "NON_SAFETY_METADATA", rule: "pixel metadata", invalid: Number.NaN },
  { path: "reality.findings[].estimated.x", class: "NON_SAFETY_METADATA", rule: "PENDING until ADD", invalid: Number.NaN },
  { path: "reality.findings[].estimated.y", class: "NON_SAFETY_METADATA", rule: "PENDING until ADD", invalid: Number.NaN },
  { path: "reality.findings[].estimated.z", class: "NON_SAFETY_METADATA", rule: "PENDING until ADD", invalid: Number.NaN },
  { path: "reality.findings[].estimated.widthM", class: "NON_SAFETY_METADATA", rule: "PENDING until ADD", invalid: 0 },
  { path: "reality.findings[].estimated.heightM", class: "NON_SAFETY_METADATA", rule: "PENDING until ADD", invalid: 0 },
  { path: "reality.findings[].estimated.depthM", class: "NON_SAFETY_METADATA", rule: "PENDING until ADD", invalid: 0 },
  { path: "reality.findings[].opening.widthM", class: "NON_SAFETY_METADATA", rule: "PENDING until ADD", invalid: 0 },
  { path: "reality.findings[].opening.heightM", class: "NON_SAFETY_METADATA", rule: "PENDING until ADD", invalid: 0 },
  { path: "reality.findings[].opening.bottomElevationM", class: "NON_SAFETY_METADATA", rule: "PENDING until ADD", invalid: Number.NaN },
  { path: "reality.findings[].opening.offsetFromWallStartM", class: "NON_SAFETY_METADATA", rule: "PENDING until ADD", invalid: Number.NaN },
  { path: "reality.findings[].wallResize.lengthM", class: "NON_SAFETY_METADATA", rule: "PENDING until ADD", invalid: 0 },
];

export const SAFETY_DRIVING_PATHS = SAFETY_NUMERIC_INVENTORY.filter((e) => e.class === "SAFETY_DRIVING").map((e) => e.path);
export const SAFETY_GEOMETRY_PATHS = SAFETY_NUMERIC_INVENTORY.filter((e) => e.class === "SAFETY_GEOMETRY").map((e) => e.path);

export function normalizeNumericPath(path: string): string {
  return path.replace(/\[\d+\]/g, "[]");
}

export function collectNumericPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "number") return prefix ? [prefix] : [];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => collectNumericPaths(v, `${prefix}[${i}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      collectNumericPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [];
}

export function inventoryClassForPath(path: string): NumericClass | undefined {
  const n = normalizeNumericPath(path);
  return SAFETY_NUMERIC_INVENTORY.find((e) => e.path === n)?.class;
}

function importedAsic(): AsicSpec {
  return structuredClone(TEST_ASIC_A);
}

/**
 * Fully populated Project used only by DOMAIN-INV-01 so optional numeric
 * branches (imported ASIC, as-built, round duct, photos, findings) appear.
 */
export function inventoryCompletenessFixture(): Project {
  const p = undergroundParkingFarm();
  p.constraints.floorLoadingUnknown = false;
  p.constraints.maxFloorLoadPa = 10_000;
  p.fleet.imported = importedAsic();
  p.fleet.imported.noiseDba = 70;
  p.fleet.asicId = TEST_ASIC_A.id;
  p.fleet.requestedCount = 0;
  for (const r of p.racks) r.asicCount = 0;
  p.ventilation.components.push({
    id: "comp_round",
    kind: "duct",
    name: "Round spur",
    shape: "round",
    diameterM: 0.4,
    lengthM: 2,
    frictionFactor: 0.02,
    kLocal: 0,
    extraPressurePa: 0,
  });
  p.reality = p.reality ?? {
    photos: [],
    videos: [],
    findings: [],
    asBuilt: [],
    compareMode: "as-designed",
    interview: [],
  };
  p.reality.asBuilt = [
    {
      id: "ab1",
      kind: "beam",
      name: "Beam",
      x: 1,
      y: 1,
      z: 2.3,
      widthM: 0.3,
      heightM: 0.3,
      depthM: 4,
      provenance: "USER_CONFIRMED",
      confidence: "HIGH",
    },
  ];
  p.reality.photos = [
    {
      id: "ph1",
      name: "wall.jpg",
      mime: "image/jpeg",
      createdAt: p.createdAt,
      notes: "",
      widthPx: 4000,
      heightPx: 3000,
      timestampMs: 0,
      calibration: {
        scaleMPerPx: 0.002,
        lengthM: 1,
        aId: "m1",
        bId: "m2",
        provenance: "USER_CONFIRMED",
      },
      markers: [
        { id: "m1", nx: 0.1, ny: 0.1, kind: "point", label: "A", lengthM: 1 },
        { id: "m2", nx: 0.9, ny: 0.1, kind: "point", label: "B" },
      ],
    },
  ];
  p.reality.videos = [
    {
      id: "vid1",
      name: "clip.webm",
      mime: "video/webm",
      createdAt: p.createdAt,
      durationMs: 4000,
      widthPx: 640,
      heightPx: 360,
      status: "ready",
      frameIds: [],
      selectedFrameIds: [],
      persistRaw: false,
    },
  ];
  p.reality.findings = [
    {
      id: "f1",
      kind: "beam",
      summary: "pending beam",
      confidence: "MEDIUM",
      status: "PENDING",
      estimated: {
        kind: "beam",
        name: "est",
        x: 0,
        y: 0,
        z: 0,
        widthM: 0.2,
        heightM: 0.2,
        depthM: 1,
        provenance: "PHOTO_ESTIMATE",
        confidence: "LOW",
      },
      opening: {
        id: "pending_open",
        type: "INTAKE",
        wallId: "north",
        widthM: 0.8,
        heightM: 0.6,
        bottomElevationM: 0.4,
        offsetFromWallStartM: 1,
      },
      wallResize: { wallId: "east", lengthM: 8 },
    },
  ];
  return p;
}

function setAt(obj: unknown, path: string, value: number): void {
  const tokens = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur: Record<string, unknown> = obj as Record<string, unknown>;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i]!;
    const next = cur[t];
    if (next == null || typeof next !== "object") {
      throw new Error(`Cannot walk ${path} at ${t}`);
    }
    cur = next as Record<string, unknown>;
  }
  cur[tokens[tokens.length - 1]!] = value;
}

/**
 * Apply the inventory's documented invalid sample at the first matching
 * instance of a `[]` path. SAFETY_DRIVING / SAFETY_GEOMETRY mutations must
 * then fail validateCanonicalProjectDomains.
 */
export function applyInventoryInvalid(project: Project, path: string, invalid: number): Project {
  const next = structuredClone(project);
  const concrete = collectNumericPaths(next).find((p) => normalizeNumericPath(p) === path);
  if (!concrete) throw new Error(`inventory path not present on fixture: ${path}`);
  setAt(next, concrete, invalid);
  return next;
}
