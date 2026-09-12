import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/project/store";
import { loadMedia, resizeImageFile, saveMedia } from "@/reality/media";
import { extractVideoFrames } from "@/reality/video";
import { VIDEO_ERROR_RU, VIDEO_LIMITS } from "@/reality/video-policy";
import { nextInterviewQuestion } from "@/reality/interview";
import { photoCalibration } from "@/engineering/reality";
import { PhotoAnnotator } from "./PhotoAnnotator";
import { Button } from "@/components/ui/button";
import { nid } from "@/project/factory";
import { emptyReality, type WallId } from "@/engineering/types";

const WALLS: Array<{ id: WallId; label: string }> = [
  { id: "south", label: "Юг" },
  { id: "north", label: "Север" },
  { id: "west", label: "Запад" },
  { id: "east", label: "Восток" },
];

function FrameThumb({ id, selected, ts, onOpen, onSelect, onDelete }: {
  id: string;
  selected: boolean;
  ts: number;
  onOpen: () => void;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    void loadMedia(id).then(setSrc);
  }, [id]);
  return (
    <div
      className={`w-[104px] shrink-0 rounded-[8px] border p-1 ${selected ? "border-cold" : "border-border"}`}
      data-mf-id={`frame-${id}`}
      data-mf-ts={ts}
    >
      <button type="button" className="block h-14 w-full overflow-hidden rounded-[6px] bg-bg" onClick={onOpen}>
        {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span className="text-[10px] text-muted">…</span>}
      </button>
      <div className="mt-1 font-mono text-[10px] text-muted">{(ts / 1000).toFixed(2)}s</div>
      <div className="mt-1 flex gap-1">
        <button type="button" className="h-9 min-w-9 flex-1 rounded-[6px] bg-raised text-[10px]" onClick={onSelect} data-mf-id={`frame-select-${id}`}>
          {selected ? "AI ✓" : "AI"}
        </button>
        <button type="button" className="h-9 min-w-9 rounded-[6px] text-[10px] text-muted" onClick={onDelete}>
          ×
        </button>
      </div>
    </div>
  );
}

export function RealityPanel() {
  const store = useProjectStore();
  const reality = store.project.reality ?? emptyReality();
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const q = nextInterviewQuestion(store.project);
  const active = reality.photos.find((p) => p.id === store.activePhotoId);
  const cal = active ? photoCalibration(active) : null;
  const videos = reality.videos ?? [];

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const ingestVideo = async (file: File) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    store.setVideoJob({ status: "processing" });
    const res = await extractVideoFrames(file, { signal: ac.signal });
    if (ac.signal.aborted) {
      store.setVideoJob({ status: "idle" });
      return;
    }
    if (!res.ok) {
      store.setVideoJob({ status: "failed", error: res.error, errorText: res.errorText });
      store.pushGrok({
        id: `rv${Date.now()}`,
        role: "assistant",
        text: res.errorText ?? VIDEO_ERROR_RU[res.error ?? "VIDEO_DECODE_FAILED"],
      });
      return;
    }
    for (const f of res.frames) {
      await saveMedia(f.photo.id, f.dataUrl);
    }
    store.commitVideoEvidence(
      res.video,
      res.frames.map((f) => f.photo),
    );
    store.setVideoJob({ status: "idle", videoId: res.video.id });
    store.pushGrok({
      id: `rv${Date.now()}`,
      role: "assistant",
      text: `Видео ${file.name}: ${res.frames.length} кадров (не FIELD_MEASUREMENT). Исходный файл не сохраняется — только кадры. Калибр A–B с известной длиной, затем ADD TO MODEL.`,
    });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of [...files].slice(0, 6)) {
      if (file.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(file.name)) {
        await ingestVideo(file);
        continue;
      }
      if (!file.type.startsWith("image/")) continue;
      const { dataUrl, widthPx, heightPx } = await resizeImageFile(file);
      const id = nid("photo");
      await saveMedia(id, dataUrl);
      store.addPhotoMeta({
        id,
        name: file.name,
        mime: file.type || "image/jpeg",
        createdAt: Date.now(),
        notes: "",
        kind: "photo",
        widthPx,
        heightPx,
        markers: [],
      });
      store.setPendingImages([...store.pendingImages, dataUrl].slice(-VIDEO_LIMITS.maxAiFrames));
    }
  };

  const selectedForAi = videos.flatMap((v) => v.selectedFrameIds);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface" data-mf-id="reality">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted">Reality Sync</div>
        <div className="flex gap-1" data-mf-id="compare">
          {(["as-designed", "as-built", "deviation"] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-mf-id={`compare-${m}`}
              className={`h-11 min-w-[44px] rounded-[8px] px-2 text-[11px] uppercase ${reality.compareMode === m ? "bg-raised text-fg" : "text-muted"}`}
              onClick={() =>
                store.commit(
                  { ...store.project, reality: { ...reality, compareMode: m } },
                  "Compare mode",
                )
              }
            >
              {m === "as-designed" ? "Проект" : m === "as-built" ? "Факт" : "Δ"}
            </button>
          ))}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*,.mp4,.mov,.webm,.m4v"
        multiple
        className="hidden"
        data-mf-id="reality-file"
        suppressHydrationWarning
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="px-3">
        <Button variant="outline" className="h-11 w-full" data-mf-id="reality-attach" onClick={() => fileRef.current?.click()}>
          Прикрепить фото / видео
        </Button>
      </div>
      {store.videoJob.status === "processing" && (
        <div className="mx-3 mt-2 flex items-center justify-between rounded-[10px] border border-border bg-panel p-2 text-[12px]" data-mf-id="video-processing">
          <span>Декодирую видео…</span>
          <Button
            size="sm"
            variant="outline"
            className="h-11"
            data-mf-id="video-cancel"
            onClick={() => {
              abortRef.current?.abort();
              store.setVideoJob({ status: "idle" });
            }}
          >
            Отмена
          </Button>
        </div>
      )}
      {store.videoJob.status === "failed" && (
        <div className="mx-3 mt-2 rounded-[10px] border border-crit/40 bg-panel p-2 text-[12px] text-warn" data-mf-id="video-error" data-mf-error={store.videoJob.error}>
          {store.videoJob.errorText ?? (store.videoJob.error ? VIDEO_ERROR_RU[store.videoJob.error] : "VIDEO DECODE FAILED")}
          <div className="mt-1 text-[11px] text-muted">Каноническая геометрия не изменена. Выберите другой файл.</div>
        </div>
      )}
      {videos.map((v) => (
        <div key={v.id} className="mx-3 mt-2 rounded-[10px] border border-border bg-panel p-2" data-mf-id={`video-${v.id}`} data-mf-video-status={v.status}>
          <div className="text-[11px] text-fg">
            {v.name} · {(v.durationMs / 1000).toFixed(2)}s · {v.frameIds.length} кадр.
          </div>
          <div className="text-[10px] text-muted">
            {v.mime} · raw video не сохраняется · VIDEO_FRAME_ESTIMATE
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto" data-mf-id="video-frames">
            {v.frameIds.map((fid) => {
              const photo = reality.photos.find((p) => p.id === fid);
              return (
                <FrameThumb
                  key={fid}
                  id={fid}
                  selected={v.selectedFrameIds.includes(fid)}
                  ts={photo?.timestampMs ?? 0}
                  onOpen={() => store.setActivePhoto(fid)}
                  onSelect={() => store.toggleFrameSelect(fid)}
                  onDelete={() => store.removePhoto(fid)}
                />
              );
            })}
          </div>
        </div>
      ))}
      {q && <div className="mx-3 mt-2 rounded-[10px] border border-border bg-panel p-2 text-[12px] text-fg">{q}</div>}
      <div className="flex gap-1 overflow-x-auto px-3 py-2">
        {reality.photos.map((p) => (
          <button
            key={p.id}
            type="button"
            data-mf-id={`photo-tab-${p.id}`}
            onClick={() => store.setActivePhoto(p.id)}
            className={`h-11 shrink-0 rounded-[8px] border px-2 text-[11px] ${store.activePhotoId === p.id ? "border-cold text-fg" : "border-border text-muted"}`}
          >
            {p.kind === "video-frame" ? `кадр ${(p.timestampMs ?? 0) / 1000}s` : p.name.slice(0, 18)}
          </button>
        ))}
      </div>
      {active && (
        <div className="flex flex-wrap items-center gap-1 px-3 pb-2">
          <span className="text-[10px] uppercase text-muted">Стена фото</span>
          {WALLS.map((w) => (
            <button
              key={w.id}
              type="button"
              data-mf-id={`wall-${w.id}`}
              className={`h-11 min-w-[44px] rounded-[8px] px-2 text-[11px] uppercase ${active.wallHint === w.id ? "bg-raised text-fg" : "text-muted"}`}
              onClick={() => store.setPhotoWallHint(active.id, w.id)}
            >
              {w.label}
            </button>
          ))}
          {cal && (
            <span className="ml-auto font-mono text-[10px] text-muted">
              {(cal.scaleMPerPx * 1000).toFixed(2)} mm/px · {cal.provenance}
            </span>
          )}
        </div>
      )}
      {selectedForAi.length > 0 && (
        <div className="px-3 pb-1 text-[10px] text-cold">
          В AI уйдёт {Math.min(selectedForAi.length, VIDEO_LIMITS.maxAiFrames)} кадр. с timestamp — не «видеофайл».
        </div>
      )}
      <div className="min-h-0 flex-1">
        {store.activePhotoId ? (
          <PhotoAnnotator photoId={store.activePhotoId} />
        ) : (
          <div className="p-3 text-[12px] text-muted">
            Фото и кадры видео — visual evidence. Калибр A–B с известной длиной задаёт масштаб кадра. Аннотации становятся геометрией Engineering Core только после ADD TO MODEL. Извлечение кадра само по себе не FIELD_MEASUREMENT и не сантиметры. Исходное видео не хранится.
          </div>
        )}
      </div>
      {reality.findings.filter((f) => f.status === "PENDING").length > 0 && (
        <div className="max-h-36 space-y-1 overflow-auto border-t border-border p-2">
          {reality.findings
            .filter((f) => f.status === "PENDING")
            .map((f) => (
              <div key={f.id} className="rounded-[8px] border border-border p-2 text-[12px]" data-mf-id={`finding-${f.id}`}>
                <div className="font-medium">NEW OBJECT · {f.kind}</div>
                <div className="text-muted">{f.summary}</div>
                <div className="text-[10px] uppercase text-warn">
                  Confidence {f.confidence} · {f.incomplete ? "INCOMPLETE — нет ADD" : "PHOTO ESTIMATE until ADD"}
                </div>
                {f.incomplete && (
                  <div className="mt-1 text-[11px] text-warn">
                    Неполная геометрия: {(f.missing ?? []).join(", ") || "unknown"}. Canonical state не изменяется.
                  </div>
                )}
                <div className="mt-1 flex gap-1">
                  <Button
                    size="sm"
                    className="h-11"
                    data-mf-id="add-to-model"
                    disabled={Boolean(f.incomplete)}
                    onClick={() => store.resolveFinding(f.id, "ADDED")}
                  >
                    ADD TO MODEL
                  </Button>
                  <Button size="sm" variant="outline" className="h-11" data-mf-id="ignore-finding" onClick={() => store.resolveFinding(f.id, "IGNORED")}>
                    IGNORE
                  </Button>
                </div>
              </div>
            ))}
        </div>
      )}
      {reality.asBuilt.length > 0 && (
        <div className="border-t border-border p-2 text-[11px] text-muted">
          As-built: {reality.asBuilt.map((o) => `${o.kind} ${o.name} (${o.provenance})`).join(" · ")}
        </div>
      )}
    </div>
  );
}
