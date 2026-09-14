/**
 * ONE central Photo ↔ Canonical adapter.
 *
 * After APPLY, the canonical Project object is the engineering source of truth.
 * A linked overlay is a derived view. Photo / 2D / 3D / Inspector / AI / Undo
 * all mutate canonical state; overlays are reconciled from that state.
 *
 * PHASE 1 wall-plane model. Not photogrammetry. Do not invent depth.
 */
import { fanIsSpatiallyValid, rackAabb, validateOpening, wallLength } from "./geometry.ts";
import { validateRackPlacement } from "./placement.ts";
import { alongWallM, photoCalibration, photoSize } from "./reality.ts";
import { placeOnWall, PHOTO_OVERLAY_LABEL_RU } from "./photo-overlay.ts";
import { reassignOpeningWall } from "./wall-reassign.ts";
import { clamp01, clampNormSize } from "./photo-frame.ts";
import type {
  AsBuiltObject,
  FanInstance,
  Opening,
  OverlayMetricSource,
  PhotoOverlayObject,
  Project,
  RealityPhotoMeta,
  WallId,
} from "./types.ts";
import { emptyReality } from "./types.ts";

const WALL_FLUSH_M = 0.25;

export const OUT_OF_PLANE_RU =
  "Объект перенесён на другую стену и больше не проецируется на это фото.";

export function isLinkedOverlay(o: PhotoOverlayObject): boolean {
  return Boolean(o.applied && o.linkedObjectId);
}

export function overlayMetersFromNormalized(
  photo: RealityPhotoMeta,
  nw: number,
  nh: number,
): { widthM: number; heightM: number } | null {
  const cal = photoCalibration(photo);
  if (!cal) return null;
  const { widthPx, heightPx } = photoSize(photo);
  const widthM = nw * widthPx * cal.scaleMPerPx;
  const heightM = nh * heightPx * cal.scaleMPerPx;
  if (!(widthM > 0) || !(heightM > 0)) return null;
  return { widthM, heightM };
}

export function overlayNormalizedFromMeters(
  photo: RealityPhotoMeta,
  widthM: number,
  heightM: number,
): { nw: number; nh: number } | null {
  const cal = photoCalibration(photo);
  if (!cal) return null;
  const { widthPx, heightPx } = photoSize(photo);
  const sx = widthPx * cal.scaleMPerPx;
  const sy = heightPx * cal.scaleMPerPx;
  if (!(sx > 1e-12) || !(sy > 1e-12)) return null;
  return {
    nw: clampNormSize(widthM / sx),
    nh: clampNormSize(heightM / sy),
  };
}

/** Visual resize. Calibrated → meters. Uncalibrated → visual-only, meters unchanged. */
export function applyVisualResize(
  photo: RealityPhotoMeta,
  overlay: PhotoOverlayObject,
  nw: number,
  nh: number,
): PhotoOverlayObject {
  const nextNw = clampNormSize(nw);
  const nextNh = clampNormSize(nh);
  const meters = overlayMetersFromNormalized(photo, nextNw, nextNh);
  if (!meters) {
    return { ...overlay, nw: nextNw, nh: nextNh };
  }
  return {
    ...overlay,
    nw: nextNw,
    nh: nextNh,
    widthM: meters.widthM,
    heightM: meters.heightM,
    metricSource: "CALIBRATED",
  };
}

export function overlayOffsetFromNx(
  photo: RealityPhotoMeta,
  nx: number,
  wall: WallId,
  project: Project,
): number {
  const along = alongWallM(photo, nx);
  if (along != null && Number.isFinite(along)) return Math.max(0, along);
  return nx * wallLength(project, wall);
}

export function overlayElevationFromNy(
  photo: RealityPhotoMeta,
  ny: number,
  nh: number,
): number | null {
  const cal = photoCalibration(photo);
  if (!cal) return null;
  const { heightPx } = photoSize(photo);
  const elev = (1 - ny - nh) * heightPx * cal.scaleMPerPx;
  if (!Number.isFinite(elev)) return null;
  return Math.max(0, elev);
}

function nxFromOffset(photo: RealityPhotoMeta, offsetM: number, wall: WallId, project: Project): number {
  const cal = photoCalibration(photo);
  if (cal) {
    const span = photoSize(photo).widthPx * cal.scaleMPerPx;
    if (span > 1e-12) return clamp01(offsetM / span);
  }
  const L = wallLength(project, wall);
  if (L > 1e-12) return clamp01(offsetM / L);
  return 0;
}

function nyFromElevation(photo: RealityPhotoMeta, bottomElevationM: number, nh: number): number {
  const cal = photoCalibration(photo);
  if (!cal) return clamp01(1 - nh);
  const span = photoSize(photo).heightPx * cal.scaleMPerPx;
  if (!(span > 1e-12)) return clamp01(1 - nh);
  return clamp01(1 - nh - bottomElevationM / span);
}

export type LinkedCanonical =
  | { kind: "opening"; object: Opening }
  | { kind: "rack"; object: Project["racks"][number] }
  | { kind: "fan"; object: FanInstance }
  | { kind: "asBuilt"; object: AsBuiltObject };

export function findLinkedCanonical(project: Project, overlay: PhotoOverlayObject): LinkedCanonical | null {
  const id = overlay.linkedObjectId;
  if (!id) return null;
  const opening = project.openings.find((o) => o.id === id);
  if (opening) return { kind: "opening", object: opening };
  const rack = project.racks.find((r) => r.id === id);
  if (rack) return { kind: "rack", object: rack };
  const fan = project.fans.find((f) => f.id === id);
  if (fan) return { kind: "fan", object: fan };
  const asBuilt = (project.reality?.asBuilt ?? []).find((a) => a.id === id);
  if (asBuilt) return { kind: "asBuilt", object: asBuilt };
  return null;
}

function distanceToWall(project: Project, aabb: { x1: number; y1: number; x2: number; y2: number }, wall: WallId): number {
  const { widthM: w, depthM: d } = project.room;
  switch (wall) {
    case "south":
      return aabb.y1;
    case "north":
      return d - aabb.y2;
    case "west":
      return aabb.x1;
    case "east":
      return w - aabb.x2;
  }
}

function offsetAlongWallFromAabb(
  aabb: { x1: number; y1: number; x2: number; y2: number },
  wall: WallId,
): number {
  if (wall === "south" || wall === "north") return aabb.x1;
  return aabb.y1;
}

function objectOnPhotoWall(project: Project, photo: RealityPhotoMeta, linked: LinkedCanonical): boolean {
  const wall = photo.wallHint;
  if (!wall) return false;
  if (linked.kind === "opening") return linked.object.wallId === wall;
  if (linked.kind === "rack") {
    return distanceToWall(project, rackAabb(linked.object), wall) <= WALL_FLUSH_M;
  }
  if (linked.kind === "fan") {
    const f = linked.object;
    return distanceToWall(project, { x1: f.x, y1: f.y, x2: f.x + 0.8, y2: f.y + 0.8 }, wall) <= WALL_FLUSH_M + 0.4;
  }
  const a = linked.object;
  return distanceToWall(project, { x1: a.x, y1: a.y, x2: a.x + a.widthM, y2: a.y + a.depthM }, wall) <= WALL_FLUSH_M + 0.4;
}

function alongWidthOf(linked: LinkedCanonical, wall: WallId): number {
  if (linked.kind === "opening") return linked.object.widthM;
  if (linked.kind === "rack") {
    const bb = rackAabb(linked.object);
    return wall === "south" || wall === "north" ? bb.x2 - bb.x1 : bb.y2 - bb.y1;
  }
  if (linked.kind === "fan") return 0.8;
  const a = linked.object;
  return wall === "south" || wall === "north" ? a.widthM : a.depthM;
}

function heightOf(linked: LinkedCanonical): number {
  if (linked.kind === "opening") return linked.object.heightM;
  if (linked.kind === "rack") return linked.object.heightM;
  if (linked.kind === "fan") return 0.4;
  return linked.object.heightM;
}

function elevationOf(linked: LinkedCanonical): number {
  if (linked.kind === "opening") return linked.object.bottomElevationM;
  if (linked.kind === "asBuilt") return linked.object.z;
  return 0;
}

function rotationOf(linked: LinkedCanonical): 0 | 90 | 180 | 270 {
  if (linked.kind === "rack") {
    const r = ((linked.object.rotationDeg % 360) + 360) % 360;
    if (r === 90 || r === 180 || r === 270) return r;
    return 0;
  }
  return 0;
}

function wallOf(linked: LinkedCanonical, photo: RealityPhotoMeta): WallId | undefined {
  if (linked.kind === "opening") return linked.object.wallId;
  return photo.wallHint;
}

function reconcileOne(
  project: Project,
  photo: RealityPhotoMeta,
  overlay: PhotoOverlayObject,
): PhotoOverlayObject {
  if (!isLinkedOverlay(overlay)) {
    return { ...overlay, planeStatus: overlay.planeStatus ?? "ON_PLANE" };
  }
  const linked = findLinkedCanonical(project, overlay);
  if (!linked) {
    return {
      ...overlay,
      applied: false,
      linkedObjectId: undefined,
      planeStatus: "ON_PLANE",
    };
  }
  const onPlane = objectOnPhotoWall(project, photo, linked);
  const wall = wallOf(linked, photo);
  const widthM = linked.kind === "opening" ? linked.object.widthM : linked.kind === "rack" ? linked.object.widthM : overlay.widthM;
  const heightM = heightOf(linked);
  const depthM =
    linked.kind === "rack"
      ? linked.object.depthM
      : linked.kind === "asBuilt"
        ? linked.object.depthM
        : overlay.depthM;
  const bottomElevationM = elevationOf(linked);
  const rotationDeg = rotationOf(linked);
  const base: PhotoOverlayObject = {
    ...overlay,
    wallId: wall,
    widthM,
    heightM,
    depthM,
    bottomElevationM,
    rotationDeg,
    applied: true,
    linkedObjectId: overlay.linkedObjectId,
  };
  if (!onPlane || !photo.wallHint) {
    return { ...base, planeStatus: "OUT_OF_PHOTO_PLANE" };
  }
  const offsetM =
    linked.kind === "opening"
      ? linked.object.offsetFromWallStartM
      : linked.kind === "rack"
        ? offsetAlongWallFromAabb(rackAabb(linked.object), photo.wallHint)
        : linked.kind === "fan"
          ? offsetAlongWallFromAabb(
              { x1: linked.object.x, y1: linked.object.y, x2: linked.object.x + 0.8, y2: linked.object.y + 0.8 },
              photo.wallHint,
            )
          : offsetAlongWallFromAabb(
              {
                x1: linked.object.x,
                y1: linked.object.y,
                x2: linked.object.x + linked.object.widthM,
                y2: linked.object.y + linked.object.depthM,
              },
              photo.wallHint,
            );
  const nx = nxFromOffset(photo, offsetM, photo.wallHint, project);
  const norm = overlayNormalizedFromMeters(photo, alongWidthOf(linked, photo.wallHint), heightM);
  const nw = norm?.nw ?? overlay.nw;
  const nh = norm?.nh ?? overlay.nh;
  const ny = photoCalibration(photo) ? nyFromElevation(photo, bottomElevationM, nh) : overlay.ny;
  return {
    ...base,
    nx,
    ny,
    nw,
    nh,
    planeStatus: "ON_PLANE",
  };
}

/**
 * Canonical mutation → linked overlay representation.
 * Pure. Does not invent photogrammetry. Identity of overlays is preserved.
 */
export function reconcileLinkedReality(project: Project): Project {
  const reality = project.reality;
  if (!reality?.photos?.length) return project;
  let changed = false;
  const photos = reality.photos.map((photo) => {
    const overlays = photo.overlays;
    if (!overlays?.length) return photo;
    const next = overlays.map((o) => reconcileOne(project, photo, o));
    if (next.some((o, i) => o !== overlays[i])) {
      changed = true;
      return { ...photo, overlays: next };
    }
    return photo;
  });
  if (!changed) return project;
  return { ...project, reality: { ...reality, photos } };
}

export type PhotoOverlayIntent = Partial<
  Pick<
    PhotoOverlayObject,
    "nx" | "ny" | "nw" | "nh" | "widthM" | "heightM" | "depthM" | "bottomElevationM" | "wallId" | "rotationDeg" | "metricSource"
  >
>;

function withPhoto(project: Project, photo: RealityPhotoMeta): Project {
  const reality = project.reality ?? emptyReality();
  return {
    ...project,
    reality: {
      ...reality,
      photos: reality.photos.map((p) => (p.id === photo.id ? photo : p)),
    },
  };
}

function patchDraftOverlay(
  project: Project,
  photo: RealityPhotoMeta,
  overlay: PhotoOverlayObject,
  intent: PhotoOverlayIntent,
): Project {
  let next: PhotoOverlayObject = { ...overlay, ...intent, id: overlay.id, kind: overlay.kind };
  if (intent.nw != null || intent.nh != null) {
    next = applyVisualResize(photo, next, next.nw, next.nh);
  }
  if (intent.widthM != null || intent.heightM != null || intent.bottomElevationM != null || intent.depthM != null) {
    const source: OverlayMetricSource = intent.metricSource ?? "OWNER_ENTERED";
    next = { ...next, metricSource: source };
    const norm = overlayNormalizedFromMeters(photo, next.widthM, next.heightM);
    if (norm && (intent.widthM != null || intent.heightM != null)) {
      next = { ...next, nw: norm.nw, nh: norm.nh };
    }
  }
  const overlays = (photo.overlays ?? []).map((o) => (o.id === overlay.id ? next : o));
  return withPhoto(project, { ...photo, overlays });
}

function applyOpeningIntent(
  project: Project,
  photo: RealityPhotoMeta,
  overlay: PhotoOverlayObject,
  opening: Opening,
  intent: PhotoOverlayIntent,
): { ok: true; project: Project } | { ok: false; errors: string[] } {
  let nextOpening: Opening = { ...opening };
  const wall = intent.wallId ?? opening.wallId;
  if (intent.wallId && intent.wallId !== opening.wallId) {
    const r = reassignOpeningWall(project, opening.id, intent.wallId);
    if (!r.ok) return { ok: false, errors: r.errors };
    nextOpening = r.opening;
  }
  const visual = {
    nx: intent.nx ?? overlay.nx,
    ny: intent.ny ?? overlay.ny,
    nw: intent.nw ?? overlay.nw,
    nh: intent.nh ?? overlay.nh,
  };
  if (intent.nw != null || intent.nh != null) {
    const meters = overlayMetersFromNormalized(photo, visual.nw, visual.nh);
    if (meters) {
      nextOpening = { ...nextOpening, widthM: meters.widthM, heightM: meters.heightM };
    }
  }
  if (intent.widthM != null) nextOpening = { ...nextOpening, widthM: intent.widthM };
  if (intent.heightM != null) nextOpening = { ...nextOpening, heightM: intent.heightM };
  if (intent.bottomElevationM != null) nextOpening = { ...nextOpening, bottomElevationM: intent.bottomElevationM };
  else if (intent.ny != null || intent.nh != null) {
    const elev = overlayElevationFromNy(photo, visual.ny, visual.nh);
    if (elev != null) nextOpening = { ...nextOpening, bottomElevationM: elev };
  }
  if (intent.nx != null) {
    nextOpening = {
      ...nextOpening,
      offsetFromWallStartM: overlayOffsetFromNx(photo, visual.nx, nextOpening.wallId, project),
    };
  }
  const candidate = {
    ...project,
    openings: project.openings.map((o) => (o.id === opening.id ? nextOpening : o)),
  };
  const v = validateOpening(candidate, nextOpening);
  if (!v.ok) return { ok: false, errors: v.errors };
  void wall;
  return { ok: true, project: candidate };
}

function applyRackIntent(
  project: Project,
  photo: RealityPhotoMeta,
  overlay: PhotoOverlayObject,
  rack: Project["racks"][number],
  intent: PhotoOverlayIntent,
): { ok: true; project: Project } | { ok: false; errors: string[] } {
  const wall = intent.wallId ?? overlay.wallId ?? photo.wallHint;
  let next = { ...rack };
  if (intent.rotationDeg != null) next = { ...next, rotationDeg: intent.rotationDeg };
  if (intent.widthM != null) next = { ...next, widthM: intent.widthM };
  if (intent.heightM != null) next = { ...next, heightM: intent.heightM };
  if (intent.depthM != null) next = { ...next, depthM: intent.depthM };
  if (intent.nw != null || intent.nh != null) {
    const meters = overlayMetersFromNormalized(photo, intent.nw ?? overlay.nw, intent.nh ?? overlay.nh);
    if (meters) {
      next = { ...next, widthM: meters.widthM, heightM: meters.heightM };
    }
  }
  const moved = intent.nx != null || intent.wallId != null;
  if (moved) {
    if (!wall) return { ok: false, errors: ["Стойка: укажите стену фото."] };
    const nx = intent.nx ?? overlay.nx;
    const box = placeOnWall(
      project,
      wall,
      overlayOffsetFromNx(photo, nx, wall, project),
      next.widthM,
      next.depthM,
    );
    next = { ...next, x: box.x, y: box.y, widthM: box.widthM, depthM: box.depthM };
  }
  const candidate = { ...project, racks: project.racks.map((r) => (r.id === rack.id ? next : r)) };
  const v = validateRackPlacement(candidate, next, { ignoreIds: [rack.id] });
  if (!v.ok) return { ok: false, errors: v.errors };
  return { ok: true, project: candidate };
}

function applyFanIntent(
  project: Project,
  photo: RealityPhotoMeta,
  overlay: PhotoOverlayObject,
  fan: FanInstance,
  intent: PhotoOverlayIntent,
): { ok: true; project: Project } | { ok: false; errors: string[] } {
  const wall = intent.wallId ?? overlay.wallId ?? photo.wallHint;
  let next = { ...fan };
  if (intent.nx != null || intent.wallId != null) {
    if (!wall) return { ok: false, errors: ["Вентилятор: укажите стену фото."] };
    const nx = intent.nx ?? overlay.nx;
    const box = placeOnWall(
      project,
      wall,
      overlayOffsetFromNx(photo, nx, wall, project),
      overlay.widthM,
      overlay.depthM ?? 0.8,
    );
    next = { ...next, x: box.x, y: box.y };
  }
  const candidate = { ...project, fans: project.fans.map((f) => (f.id === fan.id ? next : f)) };
  if (!fanIsSpatiallyValid(candidate, next)) {
    return { ok: false, errors: ["Вентилятор должен быть внутри помещения."] };
  }
  return { ok: true, project: candidate };
}

function applyAsBuiltIntent(
  project: Project,
  photo: RealityPhotoMeta,
  overlay: PhotoOverlayObject,
  obj: AsBuiltObject,
  intent: PhotoOverlayIntent,
): { ok: true; project: Project } | { ok: false; errors: string[] } {
  const wall = intent.wallId ?? overlay.wallId ?? photo.wallHint;
  if (!wall) return { ok: false, errors: [`${PHOTO_OVERLAY_LABEL_RU[overlay.kind]}: укажите стену фото.`] };
  let widthM = intent.widthM ?? obj.widthM;
  let heightM = intent.heightM ?? obj.heightM;
  if (intent.nw != null || intent.nh != null) {
    const meters = overlayMetersFromNormalized(photo, intent.nw ?? overlay.nw, intent.nh ?? overlay.nh);
    if (meters) {
      widthM = meters.widthM;
      heightM = meters.heightM;
    }
  }
  const nx = intent.nx ?? overlay.nx;
  const box = placeOnWall(project, wall, overlayOffsetFromNx(photo, nx, wall, project), widthM, obj.depthM);
  const z = intent.bottomElevationM ?? obj.z;
  const next: AsBuiltObject = { ...obj, x: box.x, y: box.y, widthM: box.widthM, depthM: box.depthM, heightM, z };
  const reality = project.reality ?? emptyReality();
  return {
    ok: true,
    project: {
      ...project,
      reality: {
        ...reality,
        asBuilt: reality.asBuilt.map((a) => (a.id === obj.id ? next : a)),
      },
    },
  };
}

/**
 * Photo intent → canonical mutation adapter.
 * Draft overlays mutate overlay metadata only.
 * Linked overlays mutate the canonical object through validators, fail-closed.
 * Caller commits the returned project (reconcile happens in commit).
 */
export function photoIntentToCanonical(
  project: Project,
  photoId: string,
  overlayId: string,
  intent: PhotoOverlayIntent,
): { ok: true; project: Project } | { ok: false; errors: string[] } {
  const reality = project.reality ?? emptyReality();
  const photo = reality.photos.find((p) => p.id === photoId);
  if (!photo) return { ok: false, errors: ["Фото не найдено."] };
  const overlay = (photo.overlays ?? []).find((o) => o.id === overlayId);
  if (!overlay) return { ok: false, errors: ["Объект на фото не найден."] };

  if (!isLinkedOverlay(overlay)) {
    return { ok: true, project: patchDraftOverlay(project, photo, overlay, intent) };
  }

  const linked = findLinkedCanonical(project, overlay);
  if (!linked) {
    return { ok: true, project: patchDraftOverlay(project, photo, { ...overlay, applied: false, linkedObjectId: undefined }, intent) };
  }

  const geometric = intent.nx != null || intent.ny != null || intent.nw != null || intent.nh != null;
  if (overlay.planeStatus === "OUT_OF_PHOTO_PLANE" && geometric && intent.wallId == null) {
    return { ok: false, errors: [OUT_OF_PLANE_RU] };
  }

  if (linked.kind === "opening") return applyOpeningIntent(project, photo, overlay, linked.object, intent);
  if (linked.kind === "rack") return applyRackIntent(project, photo, overlay, linked.object, intent);
  if (linked.kind === "fan") return applyFanIntent(project, photo, overlay, linked.object, intent);
  return applyAsBuiltIntent(project, photo, overlay, linked.object, intent);
}

export function detachOverlayFromPhoto(project: Project, photoId: string, overlayId: string): Project {
  const reality = project.reality ?? emptyReality();
  return {
    ...project,
    reality: {
      ...reality,
      photos: reality.photos.map((p) =>
        p.id === photoId ? { ...p, overlays: (p.overlays ?? []).filter((o) => o.id !== overlayId) } : p,
      ),
    },
  };
}

export function deleteCanonicalByOverlay(
  project: Project,
  overlay: PhotoOverlayObject,
): Project {
  const id = overlay.linkedObjectId;
  if (!id) return project;
  const reality = project.reality ?? emptyReality();
  return {
    ...project,
    openings: project.openings.filter((o) => o.id !== id || o.locked),
    racks: project.racks.filter((r) => r.id !== id),
    fans: project.fans.filter((f) => f.id !== id),
    reality: {
      ...reality,
      asBuilt: reality.asBuilt.filter((a) => a.id !== id),
      photos: reality.photos.map((p) => ({
        ...p,
        overlays: (p.overlays ?? []).flatMap((o) => {
          if (o.id === overlay.id) return [];
          if (o.linkedObjectId === id) return [{ ...o, applied: false, linkedObjectId: undefined }];
          return [o];
        }),
      })),
    },
  };
}
