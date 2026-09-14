import { lazy, Suspense, useEffect } from "react";
import { Cad2D } from "@/components/cad/Cad2D";
import { PhotoAnnotator } from "@/components/reality/PhotoAnnotator";
import { useLiveProject, useLiveResult, useProjectStore } from "@/project/store";
import { emptyRectangularProject, undergroundParkingFarm } from "@/project/factory";
import { loadLastProject } from "@/project/persistence";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HUD_SAFETY_LABEL_RU } from "@/engineering/capacity";
import { FAILURE_LABELS } from "@/ai/failure";

const Twin3D = lazy(() => import("@/components/twin/Twin3D").then((m) => ({ default: m.Twin3D })));

const xrayKeys = [
  { id: "airflow" as const, label: "Воздух" },
  { id: "temperature" as const, label: "Темп." },
  { id: "electrical" as const, label: "Электр." },
  { id: "warnings" as const, label: "Warnings" },
];

export function Workspace() {
  const store = useProjectStore();
  const project = useLiveProject();
  const result = useLiveResult();
  const safety = result.capacity.safety;
  const verifiedGreen = result.capacity.verified;
  const safetyTone = verifiedGreen ? "text-ok" : safety === "OVER_CAPACITY" || safety === "PRELIMINARY" ? "text-warn" : "text-crit";

  useEffect(() => {
    void loadLastProject()
      .then((p) => {
        if (p) store.loadProject(p, false);
      })
      .catch(() => undefined);
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      }
      if (e.key === "Escape") {
        store.select([]);
        store.setTool("select");
        store.cancelProposed();
        store.setInspectorOpen(false);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const t = e.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
        store.deleteSelected();
      }
      if (e.key.toLowerCase() === "m" && !(e.target as HTMLElement).closest("input")) store.setTool("measure");
      if (e.key === "1") store.setView("2d");
      if (e.key === "2") store.setView("3d");
      if (e.key === "3") store.setView("split");
      if (e.key === "4") store.setView("photo");
      if (e.key.toLowerCase() === "g" && !meta) store.toggleGrid();
      if (e.key.toLowerCase() === "s" && !meta) store.toggleSnap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = store.view;
  const realitySheetOpen = store.sheet !== "closed" && store.sheetTab === "reality";
  const photoWorkspace = view === "photo" && Boolean(store.activePhotoId) && !realitySheetOpen;
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden" data-mf-id="workspace">
      {photoWorkspace && store.activePhotoId && <PhotoAnnotator photoId={store.activePhotoId} />}
      {!photoWorkspace && view === "2d" && <Cad2D />}
      {!photoWorkspace && view === "photo" && <Cad2D />}
      {!photoWorkspace && view === "3d" && (
        <Suspense fallback={<div className="flex h-full items-center justify-center text-[12px] text-muted">Digital Twin…</div>}>
          <Twin3D />
        </Suspense>
      )}
      {!photoWorkspace && view === "split" && (
        <div className="grid h-full min-h-0 grid-cols-2 max-md:grid-cols-1">
          <div className="min-h-0 border-r border-border">
            <Cad2D />
          </div>
          <div className="min-h-0">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-[12px] text-muted">Digital Twin…</div>}>
              <Twin3D />
            </Suspense>
          </div>
        </div>
      )}

      <button
        type="button"
        className="absolute right-3 top-3 z-10 hidden rounded-[10px] border border-border bg-panel/95 px-3 py-2 text-left shadow-panel md:block"
        onClick={() => {
          store.setWhyOpen(true);
          store.setInspectorOpen(true);
        }}
      >
        <div
          className="font-mono text-[16px] leading-tight tabular sm:text-[18px]"
          data-mf-id="hud-safe"
          data-mf-hud="desktop"
          data-mf-safe={result.capacity.safe ?? ""}
          data-mf-requested={project.fleet.requestedCount}
          data-mf-confidence={result.capacity.confidence}
          data-mf-safety={safety}
          data-mf-verified={verifiedGreen ? "1" : "0"}
        >
          <span className="text-fg">{project.fleet.requestedCount}</span>
          <span className="text-muted"> REQUESTED / </span>
          <span className={safetyTone}>{result.capacity.safe ?? "—"} SAFE</span>
        </div>
        <div className={cn("mt-0.5 text-[10px] uppercase tracking-[0.12em]", safetyTone)}>
          {HUD_SAFETY_LABEL_RU[safety]} · {result.capacity.bottlenecks.join(" · ") || "—"} · {result.capacity.confidence}
        </div>
      </button>

      {(store.mode === "xray" || view !== "2d") && (
        <div className="absolute left-3 top-14 z-10 hidden gap-1 rounded-[10px] border border-border bg-panel/95 p-1 md:flex">
          {xrayKeys.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => store.setXray({ [k.id]: !store.xray[k.id] })}
              className={cn(
                "h-7 rounded-[8px] px-2 text-[11px]",
                store.xray[k.id] ? "bg-raised text-fg" : "text-muted hover:text-fg",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}

      {store.firstRun && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg/80 p-4">
          <div className="w-full max-w-lg rounded-[14px] border border-border bg-panel p-5">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted">MINEFORGE 3D</div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">Спроектировать ферму до стройки</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              Тяните стены, ставьте проёмы, задайте мощность и ASIC — ядро посчитает, сколько аппаратов объект реально
              выдержит и что является узким местом.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button
                variant="default"
                className="h-10"
                onClick={() => {
                  store.loadProject(undergroundParkingFarm(), false);
                  store.dismissFirstRun();
                }}
              >
                Открыть демо: подземный паркинг 30 × S21 Pro
              </Button>
              <Button
                variant="outline"
                className="h-10"
                onClick={() => {
                  store.loadProject(emptyRectangularProject({ widthM: 6, depthM: 4, heightM: 2.8, name: "Новое помещение" }), false);
                  store.dismissFirstRun();
                }}
              >
                Новое помещение 6 × 4 × 2.8 m
              </Button>
              <button type="button" className="text-[12px] text-muted" onClick={() => store.dismissFirstRun()}>
                Продолжить текущий проект
              </button>
            </div>
          </div>
        </div>
      )}

      {store.failureSim !== "none" && (
        <button
          type="button"
          className="absolute left-3 top-3 z-10 rounded-[10px] border border-warn bg-panel/95 px-3 py-2 text-left text-[12px] text-warn md:top-14"
          onClick={() => store.setFailureSim("none")}
        >
          СИМУЛЯЦИЯ · {FAILURE_LABELS[store.failureSim]}
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted">Нажмите, чтобы выключить</div>
        </button>
      )}

      {store.proposed && (
        <div className="absolute bottom-4 left-1/2 z-20 w-[min(480px,calc(100%-24px))] -translate-x-1/2 rounded-[14px] border border-border bg-panel p-3 shadow-panel">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted">Предложение {store.proposed.fromGrok ? "Grok" : "ядра"}</div>
          <div className="mt-1 text-[14px] font-medium">{store.proposed.summary}</div>
          <div className="mt-1 text-[12px] text-muted">{store.proposed.detail}</div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="default"
              onClick={() => {
                store.duplicateScenario("Before");
                store.applyProposed();
              }}
            >
              APPLY
            </Button>
            <Button variant="outline" onClick={() => store.cancelProposed()}>
              CANCEL
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
