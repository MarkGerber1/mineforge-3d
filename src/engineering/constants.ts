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
export const MAX_SHAFT_LENGTH_M = 250;

export const SNAP_MODES_M = {
  "1mm": 0.001,
  "1cm": 0.01,
  "5cm": 0.05,
  "10cm": 0.1,
} as const;

export type SnapMode = keyof typeof SNAP_MODES_M;
