import { useProjectStore } from "@/project/store";
import { findUiComponent } from "@/ai/registry";

export function UiPickOverlay() {
  const store = useProjectStore();
  if (!store.uiPick) return null;
  return (
    <div
      className="absolute inset-0 z-50 cursor-crosshair bg-bg/30"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const overlay = e.currentTarget as HTMLElement;
        overlay.style.pointerEvents = "none";
        const stack = document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[];
        overlay.style.pointerEvents = "auto";
        const node = stack.find((n) => n.dataset?.mfId);
        const id = node?.dataset.mfId;
        const meta = id ? findUiComponent(id) : undefined;
        if (meta) store.setPickedUi(meta);
        else store.setUiPick(false);
      }}
    >
      <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-[10px] border border-border bg-panel px-3 py-1 text-[12px]">
        Укажите элемент интерфейса
      </div>
    </div>
  );
}
