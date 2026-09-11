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

export function AppShell() {
  return (
    <div className="app-shell relative min-w-0 overflow-hidden">
      <TopBar />
      <div className="flex min-h-0 min-w-0 overflow-hidden">
        <LeftSidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <CommandBar />
          <Workspace />
        </div>
        <div className="hidden min-h-0 min-w-0 md:flex">
          <Inspector />
        </div>
      </div>
      <BottomBar />
      <MobileHud />
      <MobileToolbar />
      <BottomSheet />
      <UiPickOverlay />
    </div>
  );
}
