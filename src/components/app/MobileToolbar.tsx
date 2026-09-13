import { Box, Camera, CheckSquare, DoorOpen, MousePointer2, Move, Ruler, Wind } from "lucide-react";
import { useProjectStore, type CadTool } from "@/project/store";
import { cn } from "@/lib/utils";

const tools: Array<{ id: CadTool; label: string; icon: typeof MousePointer2 }> = [
  { id: "select", label: "Выбор", icon: MousePointer2 },
  { id: "pan", label: "Pan", icon: Move },
  { id: "measure", label: "Мер", icon: Ruler },
  { id: "door", label: "Дверь", icon: DoorOpen },
  { id: "exhaust", label: "Шахта", icon: Wind },
  { id: "rack", label: "Стойка", icon: Box },
];

export function MobileToolbar() {
  const store = useProjectStore();
  return (
    <nav
      className="mf-mobile-toolbar relative z-20 flex shrink-0 items-center justify-around overflow-x-auto border-t border-border bg-surface px-0.5 pb-[max(4px,env(safe-area-inset-bottom))] pt-1 md:hidden"
      data-mf-id="toolbar"
    >
      {tools.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            title={t.label}
            data-mf-id={`tool-${t.id}`}
            onClick={() => store.setTool(t.id)}
            className={cn(
              "flex size-11 shrink-0 flex-col items-center justify-center rounded-[10px] text-muted",
              store.tool === t.id && "bg-raised text-fg",
            )}
          >
            <Icon className="size-5" />
            <span className="text-[9px] leading-none">{t.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        title="Несколько"
        onClick={() => store.setMultiSelect(!store.multiSelect)}
        className={cn(
          "flex size-11 shrink-0 flex-col items-center justify-center rounded-[10px] text-muted",
          store.multiSelect && "bg-raised text-fg",
        )}
      >
        <CheckSquare className="size-5" />
        <span className="text-[9px] leading-none">Мульти</span>
      </button>
      <button
        type="button"
        title="Reality"
        data-mf-id="toolbar-reality"
        onClick={() =>
          store.openSheet("reality", store.sheet !== "closed" && store.sheetTab === "reality" ? "closed" : "half")
        }
        className={cn(
          "flex size-11 shrink-0 flex-col items-center justify-center rounded-[10px] text-muted",
          store.sheet !== "closed" && store.sheetTab === "reality" && "bg-raised text-fg",
        )}
      >
        <Camera className="size-5" />
        <span className="text-[9px] leading-none">Факт</span>
      </button>
      <button
        type="button"
        onClick={() => store.setView(store.view === "3d" ? "2d" : "3d")}
        data-mf-id="toolbar-3d"
        className={cn(
          "flex size-11 shrink-0 flex-col items-center justify-center rounded-[10px] text-muted",
          store.view === "3d" && "bg-raised text-fg",
        )}
      >
        <span className="font-mono text-[11px]">3D</span>
        <span className="text-[9px] leading-none">Twin</span>
      </button>
    </nav>
  );
}
