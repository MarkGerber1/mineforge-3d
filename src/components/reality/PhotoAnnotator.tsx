import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/project/store";
import { loadMedia } from "@/reality/media";
import { parseLengthToMeters } from "@/engineering/units";
import { photoCalibration } from "@/engineering/reality";
import {
  PHOTO_OVERLAY_KINDS,
  PHOTO_OVERLAY_LABEL_RU,
  overlayHit,
} from "@/engineering/photo-overlay";
import { Button } from "@/components/ui/button";
import { nid } from "@/project/factory";
import type { PhotoOverlayKind, WallId } from "@/engineering/types";
import { cn } from "@/lib/utils";

const OVERLAY_COLOR: Record<PhotoOverlayKind, string> = {
  rack: "border-cold bg-cold/20",
  intake: "border-cold bg-cold/25",
  exhaust: "border-warn bg-warn/20",
  fan: "border-fg bg-raised/70",
  duct: "border-warn bg-warn/15",
  door: "border-fg bg-panel/50",
  opening: "border-muted bg-raised/50",
  column: "border-warn bg-warn/10",
  beam: "border-warn bg-warn/10",
};

const WALLS: Array<{ id: WallId; label: string }> = [
  { id: "south", label: "Юг" },
  { id: "north", label: "Север" },
  { id: "west", label: "Запад" },
  { id: "east", label: "Восток" },
];

const ROT: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];

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
  const drag = useRef<{
    id: string;
    corner?: "se";
    ox: number;
    oy: number;
    startNx: number;
    startNy: number;
    startNw: number;
    startNh: number;
    nx: number;
    ny: number;
    nw: number;
    nh: number;
  } | null>(null);
  const [liveOv, setLiveOv] = useState<{ id: string; nx: number; ny: number; nw: number; nh: number } | null>(null);
  const selectedId = store.selectedIds[0];
  const mode = store.photoTool;

  useEffect(() => {
    void loadMedia(photoId).then(setSrc);
    setScale(1);
    setPending(null);
  }, [photoId]);

  if (!photo) return <div className="p-3 text-[12px] text-muted">Фото не найдено</div>;

  const cal = photoCalibration(photo);
  const known = parseLengthToMeters(len);
  const overlays = photo.overlays ?? [];
  const selected = overlays.find((o) => o.id === selectedId || o.linkedObjectId === selectedId);

  const isSel = (oId: string, linked?: string) => selectedId === oId || (linked != null && selectedId === linked);

  const normFromEvent = (e: { clientX: number; clientY: number }) => {
    const box = imgRef.current?.getBoundingClientRect();
    if (!box || box.width < 1 || box.height < 1) return null;
    return {
      nx: (e.clientX - box.left) / box.width,
      ny: (e.clientY - box.top) / box.height,
    };
  };

  const onTap = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointers.current.size > 1 || pinch.current) return;
    const n = normFromEvent(e);
    if (!n || n.nx < 0 || n.ny < 0 || n.nx > 1 || n.ny > 1) return;

    if (mode === "select") {
      const hit = [...overlays].reverse().find((o) => overlayHit(o, n.nx, n.ny));
      store.select(hit ? [hit.linkedObjectId ?? hit.id] : []);
      return;
    }

    if (mode !== "calibrate") {
      store.addPhotoOverlay(photoId, mode, n.nx, n.ny);
      store.setPhotoTool("select");
      return;
    }

    if (!pending) {
      setPending({ nx: n.nx, ny: n.ny });
      return;
    }
    if (!(known && known > 0)) {
      store.pushGrok({
        id: `rv${Date.now()}`,
        role: "assistant",
        text: "Калибровка: введите известную длину A–B (например 2,43 m), затем повторите точки.",
      });
      setPending(null);
      return;
    }
    const aId = nid("mk");
    const bId = nid("mk");
    store.annotatePhoto(
      photoId,
      { id: aId, nx: pending.nx, ny: pending.ny, kind: "point", label: "A", pairId: bId },
      { id: bId, nx: n.nx, ny: n.ny, kind: "point", label: "B", pairId: aId },
      { kind: "point", knownLengthM: known },
    );
    setPending(null);
    setLen("");
  };

  const pairs: Array<{ ax: number; ay: number; bx: number; by: number }> = [];
  for (const m of photo.markers) {
    if (!m.pairId || m.label !== "A") continue;
    const b = photo.markers.find((x) => x.id === m.pairId);
    if (b) pairs.push({ ax: m.nx, ay: m.ny, bx: b.nx, by: b.ny });
  }

  const applyAll = () => {
    const res = store.applyPhotoOverlaysToModel(photoId);
    if (!res.ok) return;
    store.openSheet("props", "half");
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-mf-id="photo-workspace">
      <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1">
        <button
          type="button"
          data-mf-id="kind-point"
          className={cn("h-11 min-w-[44px] rounded-[8px] px-2 text-[11px] uppercase", mode === "calibrate" ? "bg-raised text-fg" : "text-muted")}
          onClick={() => store.setPhotoTool("calibrate")}
        >
          Калибр
        </button>
        <button
          type="button"
          data-mf-id="photo-select"
          className={cn("h-11 min-w-[44px] rounded-[8px] px-2 text-[11px] uppercase", mode === "select" ? "bg-raised text-fg" : "text-muted")}
          onClick={() => store.setPhotoTool("select")}
        >
          Выбор
        </button>
        {PHOTO_OVERLAY_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            data-mf-id={`kind-${k}`}
            className={cn("h-11 min-w-[44px] rounded-[8px] px-2 text-[11px] uppercase", mode === k ? "bg-raised text-fg" : "text-muted")}
            onClick={() => store.setPhotoTool(k)}
          >
            {PHOTO_OVERLAY_LABEL_RU[k]}
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
            drag.current = null;
            return;
          }
          if (mode !== "select") return;
          const n = normFromEvent(e);
          if (!n) return;
          const hit = [...overlays].reverse().find((o) => overlayHit(o, n.nx, n.ny));
          if (!hit) return;
          store.select([hit.linkedObjectId ?? hit.id]);
          const nearSe = Math.abs(n.nx - (hit.nx + hit.nw)) < 0.04 && Math.abs(n.ny - (hit.ny + hit.nh)) < 0.04;
          drag.current = {
            id: hit.id,
            corner: nearSe ? "se" : undefined,
            ox: n.nx,
            oy: n.ny,
            startNx: hit.nx,
            startNy: hit.ny,
            startNw: hit.nw,
            startNh: hit.nh,
            nx: hit.nx,
            ny: hit.ny,
            nw: hit.nw,
            nh: hit.nh,
          };
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch.current && pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            setScale(Math.min(4, Math.max(1, pinch.current.scale * (dist / pinch.current.dist))));
            return;
          }
          const d = drag.current;
          if (!d) return;
          const n = normFromEvent(e);
          if (!n) return;
          let nx = d.startNx;
          let ny = d.startNy;
          let nw = d.startNw;
          let nh = d.startNh;
          if (d.corner === "se") {
            nw = Math.min(0.9, Math.max(0.04, d.startNw + (n.nx - d.ox)));
            nh = Math.min(0.9, Math.max(0.04, d.startNh + (n.ny - d.oy)));
          } else {
            nx = Math.min(1 - d.startNw, Math.max(0, d.startNx + (n.nx - d.ox)));
            ny = Math.min(1 - d.startNh, Math.max(0, d.startNy + (n.ny - d.oy)));
          }
          drag.current = { ...d, nx, ny, nw, nh };
          setLiveOv({ id: d.id, nx, ny, nw, nh });
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          const d = drag.current;
          drag.current = null;
          if (d) {
            store.updatePhotoOverlay(photoId, d.id, { nx: d.nx, ny: d.ny, nw: d.nw, nh: d.nh });
            setLiveOv(null);
          }
          if (pointers.current.size < 2) {
            const wasPinch = Boolean(pinch.current);
            pinch.current = null;
            if (!wasPinch && !d) onTap(e);
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
            {overlays.map((o) => {
              const vis = liveOv && liveOv.id === o.id ? { ...o, ...liveOv } : o;
              return (
                <div
                  key={o.id}
                  data-mf-id={`photo-overlay-${o.kind}`}
                  data-mf-overlay={o.id}
                  data-mf-linked={o.linkedObjectId ?? ""}
                  className={cn(
                    "absolute box-border rounded-[4px] border-2",
                    OVERLAY_COLOR[o.kind],
                    isSel(o.id, o.linkedObjectId) && "ring-2 ring-cold",
                  )}
                  style={{ left: `${vis.nx * 100}%`, top: `${vis.ny * 100}%`, width: `${vis.nw * 100}%`, height: `${vis.nh * 100}%` }}
                >
                  <span className="absolute left-0.5 top-0.5 font-mono text-[9px] uppercase text-fg">
                    {PHOTO_OVERLAY_LABEL_RU[o.kind]}
                    {o.applied ? " · linked" : " · draft"}
                  </span>
                  {isSel(o.id, o.linkedObjectId) && (
                    <span className="absolute bottom-0 right-0 size-4 rounded-sm bg-cold" data-mf-id="overlay-resize" />
                  )}
                </div>
              );
            })}
            {pending && (
              <div
                className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-warn"
                style={{ left: `${pending.nx * 100}%`, top: `${pending.ny * 100}%` }}
              />
            )}
          </div>
        </div>
      </div>
      <div className="sticky bottom-0 z-10 flex flex-wrap gap-1 border-t border-border bg-surface p-2">
        <input
          suppressHydrationWarning
          inputMode="decimal"
          className="h-11 min-w-[120px] flex-1 rounded-[6px] border border-border bg-bg px-2 font-mono text-[12px]"
          data-mf-id="cal-length"
          placeholder={mode === "calibrate" ? "A–B = 2,43 m (замер)" : "длина, если известна"}
          value={len}
          onChange={(e) => setLen(e.target.value)}
        />
        <Button variant="outline" className="h-11" onClick={() => { setPending(null); setScale(1); drag.current = null; }}>
          Сброс
        </Button>
        <Button variant="default" className="h-11" data-mf-id="photo-apply" onClick={applyAll}>
          APPLY TO MODEL
        </Button>
      </div>
      {selected && (
        <div className="space-y-2 border-t border-border p-2" data-mf-id="overlay-props">
          <div className="flex flex-wrap gap-1">
            <span className="mr-1 self-center text-[10px] uppercase text-muted">Стена</span>
            {WALLS.map((w) => (
              <button
                key={w.id}
                type="button"
                data-mf-id={`overlay-wall-${w.id}`}
                className={cn("h-11 min-w-[44px] rounded-[8px] px-2 text-[11px] uppercase", selected.wallId === w.id ? "bg-raised text-fg" : "text-muted")}
                onClick={() => store.updatePhotoOverlay(photoId, selected.id, { wallId: w.id })}
              >
                {w.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1">
            <label className="text-[11px] text-muted">
              Ширина, m
              <input
                suppressHydrationWarning
                className="mt-0.5 h-11 w-full rounded-[6px] border border-border bg-bg px-2 font-mono text-[12px]"
                data-mf-id="overlay-width"
                defaultValue={String(selected.widthM)}
                key={`w-${selected.id}-${selected.widthM}`}
                onBlur={(e) => {
                  const m = parseLengthToMeters(e.target.value);
                  if (m && m > 0) store.updatePhotoOverlay(photoId, selected.id, { widthM: m });
                }}
              />
            </label>
            <label className="text-[11px] text-muted">
              Высота, m
              <input
                suppressHydrationWarning
                className="mt-0.5 h-11 w-full rounded-[6px] border border-border bg-bg px-2 font-mono text-[12px]"
                data-mf-id="overlay-height"
                defaultValue={String(selected.heightM)}
                key={`h-${selected.id}-${selected.heightM}`}
                onBlur={(e) => {
                  const m = parseLengthToMeters(e.target.value);
                  if (m && m > 0) store.updatePhotoOverlay(photoId, selected.id, { heightM: m });
                }}
              />
            </label>
            <label className="text-[11px] text-muted">
              Низ, m
              <input
                suppressHydrationWarning
                className="mt-0.5 h-11 w-full rounded-[6px] border border-border bg-bg px-2 font-mono text-[12px]"
                data-mf-id="overlay-elev"
                defaultValue={String(selected.bottomElevationM ?? 0)}
                key={`e-${selected.id}-${selected.bottomElevationM ?? 0}`}
                onBlur={(e) => {
                  const m = parseLengthToMeters(e.target.value);
                  if (m != null) store.updatePhotoOverlay(photoId, selected.id, { bottomElevationM: m });
                }}
              />
            </label>
            <label className="text-[11px] text-muted">
              Поворот
              <select
                className="mt-0.5 h-11 w-full rounded-[6px] border border-border bg-bg px-2 font-mono text-[12px]"
                data-mf-id="overlay-rot"
                value={selected.rotationDeg}
                onChange={(e) =>
                  store.updatePhotoOverlay(photoId, selected.id, { rotationDeg: Number(e.target.value) as 0 | 90 | 180 | 270 })
                }
              >
                {ROT.map((r) => (
                  <option key={r} value={r}>
                    {r}°
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex gap-1">
            <Button variant="outline" className="h-11 flex-1" data-mf-id="overlay-dup" onClick={() => store.duplicatePhotoOverlay(photoId, selected.id)}>
              Дублировать
            </Button>
            <Button variant="outline" className="h-11 flex-1" data-mf-id="overlay-del" onClick={() => store.deletePhotoOverlay(photoId, selected.id)}>
              Удалить
            </Button>
          </div>
        </div>
      )}
      <div className="px-2 pb-2 font-mono text-[11px] text-muted">
        {cal
          ? `Масштаб ${(cal.scaleMPerPx * 1000).toFixed(2)} mm/px · ${cal.provenance}`
          : "Нет калибровки — укажите известную длину A–B"}
        {photo.wallHint ? ` · стена ${photo.wallHint}` : " · стена не задана"}
        . Не сантиметровая точность. Не фотограмметрия.
      </div>
    </div>
  );
}
