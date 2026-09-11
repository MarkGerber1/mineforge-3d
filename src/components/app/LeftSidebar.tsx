import {
  Box,
  DoorOpen,
  Fan,
  LayoutGrid,
  MousePointer2,
  Move,
  Ruler,
  Square,
  Wind,
  Zap,
} from "lucide-react";
import { useProjectStore, type CadTool } from "@/project/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ASIC_CATALOG } from "@/equipment/asic-catalog";
import { FAN_CATALOG } from "@/equipment/fan-catalog";
import { emptyRectangularProject, undergroundParkingFarm } from "@/project/factory";

const tools: Array<{ id: CadTool; label: string; icon: typeof MousePointer2; hint: string }> = [
  { id: "select", label: "Выбор", icon: MousePointer2, hint: "V" },
  { id: "pan", label: "Панорама", icon: Move, hint: "Space" },
  { id: "measure", label: "Рулетка", icon: Ruler, hint: "M" },
  { id: "door", label: "Дверь", icon: DoorOpen, hint: "" },
  { id: "intake", label: "Приток", icon: Wind, hint: "" },
  { id: "exhaust", label: "Вытяжка", icon: Wind, hint: "" },
  { id: "rack", label: "Стойка", icon: Box, hint: "" },
];

export function LeftSidebar() {
  const store = useProjectStore();
  const p = store.project;
  return (
    <aside className="hidden w-[220px] shrink-0 flex-col border-r border-border bg-surface md:flex" data-mf-id="sidebar">
      <div className="grid grid-cols-4 gap-1 p-2 max-md:grid-cols-1">
        {tools.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              title={t.label}
              onClick={() => store.setTool(t.id)}
              className={cn(
                "flex h-9 items-center justify-center rounded-[8px] text-muted hover:bg-raised hover:text-fg",
                store.tool === t.id && "bg-raised text-fg",
              )}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
      </div>
      <div className="hidden flex-1 overflow-auto p-3 md:block">
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted">Объекты</div>
        <ul className="mt-2 space-y-1 text-[12px]">
          <li className="text-muted">Комната {p.room.widthM.toFixed(2)}×{p.room.depthM.toFixed(2)}</li>
          {p.openings.map((o) => (
            <li key={o.id}>
              <button type="button" className="w-full truncate text-left hover:text-fg" onClick={() => store.select([o.id])}>
                {o.name ?? o.type}
              </button>
            </li>
          ))}
          {p.racks.map((r) => (
            <li key={r.id}>
              <button type="button" className="w-full truncate text-left hover:text-fg" onClick={() => store.select([r.id])}>
                {r.name}
              </button>
            </li>
          ))}
          {p.fans.map((f) => (
            <li key={f.id}>
              <button type="button" className="w-full truncate text-left hover:text-fg" onClick={() => store.select([f.id])}>
                {f.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-col gap-1">
          <Button variant="outline" onClick={() => store.autoLayout()}>
            <LayoutGrid className="size-3.5" /> Авторасстановка
          </Button>
          <Button variant="outline" onClick={() => store.setFan(FAN_CATALOG[0].id, 1, "single")}>
            <Fan className="size-3.5" /> Вентилятор
          </Button>
          <Button variant="outline" onClick={() => store.setMode("xray")}>
            <Zap className="size-3.5" /> Электрика
          </Button>
        </div>
        <div className="mt-4 text-[10px] uppercase tracking-[0.12em] text-muted">ASIC</div>
        <div className="mt-1 space-y-1">
          {ASIC_CATALOG.filter((a) => a.source.trust !== "TEST_FIXTURE").map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => store.setFleet(a.id, store.project.fleet.requestedCount || 30)}
              className={cn(
                "flex w-full items-center justify-between rounded-[8px] px-2 py-1 text-left text-[12px] hover:bg-raised",
                p.fleet.asicId === a.id && "bg-raised",
              )}
            >
              <span>{a.model}</span>
              <span className="font-mono text-[10px] text-muted">{a.hashrateThs} T</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-1 text-[11px] text-subtle">
          <Square className="size-3" /> Snap {store.snapMode}
        </div>
        <div className="mt-4 flex flex-col gap-1">
          <Button
            variant="outline"
            onClick={() => store.loadProject(undergroundParkingFarm(), false)}
          >
            Демо паркинг
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              store.loadProject(emptyRectangularProject({ widthM: 6, depthM: 4, heightM: 2.8, name: "Новое помещение" }), false)
            }
          >
            Новое 6×4×2.8
          </Button>
        </div>
      </div>
    </aside>
  );
}
