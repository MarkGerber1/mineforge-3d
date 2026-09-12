import { useEffect, useState } from "react";
import { TopBar } from "./TopBar";
import { LeftSidebar } from "./LeftSidebar";
import { Inspector } from "./Inspector";
import { BottomBar } from "./BottomBar";
import { Workspace } from "./Workspace";
import { CommandBar } from "./CommandBar";
import { MobileHud } from "./MobileHud";
import { MobileToolbar } from "./MobileToolbar";
import { BottomSheet } from "./BottomSheet";
import { UiPickOverlay } from "./UiPickOverlay";
import { AppEditPanel } from "./AppEditPanel";
import { RealityPanel } from "../reality/RealityPanel";
import { useProjectStore } from "@/project/store";

/** Tailwind `md` = 768. Avoid mounting desktop Inspector/Grok twice on iPhone. */
function useMdUp(): boolean {
  const [md, setMd] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setMd(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return md;
}

function DesktopAppEdit() {
  const store = useProjectStore();
  const open = Boolean(store.pendingAppEdit) || store.uiPick || (store.sheet !== "closed" && store.sheetTab === "app");
  if (!open) return null;
  return (
    <div className="absolute right-0 top-12 z-40 hidden h-[calc(100%-48px-56px)] w-[360px] flex-col border-l border-border bg-surface shadow-panel md:flex">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1">
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted">App edit</span>
        <button type="button" className="h-8 px-2 text-[12px] text-muted" onClick={() => store.setSheet("closed")}>
          Закрыть
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <AppEditPanel />
      </div>
    </div>
  );
}

function DesktopReality() {
  const store = useProjectStore();
  const open = store.sheet !== "closed" && store.sheetTab === "reality";
  if (!open) return null;
  return (
    <div className="absolute right-0 top-12 z-40 hidden h-[calc(100%-48px-56px)] w-[380px] flex-col border-l border-border bg-surface shadow-panel md:flex">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1">
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted">Reality Sync</span>
        <button type="button" className="h-8 px-2 text-[12px] text-muted" onClick={() => store.setSheet("closed")}>
          Закрыть
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <RealityPanel />
      </div>
    </div>
  );
}

export function AppShell() {
  const md = useMdUp();
  return (
    <div className="app-shell relative min-w-0 overflow-hidden">
      <TopBar />
      <div className="flex min-h-0 min-w-0 overflow-hidden">
        <LeftSidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <CommandBar />
          <Workspace />
        </div>
        {md ? (
          <div className="hidden min-h-0 min-w-0 md:flex">
            <Inspector />
          </div>
        ) : null}
      </div>
      {md ? <BottomBar /> : null}
      {md ? null : <MobileHud />}
      {md ? null : <MobileToolbar />}
      {md ? null : <BottomSheet />}
      {md ? <DesktopAppEdit /> : null}
      {md ? <DesktopReality /> : null}
      <UiPickOverlay />
    </div>
  );
}