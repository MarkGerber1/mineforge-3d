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

export async function deleteMedia(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MEDIA, "readwrite");
    tx.objectStore(MEDIA).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * EXIF orientations 5–8 swap width/height. createImageBitmap({imageOrientation:'from-image'})
 * already yields display size; this helper is for tests and Image() fallbacks.
 */
export function applyExifOrientation(
  width: number,
  height: number,
  orientation: number,
): { widthPx: number; heightPx: number } {
  if (orientation >= 5 && orientation <= 8) return { widthPx: height, heightPx: width };
  return { widthPx: width, heightPx: height };
}

interface DecodedRaster {
  widthPx: number;
  heightPx: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  close: () => void;
}

async function decodeRaster(blob: Blob): Promise<DecodedRaster> {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions);
    return {
      widthPx: bmp.width,
      heightPx: bmp.height,
      draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
      close: () => bmp.close(),
    };
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image"));
      i.src = url;
    });
    return {
      widthPx: img.naturalWidth || img.width,
      heightPx: img.naturalHeight || img.height,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      close: () => undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function resizeImageFile(
  file: File,
  maxEdge = 1280,
): Promise<{ dataUrl: string; widthPx: number; heightPx: number }> {
  const raw = await file.arrayBuffer();
  const blob = new Blob([raw], { type: file.type || "image/jpeg" });
  const decoded = await decodeRaster(blob);
  try {
    const scale = Math.min(1, maxEdge / Math.max(decoded.widthPx, decoded.heightPx));
    const w = Math.max(1, Math.round(decoded.widthPx * scale));
    const h = Math.max(1, Math.round(decoded.heightPx * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    decoded.draw(ctx, w, h);
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.82), widthPx: w, heightPx: h };
  } finally {
    decoded.close();
  }
}
