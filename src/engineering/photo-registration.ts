/**
 * Photo → Wall registration.
 *
 * A–B calibration is SCALE (m/px) only. It does not say where the photo sits
 * on the canonical wall, which way left→right runs, or where the floor is.
 * Those come from an explicit PhotoWallRegistration.
 *
 * PHASE 1 wall-plane model. Not photogrammetry. Do not invent camera pose.
 */
import { photoCalibration, photoSize } from "./reality.ts";
import type {
  PhotoRegDirection,
  PhotoWallRegistration,
  RealityPhotoMeta,
  WallId,
} from "./types.ts";

export const SCALE_ONLY_POSITION_RU =
  "Фото откалибровано по размеру, но не привязано к координатам стены.";

export const ABSOLUTE_POSITION_RU =
  "Нет привязки фото к стене и нет координаты, введённой владельцем.";

export const ABSOLUTE_ELEVATION_RU =
  "Нет вертикальной привязки фото и нет высоты, введённой владельцем.";

export function isPhotoRegistered(photo: RealityPhotoMeta | undefined | null): boolean {
  const r = photo?.wallRegistration;
  if (!r) return false;
  if (r.wallId !== "north" && r.wallId !== "south" && r.wallId !== "east" && r.wallId !== "west") return false;
  if (!Number.isFinite(r.anchorNx) || !Number.isFinite(r.anchorNy)) return false;
  if (!Number.isFinite(r.wallOffsetM) || !Number.isFinite(r.elevationM)) return false;
  if (r.hDirection !== 1 && r.hDirection !== -1) return false;
  if (r.vDirection !== 1 && r.vDirection !== -1) return false;
  return Boolean(photoCalibration(photo!));
}

export function defaultWallRegistration(wallId: WallId): PhotoWallRegistration {
  return {
    wallId,
    anchorNx: 0,
    wallOffsetM: 0,
    hDirection: 1,
    anchorNy: 1,
    elevationM: 0,
    vDirection: -1,
    provenance: "USER_CONFIRMED",
  };
}

export function registeredOffsetFromNx(photo: RealityPhotoMeta, nx: number): number | null {
  const cal = photoCalibration(photo);
  const r = photo.wallRegistration;
  if (!cal || !r || !Number.isFinite(nx)) return null;
  const span = photoSize(photo).widthPx * cal.scaleMPerPx;
  if (!(span > 1e-12)) return null;
  const offset = r.wallOffsetM + r.hDirection * (nx - r.anchorNx) * span;
  return Number.isFinite(offset) ? offset : null;
}

export function nxFromRegisteredOffset(photo: RealityPhotoMeta, wallOffsetM: number): number | null {
  const cal = photoCalibration(photo);
  const r = photo.wallRegistration;
  if (!cal || !r || !Number.isFinite(wallOffsetM)) return null;
  const span = photoSize(photo).widthPx * cal.scaleMPerPx;
  const den = r.hDirection * span;
  if (!(Math.abs(den) > 1e-12)) return null;
  const nx = r.anchorNx + (wallOffsetM - r.wallOffsetM) / den;
  return Number.isFinite(nx) ? nx : null;
}

/**
 * Elevation of a photo-normalized Y. Image Y grows downward.
 * Photo bottom is NOT assumed to be floor 0 — the vertical anchor is explicit.
 */
export function registeredElevationFromNy(photo: RealityPhotoMeta, ny: number): number | null {
  const cal = photoCalibration(photo);
  const r = photo.wallRegistration;
  if (!cal || !r || !Number.isFinite(ny)) return null;
  const span = photoSize(photo).heightPx * cal.scaleMPerPx;
  if (!(span > 1e-12)) return null;
  const elev = r.elevationM + r.vDirection * (ny - r.anchorNy) * span;
  return Number.isFinite(elev) ? elev : null;
}

export function nyFromRegisteredElevation(photo: RealityPhotoMeta, elevationM: number): number | null {
  const cal = photoCalibration(photo);
  const r = photo.wallRegistration;
  if (!cal || !r || !Number.isFinite(elevationM)) return null;
  const span = photoSize(photo).heightPx * cal.scaleMPerPx;
  const den = r.vDirection * span;
  if (!(Math.abs(den) > 1e-12)) return null;
  const ny = r.anchorNy + (elevationM - r.elevationM) / den;
  return Number.isFinite(ny) ? ny : null;
}

export type OverlayPositionSource = "REGISTERED" | "OWNER_ENTERED";

export type OverlayPositionResult =
  | { ok: true; offsetM: number; source: OverlayPositionSource }
  | { ok: false; errors: string[] };

/**
 * Absolute wall offset for APPLY / linked photo intent.
 * Unregistered photos must not invent world position from a photo-normalized
 * fraction of wall length. Visual nx may still be clamped by the UI; this
 * function does not clamp.
 */
export function resolveOverlayWallOffset(
  photo: RealityPhotoMeta,
  nx: number,
  wall: WallId,
  _project: unknown,
  ownerOffsetM?: number,
): OverlayPositionResult {
  if (isPhotoRegistered(photo) && photo.wallRegistration!.wallId === wall) {
    const offsetM = registeredOffsetFromNx(photo, nx);
    if (offsetM == null) return { ok: false, errors: [ABSOLUTE_POSITION_RU] };
    return { ok: true, offsetM, source: "REGISTERED" };
  }
  if (ownerOffsetM != null && Number.isFinite(ownerOffsetM)) {
    return { ok: true, offsetM: ownerOffsetM, source: "OWNER_ENTERED" };
  }
  const msg = photoCalibration(photo) ? SCALE_ONLY_POSITION_RU : ABSOLUTE_POSITION_RU;
  return { ok: false, errors: [msg] };
}

export function resolveOverlayElevation(
  photo: RealityPhotoMeta,
  nyBottom: number,
  ownerElevationM: number | undefined,
): { ok: true; elevationM: number } | { ok: false; errors: string[] } {
  if (isPhotoRegistered(photo)) {
    const elev = registeredElevationFromNy(photo, nyBottom);
    if (elev == null) return { ok: false, errors: [ABSOLUTE_ELEVATION_RU] };
    return { ok: true, elevationM: elev };
  }
  if (ownerElevationM != null && Number.isFinite(ownerElevationM)) {
    return { ok: true, elevationM: ownerElevationM };
  }
  const msg = photoCalibration(photo) ? SCALE_ONLY_POSITION_RU : ABSOLUTE_ELEVATION_RU;
  return { ok: false, errors: [msg] };
}

export function registrationOnPhoto(reg: PhotoWallRegistration): boolean {
  return (
    Number.isFinite(reg.anchorNx) &&
    Number.isFinite(reg.anchorNy) &&
    Number.isFinite(reg.wallOffsetM) &&
    Number.isFinite(reg.elevationM) &&
    (reg.hDirection === 1 || reg.hDirection === -1) &&
    (reg.vDirection === 1 || reg.vDirection === -1)
  );
}

export function asRegDirection(n: number): PhotoRegDirection {
  return n < 0 ? -1 : 1;
}
