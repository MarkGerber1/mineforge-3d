import { migrateProject } from "./schema.ts";
import type { Project } from "../engineering/types.ts";

export const PORTABLE_KIND = "mineforge-project" as const;
export const PORTABLE_FORMAT_VERSION = 1 as const;
export const PROJECT_IMPORT_ACCEPT = ".mineforge.json,application/json";
export const MAX_BUNDLE_CHARS = 24 * 1024 * 1024;
export const MAX_MEDIA_CHARS = 8 * 1024 * 1024;

export interface PortableBundle {
  kind: typeof PORTABLE_KIND;
  formatVersion: typeof PORTABLE_FORMAT_VERSION;
  exportedAt: string;
  project: Project;
  media: Record<string, string>;
  missingMedia: string[];
}

export type ImportDecision = "replace" | "copy";

export type ImportAttempt =
  | { ok: true; project: Project; media: Record<string, string> }
  | { ok: false; collision: true; project: Project; bundle: PortableBundle }
  | { ok: false; collision: false; project: Project; error: string };

export class PortableImportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PortableImportError";
    this.code = code;
  }
}

export function photoIdsOf(project: Project): string[] {
  return project.reality?.photos?.map((p) => p.id) ?? [];
}

export function safeProjectFilename(name: string): string {
  const cleaned = name
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${cleaned || "project"}.mineforge.json`;
}

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hasImageMagic(mime: string, bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (mime === "image/webp") {
    return (
      String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "RIFF" &&
      String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === "WEBP"
    );
  }
  return false;
}

/** JPEG, PNG, or WebP data URLs only. No SVG, HTML, or script payloads. */
export function isSupportedImageDataUrl(value: string): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_MEDIA_CHARS) return false;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const bytes = decodeBase64(match[2]);
  if (!bytes) return false;
  return hasImageMagic(match[1], bytes);
}

export function buildPortableBundle(
  project: Project,
  media: Record<string, string | null | undefined>,
  exportedAt = new Date().toISOString(),
): PortableBundle {
  const included: Record<string, string> = {};
  const missingMedia: string[] = [];
  for (const id of photoIdsOf(project)) {
    const raw = media[id];
    if (typeof raw === "string" && isSupportedImageDataUrl(raw)) included[id] = raw;
    else missingMedia.push(id);
  }
  return {
    kind: PORTABLE_KIND,
    formatVersion: PORTABLE_FORMAT_VERSION,
    exportedAt,
    project,
    media: included,
    missingMedia,
  };
}

export function stringifyPortableBundle(bundle: PortableBundle): string {
  return JSON.stringify(bundle);
}

function shortReason(error: unknown): string {
  if (error instanceof PortableImportError) return error.message;
  if (error instanceof Error) {
    const line = error.message.split("\n")[0]?.trim() ?? "";
    if (!line || line.startsWith("[") || line.length > 180) return "Проект не прошёл проверку схемы.";
    return line;
  }
  return "Проект не прошёл проверку.";
}

export function parsePortableBundle(text: string): PortableBundle {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new PortableImportError("empty", "Файл пуст.");
  }
  if (text.length > MAX_BUNDLE_CHARS) {
    throw new PortableImportError("too_large", "Файл слишком большой.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PortableImportError("json", "Файл не является JSON.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PortableImportError("envelope", "Некорректный пакет проекта.");
  }
  const env = raw as Record<string, unknown>;
  if (env.kind !== PORTABLE_KIND) {
    throw new PortableImportError("kind", "Это не пакет MINEFORGE.");
  }
  if (env.formatVersion !== PORTABLE_FORMAT_VERSION) {
    throw new PortableImportError("version", "Неподдерживаемая версия пакета.");
  }
  let project: Project;
  try {
    project = migrateProject(env.project);
  } catch (error) {
    throw new PortableImportError("project", shortReason(error));
  }
  if (!env.media || typeof env.media !== "object" || Array.isArray(env.media)) {
    throw new PortableImportError("media", "Медиа пакета повреждены.");
  }
  if (env.missingMedia != null && !Array.isArray(env.missingMedia)) {
    throw new PortableImportError("envelope", "Некорректный список отсутствующих фото.");
  }
  const ids = new Set(photoIdsOf(project));
  const media: Record<string, string> = {};
  for (const [id, value] of Object.entries(env.media as Record<string, unknown>)) {
    if (!ids.has(id)) {
      throw new PortableImportError("media_foreign", "В пакете есть фото, которого нет в проекте.");
    }
    if (typeof value !== "string" || !isSupportedImageDataUrl(value)) {
      throw new PortableImportError("media_type", "Недопустимый формат фото.");
    }
    media[id] = value;
  }
  const missingMedia = Array.isArray(env.missingMedia)
    ? env.missingMedia.filter((id): id is string => typeof id === "string" && ids.has(id))
    : [];
  return {
    kind: PORTABLE_KIND,
    formatVersion: PORTABLE_FORMAT_VERSION,
    exportedAt: typeof env.exportedAt === "string" ? env.exportedAt : new Date().toISOString(),
    project,
    media,
    missingMedia,
  };
}

function mapId(map: Map<string, string>, id: string | undefined): string | undefined {
  if (!id) return id;
  return map.get(id) ?? id;
}

function copyProject(bundle: PortableBundle): { project: Project; media: Record<string, string> } {
  const source = structuredClone(bundle.project);
  const photos = source.reality?.photos ?? [];
  const map = new Map<string, string>();
  for (const photo of photos) map.set(photo.id, `photo_${crypto.randomUUID()}`);
  const media: Record<string, string> = {};
  for (const [id, data] of Object.entries(bundle.media)) {
    const next = map.get(id);
    if (next) media[next] = data;
  }
  const reality = source.reality;
  const project: Project = {
    ...source,
    id: `proj_${crypto.randomUUID()}`,
    name: source.name.includes("(импорт)") ? source.name : `${source.name} (импорт)`,
    updatedAt: Date.now(),
    openings: source.openings.map((opening) => ({
      ...opening,
      sourcePhotoId: mapId(map, opening.sourcePhotoId),
    })),
    reality: reality
      ? {
          ...reality,
          photos: reality.photos.map((photo) => ({ ...photo, id: map.get(photo.id) ?? photo.id })),
          findings: reality.findings.map((finding) => ({
            ...finding,
            photoId: mapId(map, finding.photoId),
            opening: finding.opening
              ? { ...finding.opening, sourcePhotoId: mapId(map, finding.opening.sourcePhotoId) }
              : finding.opening,
            estimated: finding.estimated,
          })),
          asBuilt: reality.asBuilt.map((object) => ({ ...object, photoId: mapId(map, object.photoId) })),
          videos: (reality.videos ?? []).map((video) => ({
            ...video,
            frameIds: video.frameIds.map((id) => map.get(id) ?? id),
            selectedFrameIds: video.selectedFrameIds.map((id) => map.get(id) ?? id),
          })),
        }
      : reality,
  };
  return { project: migrateProject(project), media };
}

/**
 * Decide how an already-validated bundle is applied.
 * No decision + existing id does not rewrite the project.
 */
export function prepareImport(
  bundle: PortableBundle,
  existingIds: ReadonlySet<string>,
  decision?: ImportDecision,
): { project: Project; media: Record<string, string> } {
  const exists = existingIds.has(bundle.project.id);
  if (exists && !decision) {
    throw new PortableImportError("collision", "Проект с таким id уже есть локально.");
  }
  if (exists && decision === "copy") return copyProject(bundle);
  return { project: bundle.project, media: bundle.media };
}

/** Parse and plan an import. On failure, `project` is the same current object. */
export function attemptImport(
  current: Project,
  text: string,
  existingIds: ReadonlySet<string>,
  decision?: ImportDecision,
): ImportAttempt {
  try {
    const bundle = parsePortableBundle(text);
    if (existingIds.has(bundle.project.id) && !decision) {
      return { ok: false, collision: true, project: current, bundle };
    }
    const prepared = prepareImport(bundle, existingIds, decision);
    return { ok: true, project: prepared.project, media: prepared.media };
  } catch (error) {
    return { ok: false, collision: false, project: current, error: shortReason(error) };
  }
}

export interface PortableStore {
  projects: Record<string, Project>;
  lastId: string | null;
  media: Record<string, string>;
}

export function emptyPortableStore(): PortableStore {
  return { projects: {}, lastId: null, media: {} };
}

/** Same writes as the IndexedDB import transaction: project, lastId, photo media. */
export function applyImportedRecords(store: PortableStore, project: Project, media: Record<string, string>): PortableStore {
  const nextMedia = { ...store.media };
  for (const id of photoIdsOf(project)) {
    const bytes = media[id];
    if (bytes) nextMedia[id] = bytes;
    else delete nextMedia[id];
  }
  return {
    projects: { ...store.projects, [project.id]: project },
    lastId: project.id,
    media: nextMedia,
  };
}

export function reloadActiveProject(store: PortableStore): Project | null {
  if (!store.lastId) return null;
  const row = store.projects[store.lastId];
  if (!row) return null;
  return migrateProject(JSON.parse(JSON.stringify(row)));
}
