import {
  DEFAULT_AISLE_M,
  DEFAULT_DELTA_T_K,
  DEFAULT_FRICTION_FACTOR,
  DEFAULT_FRONT_CLEARANCE_M,
  DEFAULT_REAR_CLEARANCE_M,
  DIRTY_FILTER_EXTRA_PA,
  K_ELBOW_90,
  K_ENTRANCE_SHARP,
  K_FILTER_CLEAN,
  K_ROOF_OUTLET,
  K_SILENCER,
  STANDARD_NET_FLOOR_PAYLOAD_PA,
  SUPPLY_FREQUENCY_HZ,
  SUPPLY_VOLTAGE_V,
} from "../engineering/constants.ts";
import type { AsicSpec, Project, VentComponent } from "../engineering/types.ts";
import { emptyReality } from "../engineering/types.ts";
import { ASIC_S21_PRO, TEST_ASIC_A } from "../equipment/asic-catalog.ts";
import { FAN_STRONG } from "../equipment/fan-catalog.ts";
import { generateAutoLayout } from "../engineering/layout.ts";

let seq = 1;
export function nid(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq.toString(36)}_${Date.now().toString(36)}`;
}

function now() {
  return 1_704_067_200_000;
}

export function emptyRectangularProject(partial?: Partial<Project["room"]> & { name?: string }): Project {
  const t = now();
  return {
    schemaVersion: 1,
    id: nid("proj"),
    name: partial?.name ?? "Новый объект",
    createdAt: t,
    updatedAt: t,
    room: {
      kind: "rectangular",
      widthM: partial?.widthM ?? 8,
      depthM: partial?.depthM ?? 5,
      heightM: partial?.heightM ?? 2.8,
      wallThicknessM: partial?.wallThicknessM ?? 0.2,
    },
    openings: [],
    ventilation: {
      components: [],
      dirtyFilter: false,
      dirtyFilterExtraPa: DIRTY_FILTER_EXTRA_PA,
      outdoorTempC: 25,
      openingCriteria: {
        maxFaceVelocityMs: 5,
        freeAreaRatio: 0.6,
        source: "MINEFORGE design default; verify against grille/louver/filter manufacturer data",
      },
      openingCriteriaEnabled: false,
    },
    electrical: {
      availablePowerW: 0,
      voltageV: SUPPLY_VOLTAGE_V,
      frequencyHz: SUPPLY_FREQUENCY_HZ,
      phases: 3,
      reservePct: 0,
      policy: "design",
      auxiliaryW: 0,
      lightingW: 0,
      networkW: 0,
      known: false,
    },
    fleet: { asicId: ASIC_S21_PRO.id, requestedCount: 0 },
    racks: [],
    fans: [],
    thermal: { deltaTK: DEFAULT_DELTA_T_K, outdoorTempC: 25, intakeTempC: 25 },
    constraints: {
      floorLoadingUnknown: true,
      frontServiceClearanceM: DEFAULT_FRONT_CLEARANCE_M,
      rearServiceClearanceM: DEFAULT_REAR_CLEARANCE_M,
      minAisleM: DEFAULT_AISLE_M,
    },
    lockedObjectIds: [],
    reality: emptyReality(),
  };
}

/** Controlled engineering fixture for oracle/E2E tests; never injected into production defaults. */
export function ventRoomTest01(): Project {
  const project = emptyRectangularProject({ name: "VENT-ROOM-TEST-01", widthM: 4, depthM: 5, heightM: 2.7 });
  project.openings = [
    {
      id: "door_south_test",
      type: "DOOR",
      wallId: "south",
      offsetFromWallStartM: 0.5,
      widthM: 0.9,
      heightM: 2.05,
      bottomElevationM: 0,
      locked: false,
    },
  ];
  project.ventilation.openingCriteriaEnabled = true;
  project.fleet.requestedCount = 0;
  project.racks = [];
  project.fans = [];
  project.ventilation.components = [];
  project.reality = {
    ...emptyReality(),
    asBuilt: [
      {
        id: "shaft_ne_test",
        kind: "duct",
        name: "Vent shaft",
        x: 3.2,
        y: 4.2,
        z: 0,
        widthM: 0.8,
        heightM: 2.7,
        depthM: 0.8,
        provenance: "USER_CONFIRMED",
        confidence: "HIGH",
      },
      {
        id: "cabinet_1_test",
        kind: "obstruction",
        name: "Control cabinet 1",
        x: 0.1,
        y: 1,
        z: 0,
        widthM: 0.8,
        heightM: 1.8,
        depthM: 0.25,
        provenance: "USER_CONFIRMED",
        confidence: "HIGH",
      },
      {
        id: "cabinet_2_test",
        kind: "obstruction",
        name: "Control cabinet 2",
        x: 0.1,
        y: 1.4,
        z: 0,
        widthM: 0.6,
        heightM: 1.6,
        depthM: 0.25,
        provenance: "USER_CONFIRMED",
        confidence: "HIGH",
      },
    ],
  };
  return project;
}

export function defaultVentNetwork(args: {
  exhaustOpeningId: string;
  shaftW: number;
  shaftH: number;
  verticalM: number;
  horizontalM: number;
}): VentComponent[] {
  const f = DEFAULT_FRICTION_FACTOR;
  return [
    {
      id: "comp_opening",
      kind: "opening",
      name: "Exhaust opening",
      shape: "rect",
      widthM: args.shaftW,
      heightM: args.shaftH,
      lengthM: 0.2,
      frictionFactor: f,
      kLocal: K_ENTRANCE_SHARP,
      extraPressurePa: 0,
      openingId: args.exhaustOpeningId,
    },
    {
      id: "comp_horiz",
      kind: "duct",
      name: "Horizontal duct",
      shape: "rect",
      widthM: args.shaftW,
      heightM: args.shaftH,
      lengthM: args.horizontalM,
      frictionFactor: f,
      kLocal: 0,
      extraPressurePa: 0,
    },
    {
      id: "comp_e1",
      kind: "elbow90",
      name: "Elbow 90° #1",
      shape: "rect",
      widthM: args.shaftW,
      heightM: args.shaftH,
      lengthM: 0,
      frictionFactor: 0,
      kLocal: K_ELBOW_90,
      extraPressurePa: 0,
    },
    {
      id: "comp_shaft",
      kind: "duct",
      name: `Vertical shaft ${args.verticalM} m`,
      shape: "rect",
      widthM: args.shaftW,
      heightM: args.shaftH,
      lengthM: args.verticalM,
      frictionFactor: f,
      kLocal: 0,
      extraPressurePa: 0,
    },
    {
      id: "comp_e2",
      kind: "elbow90",
      name: "Elbow 90° #2",
      shape: "rect",
      widthM: args.shaftW,
      heightM: args.shaftH,
      lengthM: 0,
      frictionFactor: 0,
      kLocal: K_ELBOW_90,
      extraPressurePa: 0,
    },
    {
      id: "comp_silencer",
      kind: "silencer",
      name: "Silencer",
      shape: "rect",
      widthM: args.shaftW,
      heightM: args.shaftH,
      lengthM: 1.2,
      frictionFactor: f,
      kLocal: K_SILENCER,
      extraPressurePa: 0,
    },
    {
      id: "comp_filter",
      kind: "filter",
      name: "Filter",
      shape: "rect",
      widthM: args.shaftW,
      heightM: args.shaftH,
      lengthM: 0.3,
      frictionFactor: 0,
      kLocal: K_FILTER_CLEAN,
      extraPressurePa: 0,
    },
    {
      id: "comp_outlet",
      kind: "outlet",
      name: "Roof outlet",
      shape: "rect",
      widthM: args.shaftW,
      heightM: args.shaftH,
      lengthM: 0,
      frictionFactor: 0,
      kLocal: K_ROOF_OUTLET,
      extraPressurePa: 0,
    },
  ];
}

/** PHASE 1 demo / acceptance fixture. Outputs are computed, never hard-coded. */
export function undergroundParkingFarm(): Project {
  const t = now();
  const exhaustId = "open_exhaust";
  const intakeId = "open_intake";
  const doorId = "open_door";
  const shaftW = 1.4;
  const shaftH = 0.9;
  const p = emptyRectangularProject({ name: "Underground Parking Farm", widthM: 8, depthM: 5, heightM: 2.8 });
  p.id = "proj_underground_parking";
  p.createdAt = t;
  p.updatedAt = t;
  p.openings = [
    {
      id: doorId,
      type: "DOOR",
      wallId: "south",
      widthM: 1.2,
      heightM: 2.1,
      bottomElevationM: 0,
      offsetFromWallStartM: 0.4,
      name: "Door",
      locked: true,
    },
    {
      id: intakeId,
      type: "INTAKE",
      wallId: "west",
      widthM: 1.4,
      heightM: 0.9,
      bottomElevationM: 0.4,
      offsetFromWallStartM: 1.5,
      name: "Intake",
    },
    {
      id: exhaustId,
      type: "EXHAUST",
      wallId: "east",
      widthM: shaftW,
      heightM: shaftH,
      bottomElevationM: 0.4,
      offsetFromWallStartM: 1.6,
      name: "Exhaust / shaft",
    },
  ];
  p.ventilation.components = defaultVentNetwork({
    exhaustOpeningId: exhaustId,
    shaftW,
    shaftH,
    verticalM: 75,
    horizontalM: 4,
  });
  p.electrical = {
    ...p.electrical,
    availablePowerW: 150000,
    known: true,
    reservePct: 0,
    policy: "design",
    auxiliaryW: 2500,
    lightingW: 800,
    networkW: 400,
  };
  p.fleet = { asicId: ASIC_S21_PRO.id, requestedCount: 30 };
  p.fans = [
    {
      id: "fan_main",
      specId: FAN_STRONG.id,
      name: "Main exhaust fan",
      x: 7.2,
      y: 2.5,
      arrangement: "single",
      count: 1,
      dirtyFilter: false,
    },
  ];
  p.lockedObjectIds = [doorId];
  p.notes = "PHASE 1 demo: 8×5×2.8 m underground room, 75 m shaft, 30 × S21 Pro.";
  p.racks = generateAutoLayout(p, ASIC_S21_PRO);
  return p;
}

export function testAsicAProject(): Project {
  const p = undergroundParkingFarm();
  p.name = "TEST_ASIC_A parking";
  p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 30 };
  p.electrical.auxiliaryW = 0;
  p.electrical.lightingW = 0;
  p.electrical.networkW = 0;
  return p;
}

export function withKnownFloor(p: Project, limitPa = STANDARD_NET_FLOOR_PAYLOAD_PA): Project {
  p.constraints.floorLoadingUnknown = false;
  p.constraints.maxFloorLoadPa = limitPa;
  return p;
}

/**
 * TEST_ASIC_A numbers with a claimed OFFICIAL_VERIFIED flag.
 * Catalog TEST_ASIC_A remains TEST_FIXTURE. The JSON claim is not authority:
 * Engineering Core will not treat this as final-safe unless it exact-matches
 * a trusted catalog ASIC (it does not).
 */
export function officialTestAsicA(extra: Partial<AsicSpec> = {}): AsicSpec {
  return {
    ...TEST_ASIC_A,
    frequencyMinHz: 50,
    frequencyMaxHz: 60,
    inputPhases: 1,
    ...extra,
    source: extra.source ?? {
      label: "TEST_ASIC_A official-trust fixture (not production catalog)",
      trust: "OFFICIAL_VERIFIED",
    },
  };
}

/** Acceptance fixture: catalog-trusted S21 Pro, known floor, placed === requested. */
export function verifiedAcceptanceProject(requestedCount = 24): Project {
  const p = undergroundParkingFarm();
  withKnownFloor(p);
  p.fleet = { asicId: ASIC_S21_PRO.id, requestedCount };
  p.racks = generateAutoLayout(p, ASIC_S21_PRO);
  return p;
}

export const TEST_RACK_A = {
  widthM: 1.6,
  depthM: 0.6,
  heightM: 2.0,
  shelves: 4,
  usableShelfWidthM: 1.5,
  usableShelfDepthM: 0.55,
};
