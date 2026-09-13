/** Global engineering constants. Override only when a test/project says so. */

export const AIR_DENSITY_KG_M3 = 1.2041;
export const AIR_CP_J_KG_K = 1005;
export const SUPPLY_VOLTAGE_V = 230;
export const SUPPLY_FREQUENCY_HZ = 50;
export const PHASE_COUNT = 3;

export const MM = 0.001;
export const CFM_PER_M3H = 1 / 1.6990107955;

/** Documented default Darcy friction factor for galvanised rectangular duct (PHASE 1). */
export const DEFAULT_FRICTION_FACTOR = 0.02;

/** Typical local-loss coefficients (ASHRAE / CIBSE order of magnitude). */
export const K_ELBOW_90 = 0.9;
export const K_ELBOW_45 = 0.35;
export const K_LOUVER = 1.3;
export const K_ENTRANCE_SHARP = 0.5;
export const K_SILENCER = 1.8;
export const K_ROOF_OUTLET = 1.0;
export const K_DAMPER_OPEN = 0.2;
export const K_FILTER_CLEAN = 0.8;

/** Dirty-filter additional static pressure used by FAN-04 / dirty-filter mode. */
export const DIRTY_FILTER_EXTRA_PA = 200;

export const DEFAULT_DELTA_T_K = 10;
export const MIN_DELTA_T_K = 5;
export const MAX_DELTA_T_K = 15;

export const DEFAULT_FRONT_CLEARANCE_M = 0.8;
export const DEFAULT_REAR_CLEARANCE_M = 0.6;
export const DEFAULT_AISLE_M = 1.0;

export const MIN_ROOM_DIM_M = 0.5;
export const MAX_ROOM_DIM_M = 200;
export const MAX_ROOM_HEIGHT_M = 50;
export const MAX_SHAFT_LENGTH_M = 250;

/** Geometric availability floor for intake/exhaust. Not an airflow calculation. */
export const MIN_USABLE_OPENING_AREA_M2 = 0.05;

/** Electrical available-power domain (Inspector kW field commits watts). */
export const MIN_AVAILABLE_POWER_W = 1000;
export const MAX_AVAILABLE_POWER_W = 10_000_000;

/** Absolute asicCount domain; per-rack capacity is an additional cap when ASIC is known. */
export const MAX_RACK_ASIC_COUNT = 10_000;

export const SNAP_MODES_M = {
  "1mm": 0.001,
  "1cm": 0.01,
  "5cm": 0.05,
  "10cm": 0.1,
} as const;

export type SnapMode = keyof typeof SNAP_MODES_M;

/** Electrical reserve as percent of available power. Inspector options are a subset. */
export const MIN_RESERVE_PCT = 0;
export const MAX_RESERVE_PCT = 90;

/** Parallel / grouped fan instances on one FanInstance. Product uses 1–2; 16 is the hard cap. */
export const MIN_FAN_GROUP_COUNT = 1;
export const MAX_FAN_GROUP_COUNT = 16;

/** Physical shelf count on one rack body. TEST_RACK_A uses 4. */
export const MIN_RACK_SHELVES = 1;
export const MAX_RACK_SHELVES = 50;

/** Deterministic plan AABB only treats these orientations as rotated. */
export const SUPPORTED_RACK_ROTATION_DEG = [0, 90, 180, 270] as const;
export type SupportedRackRotationDeg = (typeof SUPPORTED_RACK_ROTATION_DEG)[number];

export function isSupportedRackRotationDeg(n: number): n is SupportedRackRotationDeg {
  return (SUPPORTED_RACK_ROTATION_DEG as readonly number[]).includes(n);
}

/** Standard gravity for payload force. SI. */
export const STANDARD_GRAVITY_M_S2 = 9.80665;

/**
 * Documented PHASE 1 net equipment payload allowance used by fixtures that
 * declare floor loading as known.
 *
 * CONTRACT (OPTION A): `constraints.maxFloorLoadPa` is the Owner-entered
 * allowable **net equipment payload pressure** (Pa) AFTER permanent structure
 * and rack dead load have been accounted for outside this model. Engineering
 * Core does not invent rack self-weight. Screening uses ASIC mass × g on the
 * demonstrated rack plan footprint only.
 *
 * 10 kPa = 10 kN/m² ≈ 1020 kg/m² — a typical industrial live-load order of
 * magnitude, not a silent default and not an unbounded sentinel.
 */
export const STANDARD_NET_FLOOR_PAYLOAD_PA = 10_000;
