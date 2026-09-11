import { Box, Redo2, Spline, Undo2, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/project/store";
import { cn } from "@/lib/utils";

const modes = [
  { id: "project" as const, label: "Проект", short: "Проект" },
  { id: "xray" as const, label: "Рентген", short: "Рентген" },
  { id: "twin" as const, label: "Digital Twin", short: "3D" },
];

const SCOPE_RU = {
  PROJECT: "ПРОЕКТ",
  APPLICATION: "ПРИЛОЖЕНИЕ",
  REALITY: "ОБЪЕКТ",
} as const;

export function TopBar() {
  const store = useProjectStore();
  return (
    <header
      className="flex h-11 min-w-0 items-center gap-1 overflow-hidden border-b border-border bg-surface px-1.5 sm:h-12 sm:gap-2 sm:px-3 md:h-12"
      data-mf-id="topbar"
    >
      <div className="flex shrink-0 items-center gap-1.5 pr-0.5 sm:pr-3">
        <div className="flex size-8 items-center justify-center rounded-[6px] bg-raised text-cold">
          <Box className="size-4" />
        </div>
        <div className="hidden leading-tight sm:block">
          <div className="text-[13px] font-semibold tracking-tight">MINEFORGE</div>
          <div className="hidden text-[10px] uppercase tracking-[0.14em] text-muted lg:block">Engineering twin</div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 justify-center sm:flex-none sm:justify-start">
        <div className="flex max-w-full rounded-[10px] bg-raised p-0.5">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => store.setMode(m.id)}
              className={cn(
                "h-8 shrink-0 rounded-[8px] px-2 text-[12px] font-medium sm:h-7 sm:px-3",
                store.mode === m.id ? "bg-panel text-fg" : "text-muted hover:text-fg",
              )}
            >
              <span className="md:hidden">{m.short}</span>
              <span className="hidden md:inline">{m.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="ml-1 hidden rounded-[10px] bg-raised p-0.5 md:flex">
        {(["2d", "split", "3d"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => store.setView(v)}
            className={cn(
              "h-7 rounded-[8px] px-2.5 font-mono text-[11px] uppercase",
              store.view === v ? "bg-panel text-fg" : "text-muted hover:text-fg",
            )}
          >
            {v}
          </button>
        ))}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
        <span className="hidden px-1 font-mono text-[9px] uppercase tracking-[0.12em] text-cold sm:inline">
          {SCOPE_RU[store.grokScope]}
        </span>
        <Button size="icon" className="size-10 md:size-8" onClick={() => store.undo()} title="Отменить ⌘Z">
          <Undo2 className="size-4" />
        </Button>
        <Button size="icon" className="hidden md:inline-flex" onClick={() => store.redo()} title="Повторить">
          <Redo2 className="size-4" />
        </Button>
        <Button size="icon" className="hidden md:inline-flex" onClick={() => store.setTool("measure")} title="Рулетка M">
          <Spline className="size-4" />
        </Button>
        <Button
          size="icon"
          className="hidden md:inline-flex"
          onClick={() => store.setXray({ airflow: !store.xray.airflow })}
          title="Слой воздуха"
        >
          <Layers className="size-4" />
        </Button>
        <Button
          className="hidden h-8 px-2.5 text-[12px] md:inline-flex"
          variant={store.sheet !== "closed" && store.sheetTab === "app" ? "default" : "outline"}
          onClick={() => store.openSheet("app", store.sheet !== "closed" && store.sheetTab === "app" ? "closed" : "half")}
        >
          App
        </Button>
        <Button
          className="h-9 min-w-10 px-2.5 text-[12px] md:hidden"
          variant={store.sheet !== "closed" && store.sheetTab === "grok" ? "default" : "outline"}
          onClick={() => store.openSheet("grok", store.sheet === "closed" ? "half" : "closed")}
        >
          AI
        </Button>
        {store.grokOffline && (
          <span className="hidden px-1 font-mono text-[9px] uppercase tracking-[0.12em] text-warn sm:inline">AI OFFLINE</span>
        )}
        <div className="hidden px-2 font-mono text-[11px] text-muted lg:block">
          {store.saveState === "saving" ? "Saving…" : store.saveState === "saved" ? "Saved" : "Local"}
        </div>
      </div>
    </header>
  );
}
