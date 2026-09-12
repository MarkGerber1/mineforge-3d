import { useRef } from "react";
import { useProjectStore } from "@/project/store";
import { resizeImageFile, saveMedia } from "@/reality/media";
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

export function RealityPanel() {
  const store = useProjectStore();
  const reality = store.project.reality ?? emptyReality();
  const fileRef = useRef<HTMLInputElement>(null);
  const q = nextInterviewQuestion(store.project);
  const active = reality.photos.find((p) => p.id === store.activePhotoId);
  const cal = active ? photoCalibration(active) : null;

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of [...files].slice(0, 6)) {
      if (file.type.startsWith("video/")) {
        store.pushGrok({
          id: `rv${Date.now()}`,
          role: "assistant",
          text: "Видео принято как visual evidence. Сантиметровая точность по видео не заявляется — извлеките ключевой кадр или поставьте контрольный размер.",
        });
        continue;
      }
      if (!file.type.startsWith("image/")) continue;
      const { dataUrl, widthPx, heightPx } = await resizeImageFile(file);
      const id = nid("photo");
      await saveMedia(id, dataUrl);
      store.addPhotoMeta({
        id,
        name: file.name,
        mime: file.type,
        createdAt: Date.now(),
        notes: "",
        widthPx,
        heightPx,
        markers: [],
      });
      store.setPendingImages([...store.pendingImages, dataUrl].slice(-3));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface" data-mf-id="reality">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted">Reality Sync</div>
        <div className="flex gap-1">
          {(["as-designed", "as-built", "deviation"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`rounded-[6px] px-2 py-1 text-[10px] uppercase ${reality.compareMode === m ? "bg-raised text-fg" : "text-muted"}`}
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
      <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden" suppressHydrationWarning onChange={(e) => void onFiles(e.target.files)} />
      <div className="px-3">
        <Button variant="outline" className="h-10 w-full" onClick={() => fileRef.current?.click()}>
          Прикрепить фото / видео
        </Button>
      </div>
      {q && <div className="mx-3 mt-2 rounded-[10px] border border-border bg-panel p-2 text-[12px] text-fg">{q}</div>}
      <div className="flex gap-1 overflow-x-auto px-3 py-2">
        {reality.photos.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => store.setActivePhoto(p.id)}
            className={`h-8 shrink-0 rounded-[6px] border px-2 text-[11px] ${store.activePhotoId === p.id ? "border-cold text-fg" : "border-border text-muted"}`}
          >
            {p.name.slice(0, 18)}
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
              className={`rounded-[6px] px-2 py-1 text-[10px] uppercase ${active.wallHint === w.id ? "bg-raised text-fg" : "text-muted"}`}
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
      <div className="min-h-0 flex-1">
        {store.activePhotoId ? (
          <PhotoAnnotator photoId={store.activePhotoId} />
        ) : (
          <div className="p-3 text-[12px] text-muted">
            Фото — visual evidence. Калибр A–B с известной длиной задаёт масштаб кадра. Аннотации (дверь, шахта, балка, стена) становятся геометрией Engineering Core только после ADD TO MODEL. До подтверждения — PHOTO ESTIMATE, не сантиметры.
          </div>
        )}
      </div>
      {reality.findings.filter((f) => f.status === "PENDING").length > 0 && (
        <div className="max-h-32 space-y-1 overflow-auto border-t border-border p-2">
          {reality.findings
            .filter((f) => f.status === "PENDING")
            .map((f) => (
              <div key={f.id} className="rounded-[8px] border border-border p-2 text-[12px]">
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
                  <Button size="sm" disabled={Boolean(f.incomplete)} onClick={() => store.resolveFinding(f.id, "ADDED")}>
                    ADD TO MODEL
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => store.resolveFinding(f.id, "IGNORED")}>
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
