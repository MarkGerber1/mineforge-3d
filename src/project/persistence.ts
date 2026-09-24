import type { Project } from "../engineering/types.ts";
import { loadMedia } from "../reality/media.ts";
import { migrateProject } from "./schema.ts";
import { photoIdsOf } from "./portable.ts";

const DB = "mineforge";
const STORE = "projects";
const META = "meta";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains("media")) db.createObjectStore("media");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProject(project: Project): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE, META], "readwrite");
    tx.objectStore(STORE).put(project);
    tx.objectStore(META).put(project.id, "lastId");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadProject(id: string): Promise<Project | null> {
  const db = await openDb();
  const row = await new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!row) return null;
  return migrateProject(row);
}

export async function listProjects(): Promise<Array<{ id: string; name: string; updatedAt: number }>> {
  const db = await openDb();
  const rows = await new Promise<Project[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as Project[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadLastProject(): Promise<Project | null> {
  const db = await openDb();
  const lastId = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(META, "readonly");
    const req = tx.objectStore(META).get("lastId");
    req.onsuccess = () => resolve((req.result as string) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!lastId) return null;
  return loadProject(lastId);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function exportProjectJson(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function importProjectJson(text: string): Project {
  return migrateProject(JSON.parse(text));
}

export async function readProjectMedia(project: Project): Promise<Record<string, string | null>> {
  const media: Record<string, string | null> = {};
  for (const id of photoIdsOf(project)) media[id] = await loadMedia(id);
  return media;
}

/**
 * One transaction: project + lastId + photo media.
 * Must match applyImportedRecords. Caller validates before this runs.
 * A failed transaction does not activate the project.
 */
export async function commitImportedProject(project: Project, media: Record<string, string>): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, META, "media"], "readwrite");
      tx.objectStore(STORE).put(project);
      tx.objectStore(META).put(project.id, "lastId");
      const mediaStore = tx.objectStore("media");
      for (const [id, dataUrl] of Object.entries(media)) mediaStore.put(dataUrl, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("import failed"));
      tx.onabort = () => reject(tx.error ?? new Error("import aborted"));
    });
  } finally {
    db.close();
  }
}
