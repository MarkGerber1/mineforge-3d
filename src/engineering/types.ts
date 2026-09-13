export type TrustLevel =
  | "OFFICIAL_VERIFIED"
  | "VERIFIED_SECONDARY"
  | "USER_ENTERED"
  | "AI_FOUND_UNVERIFIED"
  | "ESTIMATED"
  | "TEST_FIXTURE";

export type WarningSeverity = "INFO" | "WARNING" | "CRITICAL" | "BLOCKER";

export type OpeningType = "DOOR" | "INTAKE" | "EXHAUST" | "SHAFT_CONNECTION" | "TECHNICAL" | "CUSTOM";

export type WallId = "north" | "south" | "east" | "west";

export type AirflowDirection = "FRONT_TO_BACK" | "BACK_TO_FRONT" | "SIDE";

export type ElectricalPolicy = "typical" | "design";

export type AppMode = "project" | "xray" | "twin";
export type ViewMode = "2d" | "3d" | "split";

export type ProjectStatus = "PASS" | "WARNING" | "FAIL" | "INCOMPLETE";
export type SafeConfidence = "VERIFIED" | "PRELIMINARY" | "INCOMPLETE" | "CRITICAL";
export type HudSafetyKind = "VERIFIED" | "PRELIMINARY" | "INCOMPLETE" | "CRITICAL" | "OVER_CAPACITY";

export type BottleneckKind = "ELECTRICAL" | "VENTILATION" | "SPACE" | "RACK" | "FLOOR" | "USER" | "UNKNOWN";

export interface DataSource {
  label: string;
  url?: string;
  retrieved?: string;
  trust: TrustLevel;
}

export interface Warning {
  id: string;
  severity: WarningSeverity;
  objectId?: string;
  title: string;
  detail: string;
  formula?: string;
}

export interface AsicSpec {
  id: string;
  manufacturer: string;
  model: string;
  variant?: string;
  algorithm: string;
  hashrateThs: number;
  typicalPowerW: number;
  designPowerW: number;
  voltageMin: number;
  voltageMax: number;
  currentA?: number;
  widthM: number;
  heightM: number;
  lengthM: number;
  weightKg: number;
  airflowDirection: AirflowDirection;
  manufacturerAirflowM3h?: number;
  noiseDba?: number;
  source: DataSource;
}

export interface FanCurvePoint {
  flowM3h: number;
  pressurePa: number;
}

export interface FanSpec {
  id: string;
  manufacturer: string;
  model: string;
  curve: FanCurvePoint[];
  analytic?: { p0: number; qMax: number };
  powerW: number;
  voltage: number;
  phases: 1 | 3;
  soundDba?: number;
  freeAirM3h: number;
  source: DataSource;
}

export interface Opening {
  id: string;
  type: OpeningType;
  wallId: WallId;
  widthM: number;
  heightM: number;
  bottomElevationM: number;
  offsetFromWallStartM: number;
  locked?: boolean;
  name?: string;
  provenance?: DimProvenance;
  sourcePhotoId?: string;
  sourceFindingId?: string;
}

export type VentKind =
  | "opening"
  | "duct"
  | "elbow90"
  | "elbow45"
  | "louver"
  | "filter"
  | "damper"
  | "silencer"
  | "outlet"
  | "transition";

export type DuctShape = "rect" | "round";

export interface VentComponent {
  id: string;
  kind: VentKind;
  name: string;
  shape: DuctShape;
  widthM?: number;
  heightM?: number;
  diameterM?: number;
  lengthM: number;
  frictionFactor: number;
  kLocal: number;
  extraPressurePa: number;
  openingId?: string;
}

export interface Rack {
  id: string;
  name: string;
  x: number;
  y: number;
  widthM: number;
  depthM: number;
  heightM: number;
  rotationDeg: number;
  shelves: number;
  usableShelfWidthM: number;
  usableShelfDepthM: number;
  asicCount: number;
  airflowToward: "north" | "south" | "east" | "west";
  locked?: boolean;
}

export interface FanInstance {
  id: string;
  specId: string;
  name: string;
  x: number;
  y: number;
  arrangement: "single" | "parallel" | "series";
  count: number;
  dirtyFilter: boolean;
}

export interface ElectricalSupply {
  availablePowerW: number;
  voltageV: number;
  frequencyHz: number;
  phases: 3;
  reservePct: number;
  policy: ElectricalPolicy;
  auxiliaryW: number;
  lightingW: number;
  networkW: number;
  known: boolean;
}

export interface Fleet {
  asicId: string;
  requestedCount: number;
  imported?: AsicSpec;
}

export interface ThermalSettings {
  deltaTK: number;
  outdoorTempC: number;
  intakeTempC: number;
}

export interface RoomGeometry {
  kind: "rectangular";
  widthM: number;
  depthM: number;
  heightM: number;
  wallThicknessM: number;
}

export interface Constraints {
  /**
   * When true, floor payload is UNKNOWN → SAFE confidence PRELIMINARY.
   * When false, `maxFloorLoadPa` MUST be a finite pressure > 0.
   */
  floorLoadingUnknown: boolean;
  /**
   * Net equipment payload allowance (Pa) AFTER structure and rack dead load.
   * OPTION A floor model — see STANDARD_NET_FLOOR_PAYLOAD_PA.
   */
  maxFloorLoadPa?: number;
  frontServiceClearanceM: number;
  rearServiceClearanceM: number;
  minAisleM: number;
}

export interface ScenarioMeta {
  id: string;
  name: string;
  createdAt: number;
}

export type DimProvenance =
  | "PHOTO_ESTIMATE"
  | "USER_CONFIRMED"
  | "FIELD_MEASUREMENT"
  | "IMPORTED"
  | "CALCULATED"
  | "VIDEO_FRAME_ESTIMATE";

export type AsBuiltKind = "beam" | "column" | "obstruction" | "duct" | "other";

export type RealityFindingKind = AsBuiltKind | "door" | "opening" | "shaft" | "wall";

export type PhotoMarkerKind =
  | "point"
  | "wall"
  | "door"
  | "opening"
  | "shaft"
  | "beam"
  | "column"
  | "duct"
  | "other";

export interface PhotoMarker {
  id: string;
  nx: number;
  ny: number;
  kind: PhotoMarkerKind;
  label: string;
  pairId?: string;
  lengthM?: number;
  provenance?: DimProvenance;
  linkedObjectId?: string;
}

/** Isotropic photo-plane scale from a known A–B distance. Not photogrammetry. */
export interface PhotoCalibration {
  scaleMPerPx: number;
  lengthM: number;
  aId: string;
  bId: string;
  provenance: DimProvenance;
}

export interface RealityPhotoMeta {
  id: string;
  name: string;
  mime: string;
  createdAt: number;
  notes: string;
  wallHint?: WallId;
  widthPx?: number;
  heightPx?: number;
  calibration?: PhotoCalibration;
  markers: PhotoMarker[];
  /** photo = still; video-frame = extracted still from a video. */
  kind?: "photo" | "video-frame";
  sourceVideoId?: string;
  sourceFilename?: string;
  timestampMs?: number;
  extractionMethod?: "video-seek-canvas" | "video-play-canvas" | "video-webcodecs";
}

export type VideoErrorCode =
  | "VIDEO_UNSUPPORTED"
  | "VIDEO_DECODE_FAILED"
  | "VIDEO_TOO_LARGE"
  | "VIDEO_ZERO_DURATION"
  | "VIDEO_CANCELLED";

export type VideoStatus = "processing" | "ready" | "failed" | "cancelled";

/** Metadata only. Raw source video is NOT persisted (size policy). */
export interface RealityVideoMeta {
  id: string;
  name: string;
  mime: string;
  createdAt: number;
  durationMs: number;
  widthPx: number;
  heightPx: number;
  status: VideoStatus;
  error?: VideoErrorCode;
  frameIds: string[];
  selectedFrameIds: string[];
  /** Always false — raw bytes are discarded after frame extraction. */
  persistRaw: false;
}

export interface AsBuiltObject {
  id: string;
  kind: AsBuiltKind;
  name: string;
  x: number;
  y: number;
  z: number;
  widthM: number;
  heightM: number;
  depthM: number;
  provenance: DimProvenance;
  photoId?: string;
  findingId?: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
}

export interface RealityFinding {
  id: string;
  kind: RealityFindingKind;
  summary: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  status: "PENDING" | "ADDED" | "IGNORED";
  estimated?: Omit<AsBuiltObject, "id" | "photoId">;
  opening?: Opening;
  wallResize?: { wallId: WallId; lengthM: number };
  photoId?: string;
  /** True when required geometry is missing — fail-closed on ADD. */
  incomplete?: boolean;
  missing?: string[];
}

export interface RealityState {
  photos: RealityPhotoMeta[];
  videos: RealityVideoMeta[];
  findings: RealityFinding[];
  asBuilt: AsBuiltObject[];
  compareMode: "as-designed" | "as-built" | "deviation";
  interview: Array<{ id: string; q: string; a?: string }>;
}

export function emptyReality(): RealityState {
  return { photos: [], videos: [], findings: [], asBuilt: [], compareMode: "as-designed", interview: [] };
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  room: RoomGeometry;
  openings: Opening[];
  ventilation: {
    components: VentComponent[];
    dirtyFilter: boolean;
    dirtyFilterExtraPa: number;
    outdoorTempC: number;
  };
  electrical: ElectricalSupply;
  fleet: Fleet;
  racks: Rack[];
  fans: FanInstance[];
  thermal: ThermalSettings;
  constraints: Constraints;
  lockedObjectIds: string[];
  notes?: string;
  reality?: RealityState;
}

export interface CalcTrace {
  id: string;
  label: string;
  formula: string;
  inputs: Record<string, number | string>;
  raw: number;
  unit: string;
  display: string;
}

export interface ComponentLoss {
  componentId: string;
  name: string;
  kind: VentKind;
  flowM3h: number;
  areaM2: number;
  velocityMs: number;
  dynamicPa: number;
  frictionPa: number;
  localPa: number;
  extraPa: number;
  totalPa: number;
  dhM: number;
}

export interface CapacitySlot {
  kind: BottleneckKind;
  label: string;
  value: number | null;
  known: boolean;
  detail: string;
  trace: CalcTrace[];
}

export interface EngineeringResult {
  geometry: {
    floorAreaM2: number;
    volumeM3: number;
    perimeterM: number;
    valid: boolean;
  };
  openings: {
    valid: boolean;
    items: Array<{
      id: string;
      areaM2: number;
      topElevationM: number;
      insideWall: boolean;
      errors: string[];
    }>;
  };
  electrical: {
    asic: AsicSpec | null;
    typicalTotalW: number;
    designTotalW: number;
    typicalCurrentA: number;
    designCurrentA: number;
    l1Count: number;
    l2Count: number;
    l3Count: number;
    l1CurrentA: number;
    l2CurrentA: number;
    l3CurrentA: number;
    imbalanceAsic: number;
    remainingTypicalW: number | null;
    remainingDesignW: number | null;
    typicalPass: boolean | null;
    designPass: boolean | null;
    maxByTypical: number | null;
    maxByDesign: number | null;
    usableCapacityW: number | null;
    hashrateThs: number;
    totalWeightKg: number;
    supplyVoltageCompatible: boolean | null;
    traces: CalcTrace[];
  };
  thermal: {
    asicHeatW: number;
    auxiliaryHeatW: number;
    totalHeatW: number;
    thermalAirflowM3s: number;
    thermalAirflowM3h: number;
    equipmentAirflowM3h: number;
    designAirflowM3h: number;
    designAirflowM3s: number;
    dominant: "thermal" | "equipment" | "none";
    traces: CalcTrace[];
  };
  pressure: {
    components: ComponentLoss[];
    totalPa: number;
    systemK: number;
    traces: CalcTrace[];
    dirtyExtraPa?: number;
  };
  fan: {
    instances: FanInstance[];
    combinedLabel: string;
    operatingQ_m3h: number | null;
    operatingP_pa: number | null;
    requiredQ_m3h: number;
    requiredP_pa: number;
    pass: boolean | null;
    dirtyPass: boolean | null;
    cleanQ_m3h: number | null;
    dirtyQ_m3h: number | null;
    marginM3h: number | null;
    reason: string;
    curve: FanCurvePoint[];
    systemCurve: FanCurvePoint[];
  };
  racks: {
    perRackCapacity: Array<{ id: string; perShelf: number; total: number; blocked: boolean }>;
    totalCapacity: number;
    usableCapacity: number;
    collisions: Array<{ a: string; b: string; overlapM: number; reason: string }>;
    wallHits: Array<{ id: string; reason: string }>;
    doorHits: Array<{ id: string; reason: string }>;
    ceilingHits: Array<{ id: string; reason: string }>;
    clearanceHits: Array<{ id: string; reason: string }>;
    recirculation: Array<{ from: string; to: string; distanceM: number }>;
    placedAsics: number;
    asBuiltHits: Array<{ id: string; objectId: string; reason: string }>;
  };
  floor: {
    known: boolean;
    limitPa: number | null;
    model: "NET_EQUIPMENT_PAYLOAD";
    g: number;
    asicWeightKg: number | null;
    racksUsed: Array<{ id: string; footprintM2: number; allowableN: number; maxAsic: number; blocked: boolean }>;
    totalPayloadN: number | null;
    maxByFloor: number | null;
    pass: boolean | null;
    reason: string;
    traces: CalcTrace[];
  };
  capacity: {
    requested: number;
    slots: CapacitySlot[];
    safe: number | null;
    bottlenecks: BottleneckKind[];
    confidence: SafeConfidence;
    status: ProjectStatus;
    safety: HudSafetyKind;
    verified: boolean;
    why: CalcTrace[];
  };
  warnings: Warning[];
  missing: Array<{ key: string; complete: boolean; impact: number; question: string }>;
}
