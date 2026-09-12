import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/project/store";
import { loadMedia } from "@/reality/media";
import { parseLengthToMeters } from "@/engineering/units";
import { photoCalibration } from "@/engineering/reality";
import { Button } from "@/components/ui/button";
import { nid } from "@/project/factory";
import type { PhotoMarkerKind } from "@/engineering/types";

const KINDS: Array<{ id: PhotoMarkerKind; label: string }> = [
  { id: "point", label: "Калибр" },
  { id: "door", label: "Дверь" },
  { id: "opening", label: "Проём" },
  { id: "shaft", label: "Шахта" },
  { id: "beam", label: "Балка" },
  { id: "column", label: "Колонна" },
  { id: "wall", label: "Стена" },
];

export function PhotoAnnotator({ photoId }: { photoId: string }) {
  const store = useProjectStore();
  const photo = store.project.reality?.photos.find((p) => p.id === photoId);
  const [src, setSrc] = useState<string | null>(null);
  const [pending, setPending] = useState<{ nx: number; ny: number } | null>(null);
  const [len, setLen] = useState("");
  const [kind, setKind] = useState<PhotoMarkerKind>("point");
  const imgRef = useRef<HTMLImageElement>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    void loadMedia(photoId).then(setSrc);
    setScale(1);
    setPending(null);
  }, [photoId]);

  if (!photo) return <div className="p-3 text-[12px] text-muted">Фото не найдено</div>;

  const cal = photoCalibration(photo);
  const known = parseLengthToMeters(len);

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
    if (kind === "point" && !(known && known > 0)) {
      store.pushGrok({
        id: `rv${Date.now()}`,
        role: "assistant",
        text: "Калибровка: введите известную длину A–B (например 2,43 m), затем повторите точки.",
      });
      setPending(null);
      return;
    }
    if (kind !== "point" && !cal && !(known && known > 0)) {
      store.pushGrok({
        id: `rv${Date.now()}`,
        role: "assistant",
        text: "Сначала калибр A–B с известной длиной, либо введите длину этой пары.",
      });
      setPending(null);
      return;
    }
    const aId = nid("mk");
    const bId = nid("mk");
    store.annotatePhoto(
      photoId,
      { id: aId, nx: pending.nx, ny: pending.ny, kind, label: "A", pairId: bId },
      { id: bId, nx, ny, kind, label: "B", pairId: aId },
      { kind, knownLengthM: known ?? undefined },
    );
    setPending(null);
    if (kind === "point") setLen("");
  };

  const pairs: Array<{ ax: number; ay: number; bx: number; by: number }> = [];
  for (const m of photo.markers) {
    if (!m.pairId || m.label !== "A") continue;
    const b = photo.markers.find((x) => x.id === m.pairId);
    if (b) pairs.push({ ax: m.nx, ay: m.ny, bx: b.nx, by: b.ny });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            data-mf-id={`kind-${k.id}`}
            className={`h-11 min-w-[44px] rounded-[8px] px-2 text-[11px] uppercase ${kind === k.id ? "bg-raised text-fg" : "text-muted"}`}
            onClick={() => setKind(k.id)}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-hidden bg-bg"
        data-mf-id="annotator"
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
        <div className="flex h-full min-h-[140px] w-full items-center justify-center overflow-hidden">
          <div className="relative flex h-full max-h-full w-full items-center justify-center" style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}>
            {src ? (
              <img ref={imgRef} src={src} alt={photo.name} className="max-h-full max-w-full object-contain" draggable={false} data-mf-id="annotator-img" />
            ) : (
              <div className="flex h-40 items-center justify-center text-[12px] text-muted">Загрузка…</div>
            )}
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              {pairs.map((p, i) => (
                <line
                  key={i}
                  x1={`${p.ax * 100}%`}
                  y1={`${p.ay * 100}%`}
                  x2={`${p.bx * 100}%`}
                  y2={`${p.by * 100}%`}
                  stroke="var(--color-cold)"
                  strokeWidth="2"
                />
              ))}
            </svg>
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
          className="h-11 flex-1 rounded-[6px] border border-border bg-bg px-2 font-mono text-[12px]"
          data-mf-id="cal-length"
          placeholder={kind === "point" ? "A–B = 2,43 m (замер)" : "длина, если известна"}
          value={len}
          onChange={(e) => setLen(e.target.value)}
        />
        <Button variant="outline" onClick={() => { setPending(null); setScale(1); }}>
          Сброс
        </Button>
      </div>
      <div className="px-2 pb-2 font-mono text-[11px] text-muted">
        {cal
          ? `Масштаб ${(cal.scaleMPerPx * 1000).toFixed(2)} mm/px · ${cal.provenance}`
          : "Нет калибровки — укажите известную длину A–B"}
        {photo.wallHint ? ` · стена ${photo.wallHint}` : " · стена не задана"}
        . Не сантиметровая точность.
      </div>
    </div>
  );
}
