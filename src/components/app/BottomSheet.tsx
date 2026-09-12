import { useEffect, useRef } from "react";
import { useProjectStore, type SheetTab } from "@/project/store";
import { Inspector } from "./Inspector";
import { GrokPanel } from "./GrokPanel";
import { RealityPanel } from "../reality/RealityPanel";
import { AppEditPanel } from "./AppEditPanel";
import { cn } from "@/lib/utils";

const tabs: Array<{ id: SheetTab; label: string }> = [
  { id: "props", label: "Объект" },
  { id: "why", label: "SAFE" },
  { id: "grok", label: "AI" },
  { id: "reality", label: "Reality" },
  { id: "app", label: "App" },
];

export function BottomSheet() {
  const store = useProjectStore();
  const startY = useRef(0);
  const startState = useRef(store.sheet);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      const kbd = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--mf-kbd", `${kbd}px`);
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);

  if (store.sheet === "closed") return null;
  const h = store.sheet === "full" ? "92%" : "48%";
  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 flex flex-col md:hidden"
      data-mf-id="sheet"
      data-mf-sheet={store.sheet}
      data-mf-tab={store.sheetTab}
      style={{ height: h, paddingBottom: "max(env(safe-area-inset-bottom), var(--mf-kbd, 0px))" }}
    >
      <button type="button" className="h-11 shrink-0" aria-label="Свернуть" data-mf-id="sheet-dismiss" onClick={() => store.setSheet("closed")} />
      <div className="flex min-h-0 flex-1 flex-col rounded-t-[16px] border border-border bg-surface shadow-panel">
        <div
          className="flex cursor-grab justify-center py-2"
          data-mf-id="sheet-handle"
          onPointerDown={(e) => {
            startY.current = e.clientY;
            startState.current = store.sheet;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
          onPointerUp={(e) => {
            const dy = e.clientY - startY.current;
            if (dy > 70) store.setSheet(startState.current === "full" ? "half" : "closed");
            else if (dy < -70) store.setSheet("full");
          }}
        >
          <div className="h-1 w-10 rounded-full bg-border-strong" />
        </div>
        <div className="flex gap-1 px-2 pb-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              data-mf-id={`sheet-tab-${t.id}`}
              onClick={() => {
                store.setSheetTab(t.id);
                if (t.id === "why") store.setWhyOpen(true);
              }}
              className={cn(
                "h-11 min-w-[44px] flex-1 rounded-[8px] text-[12px]",
                store.sheetTab === t.id ? "bg-raised text-fg" : "text-muted",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {(store.sheetTab === "props" || store.sheetTab === "why") && <Inspector hideGrok />}
          {store.sheetTab === "grok" && <GrokPanel fill />}
          {store.sheetTab === "reality" && <RealityPanel />}
          {store.sheetTab === "app" && <AppEditPanel />}
        </div>
      </div>
    </div>
  );
}