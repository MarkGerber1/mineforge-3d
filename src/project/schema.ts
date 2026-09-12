import { z } from "zod";
import { emptyReality, type Project } from "../engineering/types.ts";

const sourceSchema = z.object({
  label: z.string(),
  url: z.string().optional(),
  retrieved: z.string().optional(),
  trust: z.enum([
    "OFFICIAL_VERIFIED",
    "VERIFIED_SECONDARY",
    "USER_ENTERED",
    "AI_FOUND_UNVERIFIED",
    "ESTIMATED",
    "TEST_FIXTURE",
  ]),
});

const asicSchema = z.object({
  id: z.string(),
  manufacturer: z.string(),
  model: z.string(),
  variant: z.string().optional(),
  algorithm: z.string(),
  hashrateThs: z.number(),
  typicalPowerW: z.number(),
  designPowerW: z.number(),
  voltageMin: z.number(),
  voltageMax: z.number(),
  currentA: z.number().optional(),
  widthM: z.number(),
  heightM: z.number(),
  lengthM: z.number(),
  weightKg: z.number(),
  airflowDirection: z.enum(["FRONT_TO_BACK", "BACK_TO_FRONT", "SIDE"]),
  manufacturerAirflowM3h: z.number().optional(),
  noiseDba: z.number().optional(),
  source: sourceSchema,
});

export const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  room: z.object({
    kind: z.literal("rectangular"),
    widthM: z.number(),
    depthM: z.number(),
    heightM: z.number(),
    wallThicknessM: z.number(),
  }),
  openings: z.array(
    z.object({
      id: z.string(),
      type: z.enum(["DOOR", "INTAKE", "EXHAUST", "SHAFT_CONNECTION", "TECHNICAL", "CUSTOM"]),
      wallId: z.enum(["north", "south", "east", "west"]),
      widthM: z.number(),
      heightM: z.number(),
      bottomElevationM: z.number(),
      offsetFromWallStartM: z.number(),
      locked: z.boolean().optional(),
      name: z.string().optional(),
      provenance: z.enum(["PHOTO_ESTIMATE", "USER_CONFIRMED", "FIELD_MEASUREMENT", "IMPORTED", "CALCULATED"]).optional(),
      sourcePhotoId: z.string().optional(),
      sourceFindingId: z.string().optional(),
    }),
  ),
  ventilation: z.object({
    components: z.array(
      z.object({
        id: z.string(),
        kind: z.enum([
          "opening",
          "duct",
          "elbow90",
          "elbow45",
          "louver",
          "filter",
          "damper",
          "silencer",
          "outlet",
          "transition",
        ]),
        name: z.string(),
        shape: z.enum(["rect", "round"]),
        widthM: z.number().optional(),
        heightM: z.number().optional(),
        diameterM: z.number().optional(),
        lengthM: z.number(),
        frictionFactor: z.number(),
        kLocal: z.number(),
        extraPressurePa: z.number(),
        openingId: z.string().optional(),
      }),
    ),
    dirtyFilter: z.boolean(),
    dirtyFilterExtraPa: z.number(),
    outdoorTempC: z.number(),
  }),
  electrical: z.object({
    availablePowerW: z.number(),
    voltageV: z.number(),
    frequencyHz: z.number(),
    phases: z.literal(3),
    reservePct: z.number(),
    policy: z.enum(["typical", "design"]),
    auxiliaryW: z.number(),
    lightingW: z.number(),
    networkW: z.number(),
    known: z.boolean(),
  }),
  fleet: z.object({
    asicId: z.string(),
    requestedCount: z.number(),
    imported: asicSchema.optional(),
  }),
  racks: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      x: z.number(),
      y: z.number(),
      widthM: z.number(),
      depthM: z.number(),
      heightM: z.number(),
      rotationDeg: z.number(),
      shelves: z.number(),
      usableShelfWidthM: z.number(),
      usableShelfDepthM: z.number(),
      asicCount: z.number(),
      airflowToward: z.enum(["north", "south", "east", "west"]),
      locked: z.boolean().optional(),
    }),
  ),
  fans: z.array(
    z.object({
      id: z.string(),
      specId: z.string(),
      name: z.string(),
      x: z.number(),
      y: z.number(),
      arrangement: z.enum(["single", "parallel", "series"]),
      count: z.number(),
      dirtyFilter: z.boolean(),
    }),
  ),
  thermal: z.object({
    deltaTK: z.number(),
    outdoorTempC: z.number(),
    intakeTempC: z.number(),
  }),
  constraints: z.object({
    floorLoadingUnknown: z.boolean(),
    maxFloorLoadPa: z.number().optional(),
    frontServiceClearanceM: z.number(),
    rearServiceClearanceM: z.number(),
    minAisleM: z.number(),
  }),
  lockedObjectIds: z.array(z.string()),
  notes: z.string().optional(),
  reality: z
    .object({
      photos: z.array(z.any()),
      findings: z.array(z.any()),
      asBuilt: z.array(z.any()),
      compareMode: z.enum(["as-designed", "as-built", "deviation"]),
      interview: z.array(z.any()),
    })
    .optional(),
});

export function parseProject(data: unknown): Project {
  const p = projectSchema.parse(data) as Project;
  if (!p.reality) p.reality = emptyReality();
  return p;
}

export function migrateProject(raw: unknown): Project {
  if (raw && typeof raw === "object" && (raw as { schemaVersion?: number }).schemaVersion === 1) {
    return parseProject(raw);
  }
  throw new Error("Unsupported project schema. Expected schemaVersion 1.");
}
