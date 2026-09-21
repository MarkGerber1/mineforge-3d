import { z } from "zod";
import { emptyReality, type Project } from "../engineering/types.ts";
import {
  MAX_DELTA_T_K,
  MAX_FAN_GROUP_COUNT,
  MAX_RACK_ASIC_COUNT,
  MAX_RACK_SHELVES,
  MAX_RESERVE_PCT,
  MAX_ROOM_DIM_M,
  MAX_ROOM_HEIGHT_M,
  MAX_SHAFT_LENGTH_M,
  MIN_DELTA_T_K,
  MIN_FAN_GROUP_COUNT,
  MIN_RACK_SHELVES,
  MIN_RESERVE_PCT,
  MIN_ROOM_DIM_M,
} from "../engineering/constants.ts";
import { defaultCatalogs } from "../engineering/catalogs.ts";
import { validateCanonicalProjectDomains } from "../engineering/canonical.ts";
import type { Catalogs } from "../engineering/pipeline.ts";

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
  hashrateThs: z.number().finite().nonnegative(),
  typicalPowerW: z.number().finite().positive(),
  designPowerW: z.number().finite().positive(),
  voltageMin: z.number().finite().positive(),
  voltageMax: z.number().finite().positive(),
  currentA: z.number().finite().nonnegative().optional(),
  frequencyMinHz: z.number().finite().positive().optional(),
  frequencyMaxHz: z.number().finite().positive().optional(),
  inputPhases: z.union([z.literal(1), z.literal(3)]).optional(),
  widthM: z.number().finite().positive(),
  heightM: z.number().finite().positive(),
  lengthM: z.number().finite().positive(),
  weightKg: z.number().finite().positive(),
  airflowDirection: z.enum(["FRONT_TO_BACK", "BACK_TO_FRONT", "SIDE"]),
  manufacturerAirflowM3h: z.number().finite().nonnegative().optional(),
  noiseDba: z.number().finite().optional(),
  source: sourceSchema,
}).refine((a) => a.designPowerW >= a.typicalPowerW, {
  message: "designPowerW must be ≥ typicalPowerW",
  path: ["designPowerW"],
}).refine((a) => a.voltageMin <= a.voltageMax, {
  message: "voltageMin must be ≤ voltageMax",
  path: ["voltageMin"],
}).superRefine((a, ctx) => {
  const hasMin = a.frequencyMinHz != null;
  const hasMax = a.frequencyMaxHz != null;
  if (hasMin !== hasMax) {
    ctx.addIssue({
      code: "custom",
      message: "frequencyMinHz and frequencyMaxHz must both be present",
      path: ["frequencyMinHz"],
    });
  }
  if (hasMin && hasMax && a.frequencyMinHz! > a.frequencyMaxHz!) {
    ctx.addIssue({
      code: "custom",
      message: "frequencyMinHz must be ≤ frequencyMaxHz",
      path: ["frequencyMinHz"],
    });
  }
});

export const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  room: z.object({
    kind: z.literal("rectangular"),
    widthM: z.number().finite().min(MIN_ROOM_DIM_M).max(MAX_ROOM_DIM_M),
    depthM: z.number().finite().min(MIN_ROOM_DIM_M).max(MAX_ROOM_DIM_M),
    heightM: z.number().finite().min(MIN_ROOM_DIM_M).max(MAX_ROOM_HEIGHT_M),
    wallThicknessM: z.number().finite().positive().max(MAX_ROOM_DIM_M),
  }),
  openings: z.array(
    z.object({
      id: z.string(),
      type: z.enum(["DOOR", "INTAKE", "EXHAUST", "SHAFT_CONNECTION", "TECHNICAL", "CUSTOM"]),
      wallId: z.enum(["north", "south", "east", "west"]),
      widthM: z.number().finite(),
      heightM: z.number().finite(),
      bottomElevationM: z.number().finite(),
      offsetFromWallStartM: z.number().finite(),
      locked: z.boolean().optional(),
      name: z.string().optional(),
      provenance: z.enum(["PHOTO_ESTIMATE", "USER_CONFIRMED", "FIELD_MEASUREMENT", "IMPORTED", "CALCULATED", "VIDEO_FRAME_ESTIMATE"]).optional(),
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
        widthM: z.number().finite().positive().optional(),
        heightM: z.number().finite().positive().optional(),
        diameterM: z.number().finite().positive().optional(),
        lengthM: z.number().finite().nonnegative().max(MAX_SHAFT_LENGTH_M),
        frictionFactor: z.number().finite().nonnegative(),
        kLocal: z.number().finite().nonnegative(),
        extraPressurePa: z.number().finite().nonnegative(),
        openingId: z.string().optional(),
        freeAreaRatio: z.number().finite().positive().max(1).optional(),
        maxFaceVelocityMs: z.number().finite().positive().max(100).optional(),
        criterionSource: z.string().optional(),
      }),
    ),
    dirtyFilter: z.boolean(),
    dirtyFilterExtraPa: z.number().finite().nonnegative(),
    outdoorTempC: z.number().finite(),
    openingCriteria: z
      .object({
        maxFaceVelocityMs: z.number().finite().positive().max(100),
        freeAreaRatio: z.number().finite().positive().max(1),
        source: z.string().min(1),
      })
      .optional(),
    openingCriteriaEnabled: z.boolean().optional(),
  }),
  electrical: z.object({
    availablePowerW: z.number().finite(),
    voltageV: z.number().finite().positive(),
    frequencyHz: z.number().finite().positive(),
    phases: z.literal(3),
    reservePct: z.number().finite().min(MIN_RESERVE_PCT).max(MAX_RESERVE_PCT),
    policy: z.enum(["typical", "design"]),
    auxiliaryW: z.number().finite().nonnegative(),
    lightingW: z.number().finite().nonnegative(),
    networkW: z.number().finite().nonnegative(),
    known: z.boolean(),
  }),
  fleet: z.object({
    asicId: z.string(),
    requestedCount: z.number().finite().int().nonnegative(),
    imported: asicSchema.optional(),
  }),
  racks: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      x: z.number().finite(),
      y: z.number().finite(),
      widthM: z.number().finite().positive().max(MAX_ROOM_DIM_M),
      depthM: z.number().finite().positive().max(MAX_ROOM_DIM_M),
      heightM: z.number().finite().positive().max(MAX_ROOM_HEIGHT_M),
      rotationDeg: z.number().finite(),
      shelves: z.number().finite().int().min(MIN_RACK_SHELVES).max(MAX_RACK_SHELVES),
      usableShelfWidthM: z.number().finite().positive(),
      usableShelfDepthM: z.number().finite().positive(),
      asicCount: z.number().finite().int().nonnegative().max(MAX_RACK_ASIC_COUNT),
      airflowToward: z.enum(["north", "south", "east", "west"]),
      locked: z.boolean().optional(),
    }),
  ),
  fans: z.array(
    z.object({
      id: z.string(),
      specId: z.string(),
      name: z.string(),
      x: z.number().finite(),
      y: z.number().finite(),
      arrangement: z.enum(["single", "parallel", "series"]),
      count: z.number().finite().int().min(MIN_FAN_GROUP_COUNT).max(MAX_FAN_GROUP_COUNT),
      dirtyFilter: z.boolean(),
    }),
  ),
  thermal: z.object({
    deltaTK: z.number().finite().min(MIN_DELTA_T_K).max(MAX_DELTA_T_K),
    outdoorTempC: z.number().finite(),
    intakeTempC: z.number().finite(),
  }),
  constraints: z.object({
    floorLoadingUnknown: z.boolean(),
    maxFloorLoadPa: z.number().finite().positive().optional(),
    frontServiceClearanceM: z.number().finite().nonnegative(),
    rearServiceClearanceM: z.number().finite().nonnegative(),
    minAisleM: z.number().finite().nonnegative(),
  }).superRefine((c, ctx) => {
    if (!c.floorLoadingUnknown) {
      if (c.maxFloorLoadPa == null || !Number.isFinite(c.maxFloorLoadPa) || !(c.maxFloorLoadPa > 0)) {
        ctx.addIssue({
          code: "custom",
          message: "Known floor loading requires a finite net payload pressure > 0 Pa.",
          path: ["maxFloorLoadPa"],
        });
      }
    }
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
      videos: z.array(z.any()).optional(),
    })
    .optional(),
}).superRefine((p, ctx) => {
  const placed = p.racks.reduce((s, r) => s + r.asicCount, 0);
  if (placed > p.fleet.requestedCount) {
    ctx.addIssue({
      code: "custom",
      message: `placedAsicCount ${placed} > requestedCount ${p.fleet.requestedCount}`,
      path: ["fleet", "requestedCount"],
    });
  }
});

export function parseProject(data: unknown, catalogs: Catalogs = defaultCatalogs()): Project {
  const p = projectSchema.parse(data) as Project;
  if (!p.reality) p.reality = emptyReality();
  if (!p.reality.videos) p.reality.videos = [];
  const domains = validateCanonicalProjectDomains(p, catalogs);
  if (!domains.ok) {
    throw new Error(domains.errors[0] ?? "Invalid canonical project domains.");
  }
  return p;
}

export function migrateProject(raw: unknown): Project {
  if (raw && typeof raw === "object" && (raw as { schemaVersion?: number }).schemaVersion === 1) {
    return parseProject(raw);
  }
  throw new Error("Unsupported project schema. Expected schemaVersion 1.");
}
