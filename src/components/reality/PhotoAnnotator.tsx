import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/project/store";
import { loadMedia } from "@/reality/media";
import { parseLengthToMeters } from "@/engineering/units";
import { Button } from "@/components/ui/button";
import { nid } from "@/project/factory";

export function PhotoAnnotator({ photoId }: { photoId: string }) {
  const store = useProjectStore();
  const photo = store.project.reality?.photos.find((p) => p.id === photoId);
  const [src, setSrc] = useState<string | null>(null);
  const [pending, setPending] = useState<{ nx: number; ny: number } | null>(null);
  const [len, setLen] = useState("");
  const imgRef = useRef<HTMLImageElement>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    void loadMedia(photoId).then(setSrc);
    setScale(1);
  }, [photoId]);

  if (!photo) return <div className="p-3 text-[12px] text-muted">Фото не найдено</div>;

  const onTap = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointers.current.size > 1 || pinch.current) return;
    const box = imgRef.current?.getBoundingClientRect();
    if (!box) return;
    const nx = (e.clientX - box.left) / box.width;
    const ny = (e.clientY - box.top) / box.height;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
    if (!pending) {
      setPending({ nx, ny });
      return;
    }
    const aId = nid("mk");
    const bId = nid("mk");
    store.addPhotoMarker(photoId, { id: aId, nx: pending.nx, ny: pending.ny, kind: "point", label: "A", pairId: bId });
    store.addPhotoMarker(photoId, {
      id: bId,
      nx,
      ny,
      kind: "point",
      label: "B",
      pairId: aId,
      lengthM: parseLengthToMeters(len) ?? undefined,
      provenance: parseLengthToMeters(len) ? "FIELD_MEASUREMENT" : "PHOTO_ESTIMATE",
    });
    setPending(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-bg"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => {
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale };
          }
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch.current && pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            setScale(Math.min(4, Math.max(1, pinch.current.scale * (dist / pinch.current.dist))));
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) {
            const wasPinch = Boolean(pinch.current);
            pinch.current = null;
            if (!wasPinch) onTap(e);
          }
        }}
      >
        <div className="flex h-full w-full items-center justify-center overflow-hidden">
          <div className="relative inline-block max-h-full max-w-full" style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}>
            {src ? (
              <img ref={imgRef} src={src} alt={photo.name} className="max-h-[48vh] max-w-full object-contain" draggable={false} />
            ) : (
              <div className="flex h-40 items-center justify-center text-[12px] text-muted">Загрузка…</div>
            )}
            {photo.markers.map((m) => (
              <div
                key={m.id}
                className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-cold"
                style={{ left: `${m.nx * 100}%`, top: `${m.ny * 100}%` }}
              >
                <span className="absolute left-3 top-0 font-mono text-[10px] text-fg">{m.label}</span>
              </div>
            ))}
            {pending && (
              <div
                className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-warn"
                style={{ left: `${pending.nx * 100}%`, top: `${pending.ny * 100}%` }}
              />
            )}
          </div>
        </div>
      </div>
      <div className="flex gap-1 border-t border-border p-2">
        <input
          suppressHydrationWarning
          inputMode="decimal"
          className="h-9 flex-1 rounded-[6px] border border-border bg-bg px-2 font-mono text-[12px]"
          placeholder="A–B = 2,43 m"
          value={len}
          onChange={(e) => setLen(e.target.value)}
        />
        <Button variant="outline" onClick={() => { setPending(null); setScale(1); }}>
          Сброс
        </Button>
      </div>
      <div className="px-2 pb-2 text-[11px] text-muted">
        Tap A, tap B. Pinch — масштаб. Размер с фото = PHOTO ESTIMATE, пока не введён замер.
      </div>
    </div>
  );
}
