const DB = "mineforge";
const MEDIA = "media";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMedia(id: string, dataUrl: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MEDIA, "readwrite");
    tx.objectStore(MEDIA).put(dataUrl, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadMedia(id: string): Promise<string | null> {
  const db = await openDb();
  const row = await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(MEDIA, "readonly");
    const req = tx.objectStore(MEDIA).get(id);
    req.onsuccess = () => resolve((req.result as string) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return row;
}

export async function resizeImageFile(file: File, maxEdge = 1280): Promise<{ dataUrl: string; widthPx: number; heightPx: number }> {
  const raw = await file.arrayBuffer();
  const blob = new Blob([raw], { type: file.type || "image/jpeg" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image"));
      i.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.82), widthPx: w, heightPx: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}
