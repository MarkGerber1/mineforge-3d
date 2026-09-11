import { useRef } from "react";
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
  { id: "reality", label: "Фото" },
  { id: "app", label: "App" },
];

export function BottomSheet() {
  const store = useProjectStore();
  const startY = useRef(0);
  const startState = useRef(store.sheet);
  if (store.sheet === "closed") return null;
  const h = store.sheet === "full" ? "92%" : "48%";
  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 flex flex-col md:hidden"
      style={{ height: h, paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <button type="button" className="h-8 shrink-0" aria-label="Свернуть" onClick={() => store.setSheet("closed")} />
      <div className="flex min-h-0 flex-1 flex-col rounded-t-[16px] border border-border bg-surface shadow-panel">
        <div
          className="flex cursor-grab justify-center py-2"
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
              onClick={() => {
                store.setSheetTab(t.id);
                if (t.id === "why") store.setWhyOpen(true);
              }}
              className={cn(
                "h-9 min-w-[44px] flex-1 rounded-[8px] text-[12px]",
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
