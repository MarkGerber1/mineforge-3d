/**
 * Reality geometry pipeline — Deterministic Engineering Core.
 *
 * Photos are visual evidence. A known A–B distance sets an isotropic
 * photo-plane scale (m/px). That scale is NOT photogrammetry and MUST NOT
 * be labeled centimetre-accurate. Derived lengths stay PHOTO_ESTIMATE until
 * the user confirms (USER_CONFIRMED) or the length itself was typed
 * (FIELD_MEASUREMENT). Canonical openings / room / as-built change only on
 * applyFinding(..., "ADDED").
 */
import { MAX_ROOM_DIM_M, MIN_ROOM_DIM_M } from "./constants.ts";
import { resizeRectangularRoom, validateOpening, type Aabb } from "./geometry.ts";
import type {
  AsBuiltKind,
  AsBuiltObject,
  DimProvenance,
  Opening,
  OpeningType,
  PhotoCalibration,
  PhotoMarker,
  PhotoMarkerKind,
  Project,
  RealityFinding,
  RealityFindingKind,
  RealityPhotoMeta,
  RealityVideoMeta,
  RealityState,
  WallId,
} from "./types.ts";
import { emptyReality } from "./types.ts";

export const DOOR_DEFAULT_HEIGHT_M = 2.1;
export const SHAFT_DEFAULT_HEIGHT_M = 0.9;
export const BEAM_SECTION_M = 0.3;
export const COLUMN_SECTION_M = 0.4;
export const DEFAULT_PHOTO_PX = 1000;

export function ensureReality(project: Project): RealityState {
  return project.reality ?? emptyReality();
}

export function photoSize(photo: RealityPhotoMeta): { widthPx: number; heightPx: number } {
  return {
    widthPx: photo.widthPx && photo.widthPx > 0 ? photo.widthPx : DEFAULT_PHOTO_PX,
    heightPx: photo.heightPx && photo.heightPx > 0 ? photo.heightPx : DEFAULT_PHOTO_PX,
  };
}

export function pixelDistance(
  a: { nx: number; ny: number },
  b: { nx: number; ny: number },
  widthPx: number,
  heightPx: number,
): number {
  return Math.hypot((b.nx - a.nx) * widthPx, (b.ny - a.ny) * heightPx);
}

export function calibrateFromKnownDistance(
  photo: RealityPhotoMeta,
  a: PhotoMarker,
  b: PhotoMarker,
  lengthM: number,
): PhotoCalibration | null {
  if (!(lengthM > 0) || !Number.isFinite(lengthM)) return null;
  const { widthPx, heightPx } = photoSize(photo);
  const d = pixelDistance(a, b, widthPx, heightPx);
  if (d < 1e-9) return null;
  return {
    scaleMPerPx: lengthM / d,
    lengthM,
    aId: a.id,
    bId: b.id,
    provenance: "FIELD_MEASUREMENT",
  };
}

export function photoCalibration(photo: RealityPhotoMeta): PhotoCalibration | null {
  if (photo.calibration && photo.calibration.scaleMPerPx > 0) return photo.calibration;
  const { widthPx, heightPx } = photoSize(photo);
  for (const m of photo.markers) {
    if (!(m.lengthM && m.lengthM > 0) || !m.pairId) continue;
    const other = photo.markers.find((x) => x.id === m.pairId);
    if (!other) continue;
    const d = pixelDistance(other, m, widthPx, heightPx);
    if (d < 1e-9) continue;
    return {
      scaleMPerPx: m.lengthM / d,
      lengthM: m.lengthM,
      aId: other.id,
      bId: m.id,
      provenance: m.provenance === "FIELD_MEASUREMENT" ? "FIELD_MEASUREMENT" : "PHOTO_ESTIMATE",
    };
  }
  return null;
}

export function measurePairMeters(
  photo: RealityPhotoMeta,
  a: PhotoMarker,
  b: PhotoMarker,
): { lengthM: number; provenance: DimProvenance } | null {
  if (a.lengthM && a.lengthM > 0) {
    return { lengthM: a.lengthM, provenance: a.provenance ?? "PHOTO_ESTIMATE" };
  }
  if (b.lengthM && b.lengthM > 0) {
    return { lengthM: b.lengthM, provenance: b.provenance ?? "PHOTO_ESTIMATE" };
  }
  const cal = photoCalibration(photo);
  if (!cal) return null;
  const { widthPx, heightPx } = photoSize(photo);
  const d = pixelDistance(a, b, widthPx, heightPx);
  if (d < 1e-9) return null;
  return { lengthM: d * cal.scaleMPerPx, provenance: "PHOTO_ESTIMATE" };
}

/** Metres along the wall from the left edge of the photo (PHOTO_ESTIMATE origin). */
export function alongWallM(photo: RealityPhotoMeta, nx: number): number | null {
  const cal = photoCalibration(photo);
  if (!cal) return null;
  return nx * photoSize(photo).widthPx * cal.scaleMPerPx;
}

export function pairHorizontalM(photo: RealityPhotoMeta, a: PhotoMarker, b: PhotoMarker): number | null {
  const cal = photoCalibration(photo);
  if (!cal) return null;
  return Math.abs(b.nx - a.nx) * photoSize(photo).widthPx * cal.scaleMPerPx;
}

export function pairVerticalM(photo: RealityPhotoMeta, a: PhotoMarker, b: PhotoMarker): number | null {
  const cal = photoCalibration(photo);
  if (!cal) return null;
  return Math.abs(b.ny - a.ny) * photoSize(photo).heightPx * cal.scaleMPerPx;
}

export function asBuiltPlanAabb(obj: AsBuiltObject): Aabb {
  return { x1: obj.x, y1: obj.y, x2: obj.x + obj.widthM, y2: obj.y + obj.depthM };
}

function placeOnWall(
  project: Project,
  wall: WallId,
  offsetM: number,
  alongM: number,
  intoRoomM: number,
): { x: number; y: number; widthM: number; depthM: number } {
  const w = project.room.widthM;
  const d = project.room.depthM;
  const along = Math.max(alongM, 1e-6);
  const into = Math.max(intoRoomM, 1e-6);
  switch (wall) {
    case "south":
      return { x: offsetM, y: 0, widthM: along, depthM: into };
    case "north":
      return { x: offsetM, y: Math.max(0, d - into), widthM: along, depthM: into };
    case "west":
      return { x: 0, y: offsetM, widthM: into, depthM: along };
    case "east":
      return { x: Math.max(0, w - into), y: offsetM, widthM: into, depthM: along };
  }
}

function findingKindFromMarker(kind: PhotoMarkerKind): RealityFindingKind {
  if (kind === "door") return "door";
  if (kind === "opening") return "opening";
  if (kind === "shaft") return "shaft";
  if (kind === "wall") return "wall";
  if (kind === "beam") return "beam";
  if (kind === "column") return "column";
  if (kind === "duct") return "duct";
  return "other";
}

function openingTypeFor(kind: RealityFindingKind): OpeningType | null {
  if (kind === "door") return "DOOR";
  if (kind === "shaft") return "EXHAUST";
  if (kind === "opening") return "TECHNICAL";
  return null;
}

function asBuiltKindFor(kind: RealityFindingKind): AsBuiltKind {
  if (kind === "beam" || kind === "column" || kind === "duct" || kind === "other") return kind;
  if (kind === "obstruction") return "obstruction";
  return "obstruction";
}

function resizeByWallLength(project: Project, wallId: WallId, lengthM: number): Project {
  if (wallId === "south" || wallId === "north") return resizeRectangularRoom(project, "east", lengthM);
  return resizeRectangularRoom(project, "north", lengthM);
}

export function buildFindingFromPair(
  project: Project,
  photo: RealityPhotoMeta,
  a: PhotoMarker,
  b: PhotoMarker,
  kind: PhotoMarkerKind,
): RealityFinding | null {
  if (kind === "point") return null;
  const measured = measurePairMeters(photo, a, b);
  if (!measured) return null;
  const wall = photo.wallHint;
  const horiz = pairHorizontalM(photo, a, b);
  const vert = pairVerticalM(photo, a, b);
  const offset = alongWallM(photo, Math.min(a.nx, b.nx));
  const fKind = findingKindFromMarker(kind);
  const id = `find_${b.id}`;
  const conf: RealityFinding["confidence"] = measured.provenance === "FIELD_MEASUREMENT" ? "HIGH" : "MEDIUM";

  if (fKind === "wall") {
    if (!wall) return null;
    return {
      id,
      kind: "wall",
      summary: `Длина стены ${wall}: ${measured.lengthM.toFixed(3)} m (${measured.provenance})`,
      confidence: conf,
      status: "PENDING",
      photoId: photo.id,
      wallResize: { wallId: wall, lengthM: measured.lengthM },
    };
  }

  const openingType = openingTypeFor(fKind);
  if (openingType) {
    if (!wall || offset == null) return null;
    const widthM = horiz != null && horiz > 0.05 ? horiz : measured.lengthM;
    const defaultH = fKind === "door" ? DOOR_DEFAULT_HEIGHT_M : SHAFT_DEFAULT_HEIGHT_M;
    const heightFromPhoto = vert != null && vert > 0.2;
    const heightM = heightFromPhoto ? vert! : defaultH;
    const bottomElevationM = 0;
    const opening: Opening = {
      id: `op_${id}`,
      type: openingType,
      wallId: wall,
      widthM,
      heightM,
      bottomElevationM,
      offsetFromWallStartM: offset,
      name: fKind === "door" ? "Дверь (Reality)" : fKind === "shaft" ? "Шахта (Reality)" : "Проём (Reality)",
      provenance: heightFromPhoto ? measured.provenance : "PHOTO_ESTIMATE",
      sourcePhotoId: photo.id,
      sourceFindingId: id,
    };
    return {
      id,
      kind: fKind,
      summary: `${opening.name}: ${widthM.toFixed(3)} × ${heightM.toFixed(3)} m на ${wall}, offset ${offset.toFixed(3)} m`,
      confidence: heightFromPhoto ? conf : "MEDIUM",
      status: "PENDING",
      photoId: photo.id,
      opening,
    };
  }

  if (!wall || offset == null) return null;
  const along = horiz != null && horiz > 0.05 ? horiz : measured.lengthM;
  const into = fKind === "column" ? COLUMN_SECTION_M : BEAM_SECTION_M;
  const box = placeOnWall(project, wall, offset, fKind === "column" ? COLUMN_SECTION_M : along, into);
  const z = fKind === "beam" ? Math.max(0, project.room.heightM - BEAM_SECTION_M) : 0;
  const heightM = fKind === "beam" ? BEAM_SECTION_M : project.room.heightM;
  const estimated: Omit<AsBuiltObject, "id" | "photoId"> = {
    kind: asBuiltKindFor(fKind),
    name:
      fKind === "beam"
        ? "Балка (Reality)"
        : fKind === "column"
          ? "Колонна (Reality)"
          : fKind === "duct"
            ? "Короб (Reality)"
            : "Препятствие (Reality)",
    x: box.x,
    y: box.y,
    z,
    widthM: box.widthM,
    heightM,
    depthM: box.depthM,
    provenance: measured.provenance === "FIELD_MEASUREMENT" ? "PHOTO_ESTIMATE" : measured.provenance,
    findingId: id,
    confidence: "MEDIUM",
  };
  return {
    id,
    kind: fKind,
    summary: `${estimated.name}: ${estimated.widthM.toFixed(3)} × ${estimated.depthM.toFixed(3)} m @ (${estimated.x.toFixed(3)}, ${estimated.y.toFixed(3)})`,
    confidence: "MEDIUM",
    status: "PENDING",
    photoId: photo.id,
    estimated,
  };
}

export function recordAnnotation(
  project: Project,
  photoId: string,
  a: PhotoMarker,
  b: PhotoMarker,
  opts: { knownLengthM?: number; kind: PhotoMarkerKind },
): { project: Project; finding: RealityFinding | null; calibration: PhotoCalibration | null } {
  const reality = ensureReality(project);
  const photo = reality.photos.find((p) => p.id === photoId);
  if (!photo) return { project, finding: null, calibration: null };

  const known = opts.knownLengthM && opts.knownLengthM > 0 ? opts.knownLengthM : undefined;
  const bMarked: PhotoMarker = {
    ...b,
    kind: opts.kind,
    pairId: a.id,
    lengthM: known,
    provenance: known ? "FIELD_MEASUREMENT" : b.provenance,
  };
  const aMarked: PhotoMarker = { ...a, kind: opts.kind, pairId: b.id };
  let nextPhoto: RealityPhotoMeta = {
    ...photo,
    markers: [...photo.markers, aMarked, bMarked],
  };
  let calibration: PhotoCalibration | null = photoCalibration(nextPhoto);
  if (known) {
    calibration = calibrateFromKnownDistance(nextPhoto, aMarked, bMarked, known);
    if (calibration) nextPhoto = { ...nextPhoto, calibration };
  }
  const finding = buildFindingFromPair(project, nextPhoto, aMarked, bMarked, opts.kind);
  const photos = reality.photos.map((p) => (p.id === photoId ? nextPhoto : p));
  const findings = finding ? [...reality.findings, finding] : reality.findings;
  return {
    project: {
      ...project,
      updatedAt: project.updatedAt,
      reality: { ...reality, photos, findings },
    },
    finding,
    calibration,
  };
}

export interface ApplyFindingResult {
  project: Project;
  ok: boolean;
  errors: string[];
}

export function applyFinding(project: Project, findingId: string, status: "ADDED" | "IGNORED"): ApplyFindingResult {
  const reality = ensureReality(project);
  const finding = reality.findings.find((f) => f.id === findingId);
  if (!finding) return { project, ok: false, errors: ["Finding not found"] };
  if (finding.status !== "PENDING") return { project, ok: false, errors: ["Finding already resolved"] };

  const findings = reality.findings.map((f) => (f.id === findingId ? { ...f, status } : f));

  if (status === "IGNORED") {
    return {
      project: { ...project, reality: { ...reality, findings } },
      ok: true,
      errors: [],
    };
  }

  if (finding.incomplete || (finding.missing && finding.missing.length)) {
    return {
      project,
      ok: false,
      errors: [`Incomplete geometry: ${(finding.missing ?? ["unknown"]).join(", ")}. Canonical state unchanged.`],
    };
  }

  if (finding.wallResize) {
    const { wallId, lengthM } = finding.wallResize;
    if (lengthM < MIN_ROOM_DIM_M || lengthM > MAX_ROOM_DIM_M) {
      return { project, ok: false, errors: [`Wall length ${lengthM} m is outside ${MIN_ROOM_DIM_M}–${MAX_ROOM_DIM_M} m`] };
    }
    const resized = resizeByWallLength(project, wallId, lengthM);
    return {
      project: {
        ...resized,
        reality: { ...(resized.reality ?? reality), findings },
      },
      ok: true,
      errors: [],
    };
  }

  if (finding.opening) {
    const opening: Opening = {
      ...finding.opening,
      provenance: finding.opening.provenance === "FIELD_MEASUREMENT" ? "FIELD_MEASUREMENT" : "USER_CONFIRMED",
    };
    const isExhaust = opening.type === "EXHAUST" || opening.type === "SHAFT_CONNECTION";
    const existingIdx = isExhaust
      ? project.openings.findIndex((o) => o.type === "EXHAUST" || o.type === "SHAFT_CONNECTION")
      : -1;
    const candidate: Opening =
      existingIdx >= 0
        ? {
            ...project.openings[existingIdx],
            widthM: opening.widthM,
            heightM: opening.heightM,
            bottomElevationM: opening.bottomElevationM,
            provenance: opening.provenance,
            sourcePhotoId: opening.sourcePhotoId,
            sourceFindingId: opening.sourceFindingId,
          }
        : opening;
    const v = validateOpening(
      { ...project, openings: existingIdx >= 0 ? project.openings.filter((_, i) => i !== existingIdx) : project.openings },
      candidate,
    );
    if (!v.ok) return { project, ok: false, errors: v.errors };
    const openings =
      existingIdx >= 0
        ? project.openings.map((o, i) => (i === existingIdx ? candidate : o))
        : [...project.openings, candidate];
    return {
      project: {
        ...project,
        openings,
        reality: { ...reality, findings },
      },
      ok: true,
      errors: [],
    };
  }

  if (finding.estimated) {
    const obj: AsBuiltObject = {
      id: `ab_${finding.id}`,
      photoId: finding.photoId,
      findingId: finding.id,
      ...finding.estimated,
      provenance: "USER_CONFIRMED",
    };
    return {
      project: {
        ...project,
        reality: { ...reality, findings, asBuilt: [...reality.asBuilt, obj], compareMode: "as-built" },
      },
      ok: true,
      errors: [],
    };
  }

  return { project, ok: false, errors: ["Finding has no geometry"] };
}

export function pendingFindings(project: Project): RealityFinding[] {
  return ensureReality(project).findings.filter((f) => f.status === "PENDING");
}

const FINDING_KINDS: RealityFindingKind[] = [
  "beam",
  "column",
  "obstruction",
  "duct",
  "other",
  "door",
  "opening",
  "shaft",
  "wall",
];

function parseWallId(v: unknown): WallId | null {
  return v === "north" || v === "south" || v === "east" || v === "west" ? v : null;
}

/** Finite number only. No string coercion, no `|| 1` fallback. */
function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function requirePositive(v: unknown, name: string, missing: string[]): number | null {
  const n = finiteNumber(v);
  if (n == null || n <= 0) {
    missing.push(name);
    return null;
  }
  return n;
}

function requireNonNegative(v: unknown, name: string, missing: string[]): number | null {
  const n = finiteNumber(v);
  if (n == null || n < 0) {
    missing.push(name);
    return null;
  }
  return n;
}

/**
 * Validate an AI Reality observation into a PENDING finding.
 * Incomplete geometry stays PENDING with `incomplete`/`missing`.
 * Never mutates Project. Never invents coordinates.
 */
export function parseAiFinding(raw: unknown, id: string): RealityFinding {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kindRaw = typeof obj.kind === "string" ? obj.kind : "other";
  const kind: RealityFindingKind = FINDING_KINDS.includes(kindRaw as RealityFindingKind)
    ? (kindRaw as RealityFindingKind)
    : "other";
  const summary =
    typeof obj.summary === "string" && obj.summary.trim().length > 0 ? obj.summary.trim() : kind;
  const confidence: RealityFinding["confidence"] =
    obj.confidence === "HIGH" || obj.confidence === "MEDIUM" ? obj.confidence : "LOW";
  const missing: string[] = [];

  if (kind === "wall") {
    const wallId = parseWallId(obj.wallId);
    if (!wallId) missing.push("wallId");
    const lengthSource = obj.lengthM !== undefined ? obj.lengthM : obj.widthM;
    const lengthM = requirePositive(lengthSource, "lengthM", missing);
    return {
      id,
      kind: "wall",
      summary,
      confidence,
      status: "PENDING",
      incomplete: missing.length > 0,
      missing: missing.length ? missing : undefined,
      wallResize: wallId && lengthM != null ? { wallId, lengthM } : undefined,
    };
  }

  const openingType = openingTypeFor(kind);
  if (openingType) {
    const wallId = parseWallId(obj.wallId);
    if (!wallId) missing.push("wallId");
    const widthM = requirePositive(obj.widthM, "widthM", missing);
    const heightM = requirePositive(obj.heightM, "heightM", missing);
    const offsetFromWallStartM = requireNonNegative(
      obj.offsetFromWallStartM,
      "offsetFromWallStartM",
      missing,
    );
    let bottomElevationM: number | null;
    if (kind === "door" && finiteNumber(obj.bottomElevationM) == null) {
      bottomElevationM = 0;
    } else {
      bottomElevationM = requireNonNegative(obj.bottomElevationM, "bottomElevationM", missing);
    }
    const incomplete = missing.length > 0;
    const opening: Opening | undefined =
      !incomplete &&
      wallId &&
      widthM != null &&
      heightM != null &&
      offsetFromWallStartM != null &&
      bottomElevationM != null
        ? {
            id: `op_${id}`,
            type: openingType,
            wallId,
            widthM,
            heightM,
            bottomElevationM,
            offsetFromWallStartM,
            name:
              kind === "door"
                ? "Дверь (AI Reality)"
                : kind === "shaft"
                  ? "Шахта (AI Reality)"
                  : "Проём (AI Reality)",
            provenance: "PHOTO_ESTIMATE",
            sourceFindingId: id,
          }
        : undefined;
    return {
      id,
      kind,
      summary,
      confidence,
      status: "PENDING",
      incomplete,
      missing: missing.length ? missing : undefined,
      opening,
    };
  }

  const x = requireNonNegative(obj.x, "x", missing);
  const y = requireNonNegative(obj.y, "y", missing);
  const z = requireNonNegative(obj.z, "z", missing);
  const widthM = requirePositive(obj.widthM, "widthM", missing);
  const heightM = requirePositive(obj.heightM, "heightM", missing);
  const depthM = requirePositive(obj.depthM, "depthM", missing);
  const incomplete = missing.length > 0;
  const estimated: RealityFinding["estimated"] =
    !incomplete &&
    x != null &&
    y != null &&
    z != null &&
    widthM != null &&
    heightM != null &&
    depthM != null
      ? {
          kind: asBuiltKindFor(kind),
          name: summary,
          x,
          y,
          z,
          widthM,
          heightM,
          depthM,
          provenance: "PHOTO_ESTIMATE",
          findingId: id,
          confidence,
        }
      : undefined;
  return {
    id,
    kind,
    summary,
    confidence,
    status: "PENDING",
    incomplete,
    missing: missing.length ? missing : undefined,
    estimated,
  };
}

/**
 * Attach extracted video frames as Reality photo evidence.
 * Does not touch openings, racks, room, or as-built. User ADD is still required.
 */
export function attachVideoFrames(
  project: Project,
  video: RealityVideoMeta,
  frames: RealityPhotoMeta[],
): Project {
  const reality = ensureReality(project);
  const photos = [...reality.photos];
  for (const f of frames) {
    if (!photos.some((p) => p.id === f.id)) photos.push(f);
  }
  const videos = [...(reality.videos ?? []).filter((v) => v.id !== video.id), video];
  return {
    ...project,
    reality: { ...reality, photos, videos },
  };
}

export function geometryFingerprint(project: Project): string {
  return JSON.stringify({
    room: project.room,
    openings: project.openings,
    racks: project.racks.map((r) => ({ id: r.id, x: r.x, y: r.y, widthM: r.widthM, depthM: r.depthM, heightM: r.heightM })),
    asBuilt: (project.reality?.asBuilt ?? []).map((o) => ({
      id: o.id,
      x: o.x,
      y: o.y,
      z: o.z,
      widthM: o.widthM,
      heightM: o.heightM,
      depthM: o.depthM,
    })),
  });
}
