/**
 * PHASE 1 calibrated interactive 2D photo overlay.
 * Not photogrammetry. Overlay objects are drafts until APPLY TO MODEL.
 */
import { TEST_RACK_A } from "../project/factory.ts";
import { FAN_STRONG } from "../equipment/fan-catalog.ts";
import { aabbInside, fanIsSpatiallyValid, roomAabb, validateOpening } from "./geometry.ts";
import { validateRackPlacement } from "./placement.ts";
import { photoCalibration, photoSize } from "./reality.ts";
import { resolveOverlayElevation, resolveOverlayWallOffset } from "./photo-registration.ts";
import type {
  AsBuiltObject,
  FanInstance,
  Opening,
  OpeningType,
  PhotoOverlayKind,
  PhotoOverlayObject,
  Project,
  RealityPhotoMeta,
  WallId,
} from "./types.ts";
import { emptyReality } from "./types.ts";

export const PHOTO_OVERLAY_KINDS: PhotoOverlayKind[] = [
  "rack",
  "intake",
  "exhaust",
  "fan",
  "duct",
  "door",
  "opening",
  "column",
  "beam",
];

export const PHOTO_OVERLAY_LABEL_RU: Record<PhotoOverlayKind, string> = {
  rack: "Стойка",
  intake: "Приток",
  exhaust: "Вытяжка",
  fan: "Вентилятор",
  duct: "Короб",
  door: "Дверь",
  opening: "Проём",
  column: "Колонна",
  beam: "Балка",
};

const DEFAULTS: Record<PhotoOverlayKind, { widthM: number; heightM: number; depthM: number; bottomElevationM: number }> = {
  rack: { widthM: TEST_RACK_A.widthM, heightM: TEST_RACK_A.heightM, depthM: TEST_RACK_A.depthM, bottomElevationM: 0 },
  intake: { widthM: 1.4, heightM: 0.9, depthM: 0.2, bottomElevationM: 0.4 },
  exhaust: { widthM: 1.4, heightM: 0.9, depthM: 0.2, bottomElevationM: 0.4 },
  fan: { widthM: 0.8, heightM: 0.4, depthM: 0.8, bottomElevationM: 0 },
  duct: { widthM: 1.0, heightM: 0.4, depthM: 0.4, bottomElevationM: 1.8 },
  door: { widthM: 1.0, heightM: 2.1, depthM: 0.2, bottomElevationM: 0 },
  opening: { widthM: 0.8, heightM: 0.8, depthM: 0.2, bottomElevationM: 0.4 },
  column: { widthM: 0.4, heightM: 2.8, depthM: 0.4, bottomElevationM: 0 },
  beam: { widthM: 2.0, heightM: 0.3, depthM: 0.3, bottomElevationM: 2.5 },
};

export function overlayDefaults(kind: PhotoOverlayKind) {
  return DEFAULTS[kind];
}

export function photoOverlays(photo: RealityPhotoMeta | undefined | null): PhotoOverlayObject[] {
  return photo?.overlays ?? [];
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function overlayHit(o: PhotoOverlayObject, nx: number, ny: number, pad = 0.01): boolean {
  return nx >= o.nx - pad && ny >= o.ny - pad && nx <= o.nx + o.nw + pad && ny <= o.ny + o.nh + pad;
}

export function createPhotoOverlay(
  photo: RealityPhotoMeta,
  kind: PhotoOverlayKind,
  nx: number,
  ny: number,
  id: string,
): PhotoOverlayObject {
  const def = DEFAULTS[kind];
  const cal = photoCalibration(photo);
  const { widthPx, heightPx } = photoSize(photo);
  let nw: number;
  let nh: number;
  if (cal) {
    nw = def.widthM / Math.max(1e-9, widthPx * cal.scaleMPerPx);
    nh = def.heightM / Math.max(1e-9, heightPx * cal.scaleMPerPx);
  } else {
    nw = 0.14;
    nh = 0.12;
  }
  nw = Math.min(0.45, Math.max(0.04, nw));
  nh = Math.min(0.45, Math.max(0.04, nh));
  const x = clamp01(nx - nw / 2);
  const y = clamp01(ny - nh / 2);
  return {
    id,
    kind,
    nx: Math.min(x, 1 - nw),
    ny: Math.min(y, 1 - nh),
    nw,
    nh,
    rotationDeg: 0,
    widthM: def.widthM,
    heightM: def.heightM,
    depthM: def.depthM,
    bottomElevationM: def.bottomElevationM,
    wallId: photo.wallHint,
    metricSource: "DEFAULT",
    planeStatus: "ON_PLANE",
    applied: false,
  };
}

function openingTypeFor(kind: PhotoOverlayKind): OpeningType | null {
  if (kind === "door") return "DOOR";
  if (kind === "intake") return "INTAKE";
  if (kind === "exhaust") return "EXHAUST";
  if (kind === "opening") return "TECHNICAL";
  return null;
}

export function placeOnWall(
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

function overlayPlacement(
  photo: RealityPhotoMeta,
  o: PhotoOverlayObject,
  wall: WallId,
  project: Project,
): { ok: true; offsetM: number; elevationM: number } | { ok: false; errors: string[] } {
  const offset = resolveOverlayWallOffset(photo, o.nx, wall, project, o.ownerOffsetM);
  if (!offset.ok) return offset;
  const elev = resolveOverlayElevation(
    photo,
    o.ny + o.nh,
    o.metricSource === "OWNER_ENTERED" || o.ownerOffsetM != null ? o.bottomElevationM : o.bottomElevationM,
  );
  if (!elev.ok) {
    if (offset.source === "UNCALIBRATED_PROPORTIONAL" || offset.source === "OWNER_ENTERED") {
      return { ok: true, offsetM: offset.offsetM, elevationM: o.bottomElevationM ?? 0 };
    }
    return elev;
  }
  return { ok: true, offsetM: offset.offsetM, elevationM: elev.elevationM };
}

function asBuiltInsideRoom(
  project: Project,
  box: { x: number; y: number; widthM: number; depthM: number },
): boolean {
  return aabbInside(
    { x1: box.x, y1: box.y, x2: box.x + box.widthM, y2: box.y + box.depthM },
    roomAabb(project),
  );
}

function upsertOverlay(photo: RealityPhotoMeta, overlay: PhotoOverlayObject): RealityPhotoMeta {
  const list = photo.overlays ?? [];
  const i = list.findIndex((x) => x.id === overlay.id);
  const overlays = i >= 0 ? list.map((x, k) => (k === i ? overlay : x)) : [...list, overlay];
  return { ...photo, overlays };
}

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

export function applyOneOverlay(
  project: Project,
  photo: RealityPhotoMeta,
  overlay: PhotoOverlayObject,
): { ok: true; project: Project; overlay: PhotoOverlayObject } | { ok: false; errors: string[] } {
  if (overlay.applied && overlay.linkedObjectId) {
    return { ok: true, project, overlay };
  }
  const wall = overlay.wallId ?? photo.wallHint;
  const type = openingTypeFor(overlay.kind);

  if (type) {
    if (!wall) return { ok: false, errors: [`${PHOTO_OVERLAY_LABEL_RU[overlay.kind]}: укажите стену фото.`] };
    const placed = overlayPlacement(photo, overlay, wall, project);
    if (!placed.ok) return placed;
    const widthM = overlay.widthM;
    const opening: Opening = {
      id: overlay.linkedObjectId ?? `op_${overlay.id}`,
      type,
      wallId: wall,
      widthM,
      heightM: overlay.heightM,
      bottomElevationM: placed.elevationM,
      offsetFromWallStartM: placed.offsetM,
      name: PHOTO_OVERLAY_LABEL_RU[overlay.kind],
      provenance: "PHOTO_ESTIMATE",
      sourcePhotoId: photo.id,
    };
    const v = validateOpening(project, opening);
    if (!v.ok) return { ok: false, errors: v.errors };
    const nextOpening = project.openings.some((o) => o.id === opening.id)
      ? project.openings.map((o) => (o.id === opening.id ? opening : o))
      : [...project.openings, opening];
    const linked: PhotoOverlayObject = {
      ...overlay,
      applied: true,
      linkedObjectId: opening.id,
      wallId: wall,
      planeStatus: "ON_PLANE",
    };
    return { ok: true, project: withPhoto({ ...project, openings: nextOpening }, upsertOverlay(photo, linked)), overlay: linked };
  }

  if (overlay.kind === "rack") {
    if (!wall) return { ok: false, errors: ["Стойка: укажите стену фото."] };
    const placed = overlayPlacement(photo, overlay, wall, project);
    if (!placed.ok) return placed;
    const box = placeOnWall(
      project,
      wall,
      placed.offsetM,
      overlay.widthM,
      overlay.depthM ?? TEST_RACK_A.depthM,
    );
    const rack = {
      id: overlay.linkedObjectId ?? `rack_${overlay.id}`,
      name: "Стойка (фото)",
      ...TEST_RACK_A,
      x: box.x,
      y: box.y,
      widthM: box.widthM,
      depthM: box.depthM,
      rotationDeg: overlay.rotationDeg,
      asicCount: 0,
      airflowToward: wall === "north" ? ("south" as const) : wall === "south" ? ("north" as const) : wall === "west" ? ("east" as const) : ("west" as const),
    };
    const v = validateRackPlacement(project, rack);
    if (!v.ok) return { ok: false, errors: v.errors };
    const racks = project.racks.some((r) => r.id === rack.id)
      ? project.racks.map((r) => (r.id === rack.id ? rack : r))
      : [...project.racks, rack];
    const linked: PhotoOverlayObject = {
      ...overlay,
      applied: true,
      linkedObjectId: rack.id,
      wallId: wall,
      planeStatus: "ON_PLANE",
    };
    return { ok: true, project: withPhoto({ ...project, racks }, upsertOverlay(photo, linked)), overlay: linked };
  }

  if (overlay.kind === "fan") {
    if (!wall) return { ok: false, errors: ["Вентилятор: укажите стену фото."] };
    const placed = overlayPlacement(photo, overlay, wall, project);
    if (!placed.ok) return placed;
    const box = placeOnWall(project, wall, placed.offsetM, overlay.widthM, overlay.depthM ?? 0.8);
    const fan: FanInstance = {
      id: overlay.linkedObjectId ?? `fan_${overlay.id}`,
      specId: project.fans[0]?.specId ?? FAN_STRONG.id,
      name: "Вентилятор (фото)",
      x: box.x,
      y: box.y,
      arrangement: "single",
      count: 1,
      dirtyFilter: false,
    };
    if (!fanIsSpatiallyValid({ ...project, fans: [...project.fans.filter((f) => f.id !== fan.id), fan] }, fan)) {
      return { ok: false, errors: ["Вентилятор должен быть внутри помещения."] };
    }
    const fans = project.fans.some((f) => f.id === fan.id)
      ? project.fans.map((f) => (f.id === fan.id ? fan : f))
      : [...project.fans, fan];
    const linked: PhotoOverlayObject = {
      ...overlay,
      applied: true,
      linkedObjectId: fan.id,
      wallId: wall,
      planeStatus: "ON_PLANE",
    };
    return { ok: true, project: withPhoto({ ...project, fans }, upsertOverlay(photo, linked)), overlay: linked };
  }

  if (overlay.kind === "duct" || overlay.kind === "column" || overlay.kind === "beam") {
    if (!wall) return { ok: false, errors: [`${PHOTO_OVERLAY_LABEL_RU[overlay.kind]}: укажите стену фото.`] };
    const placed = overlayPlacement(photo, overlay, wall, project);
    if (!placed.ok) return placed;
    const into = overlay.kind === "column" ? overlay.depthM ?? 0.4 : overlay.depthM ?? 0.4;
    const box = placeOnWall(project, wall, placed.offsetM, overlay.widthM, into);
    if (!asBuiltInsideRoom(project, box)) {
      return { ok: false, errors: [`${PHOTO_OVERLAY_LABEL_RU[overlay.kind]} выходит за пределы помещения.`] };
    }
    const z =
      overlay.kind === "beam"
        ? Math.max(0, project.room.heightM - overlay.heightM)
        : placed.elevationM;
    const obj: AsBuiltObject = {
      id: overlay.linkedObjectId ?? `ab_${overlay.id}`,
      kind: overlay.kind,
      name: `${PHOTO_OVERLAY_LABEL_RU[overlay.kind]} (фото)`,
      x: box.x,
      y: box.y,
      z,
      widthM: box.widthM,
      heightM: overlay.kind === "column" ? project.room.heightM : overlay.heightM,
      depthM: box.depthM,
      provenance: "PHOTO_ESTIMATE",
      photoId: photo.id,
      confidence: "MEDIUM",
    };
    const reality = project.reality ?? emptyReality();
    const asBuilt = reality.asBuilt.some((a) => a.id === obj.id)
      ? reality.asBuilt.map((a) => (a.id === obj.id ? obj : a))
      : [...reality.asBuilt, obj];
    const linked: PhotoOverlayObject = {
      ...overlay,
      applied: true,
      linkedObjectId: obj.id,
      wallId: wall,
      planeStatus: "ON_PLANE",
    };
    const photo2 = upsertOverlay(photo, linked);
    return {
      ok: true,
      project: {
        ...project,
        reality: {
          ...reality,
          asBuilt,
          compareMode: "as-built",
          photos: reality.photos.map((p) => (p.id === photo.id ? photo2 : p)),
        },
      },
      overlay: linked,
    };
  }

  return { ok: false, errors: [`Неизвестный тип ${overlay.kind}`] };
}

export function applyPhotoOverlays(
  project: Project,
  photoId: string,
): { project: Project; ok: boolean; errors: string[]; appliedIds: string[] } {
  const reality = project.reality ?? emptyReality();
  const photo = reality.photos.find((p) => p.id === photoId);
  if (!photo) return { project, ok: false, errors: ["Фото не найдено."], appliedIds: [] };
  const drafts = (photo.overlays ?? []).filter((o) => !o.applied);
  if (!drafts.length) return { project, ok: false, errors: ["Нет объектов для APPLY."], appliedIds: [] };
  let candidate = project;
  const errors: string[] = [];
  const appliedIds: string[] = [];
  for (const overlay of drafts) {
    const livePhoto = (candidate.reality ?? emptyReality()).photos.find((p) => p.id === photoId) ?? photo;
    const r = applyOneOverlay(candidate, livePhoto, overlay);
    if (r.ok) {
      candidate = r.project;
      appliedIds.push(overlay.id);
    } else {
      errors.push(`${PHOTO_OVERLAY_LABEL_RU[overlay.kind]}: ${r.errors.join("; ")}`);
    }
  }
  if (errors.length) {
    return { project, ok: false, errors, appliedIds: [] };
  }
  return { project: candidate, ok: true, errors: [], appliedIds };
}
