import { useState } from "react";
import { Box, Camera, DoorOpen, Fan, MousePointer2, Plus, Sparkles, Wind } from "lucide-react";
import { useProjectStore, type CadTool } from "@/project/store";
import { PHOTO_OVERLAY_KINDS, PHOTO_OVERLAY_LABEL_RU } from "@/engineering/photo-overlay";
import { emptyRectangularProject, undergroundParkingFarm } from "@/project/factory";
import { cn } from "@/lib/utils";
import type { PhotoOverlayKind } from "@/engineering/types";
import { ProjectPortability } from "./ProjectPortability";

const ADD_2D: Array<{ id: CadTool; label: string; icon: typeof Box }> = [
  { id: "rack", label: "Стойка", icon: Box },
  { id: "intake", label: "Приток", icon: Wind },
  { id: "exhaust", label: "Вытяжка", icon: Wind },
  { id: "fan", label: "Вентилятор", icon: Fan },
  { id: "door", label: "Дверь", icon: DoorOpen },
];

export function MobileToolbar() {
  const store = useProjectStore();
  const [addOpen, setAddOpen] = useState(false);
  const photo = store.view === "photo";

  const pick2d = (tool: CadTool) => {
    if (store.view === "3d" || store.view === "photo") store.setView("2d");
    store.setTool(tool);
    setAddOpen(false);
  };

  const pickPhoto = (kind: PhotoOverlayKind) => {
    if (store.activePhotoId) store.setView("photo");
    store.setPhotoTool(kind);
    setAddOpen(false);
  };

  return (
    <nav
      className="mf-mobile-toolbar relative z-20 flex shrink-0 items-center justify-around overflow-x-auto border-t border-border bg-surface px-0.5 pb-[max(4px,env(safe-area-inset-bottom))] pt-1 md:hidden"
      data-mf-id="toolbar"
    >
      <button
        type="button"
        title="Выбор"
        data-mf-id="tool-select"
        onClick={() => {
          store.setTool("select");
          store.setPhotoTool("select");
          setAddOpen(false);
        }}
        className={cn(
          "flex size-11 shrink-0 flex-col items-center justify-center rounded-[10px] text-muted",
          store.tool === "select" && store.photoTool === "select" && "bg-raised text-fg",
        )}
      >
        <MousePointer2 className="size-5" />
        <span className="text-[9px] leading-none">Выбор</span>
      </button>

      <div className="relative">
        <button
          type="button"
          title="Добавить"
          data-mf-id="toolbar-add"
          onClick={() => setAddOpen((v) => !v)}
          className={cn(
            "flex size-11 shrink-0 flex-col items-center justify-center rounded-[10px] text-muted",
            addOpen && "bg-raised text-fg",
          )}
        >
          <Plus className="size-5" />
          <span className="text-[9px] leading-none">Добавить</span>
        </button>
        {addOpen && (
          <div
            className="absolute bottom-12 left-1/2 z-30 w-[min(280px,calc(100vw-24px))] -translate-x-1/2 rounded-[12px] border border-border bg-panel p-2 shadow-panel"
            data-mf-id="add-menu"
          >
            <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted">
              {photo ? "На фото" : "В план"}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {photo
                ? PHOTO_OVERLAY_KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      data-mf-id={`add-${k}`}
                      className="flex h-11 min-w-[44px] items-center justify-center rounded-[8px] bg-raised px-1 text-[11px] text-fg"
                      onClick={() => pickPhoto(k)}
                    >
                      {PHOTO_OVERLAY_LABEL_RU[k]}
                    </button>
                  ))
                : ADD_2D.map((t) => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        data-mf-id={`tool-${t.id}`}
                        className="flex h-11 min-w-[44px] flex-col items-center justify-center rounded-[8px] bg-raised text-fg"
                        onClick={() => pick2d(t.id)}
                      >
                        <Icon className="size-4" />
                        <span className="text-[10px]">{t.label}</span>
                      </button>
                    );
                  })}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1">
              <button
                type="button"
                data-mf-id="add-new-project"
                className="h-11 rounded-[8px] bg-raised text-[11px] text-fg"
                onClick={() => {
                  store.loadProject(
                    emptyRectangularProject({ widthM: 6, depthM: 4, heightM: 2.8, name: "Новое помещение" }),
                    false,
                  );
                  setAddOpen(false);
                }}
              >
                Новое 6×4
              </button>
              <button
                type="button"
                data-mf-id="add-demo"
                className="h-11 rounded-[8px] bg-raised text-[11px] text-fg"
                onClick={() => {
                  store.loadProject(undergroundParkingFarm(), false);
                  setAddOpen(false);
                }}
              >
                Демо
              </button>
            </div>
            <ProjectPortability onDone={() => setAddOpen(false)} />
          </div>
        )}
      </div>

      <button
        type="button"
        title="AI"
        data-mf-id="toolbar-ai"
        onClick={() => {
          setAddOpen(false);
          if (store.sheet !== "closed" && store.sheetTab === "grok") store.setSheet("closed");
          else store.openSheet("grok", store.sheet === "closed" ? "half" : store.sheet);
        }}
        className={cn(
          "flex size-11 shrink-0 flex-col items-center justify-center rounded-[10px] text-muted",
          store.sheet !== "closed" && store.sheetTab === "grok" && "bg-raised text-fg",
        )}
      >
        <Sparkles className="size-5" />
        <span className="text-[9px] leading-none">AI</span>
      </button>

      <button
        type="button"
        title="Reality"
        data-mf-id="toolbar-reality"
        onClick={() => {
          setAddOpen(false);
          if (store.activePhotoId) store.setView("photo");
          store.openSheet("reality", store.sheet !== "closed" && store.sheetTab === "reality" ? "closed" : "half");
        }}
        className={cn(
          "flex size-11 shrink-0 flex-col items-center justify-center rounded-[10px] text-muted",
          ((store.sheet !== "closed" && store.sheetTab === "reality") || store.view === "photo") && "bg-raised text-fg",
        )}
      >
        <Camera className="size-5" />
        <span className="text-[9px] leading-none">Reality</span>
      </button>

      <button
        type="button"
        title="2D / 3D"
        onClick={() => {
          setAddOpen(false);
          store.setView(store.view === "3d" ? "2d" : "3d");
        }}
        data-mf-id="toolbar-3d"
        className={cn(
          "flex size-11 shrink-0 flex-col items-center justify-center rounded-[10px] text-muted",
          store.view === "3d" && "bg-raised text-fg",
        )}
      >
        <span className="font-mono text-[11px]">{store.view === "3d" ? "2D" : "3D"}</span>
        <span className="text-[9px] leading-none">2D/3D</span>
      </button>
    </nav>
  );
}
