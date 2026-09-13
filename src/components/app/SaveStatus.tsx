import { useEffect } from "react";
import { useProjectStore } from "@/project/store";
import { cn } from "@/lib/utils";

const LABEL: Record<string, string> = {
  idle: "Локально",
  saving: "Сохраняется",
  saved: "Сохранено",
  error: "Ошибка сохранения",
};

export function SaveStatus() {
  const saveState = useProjectStore((s) => s.saveState);
  const saveError = useProjectStore((s) => s.saveError);
  const retrySave = useProjectStore((s) => s.retrySave);
  const shown = saveState === "error" ? (saveError ?? LABEL.error) : (LABEL[saveState] ?? LABEL.idle);

  useEffect(() => {
    const dirty = saveState === "error" || saveState === "saving";
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [saveState]);

  return (
    <div
      className={cn(
        "flex min-h-11 min-w-11 max-w-[9.5rem] items-center gap-1 px-1 font-mono text-[10px] sm:max-w-none sm:text-[11px]",
        saveState === "error" ? "text-crit" : saveState === "saved" ? "text-ok" : "text-muted",
      )}
      data-mf-id="save-status"
      data-mf-save={saveState}
      data-mf-save-error={saveError ?? ""}
      title={shown}
    >
      <span className="truncate">{shown}</span>
      {saveState === "error" && (
        <button
          type="button"
          data-mf-id="save-retry"
          className="inline-flex h-11 min-w-11 items-center justify-center rounded-[8px] border border-border bg-raised px-2 text-[11px] text-fg"
          onClick={() => retrySave()}
        >
          Повтор
        </button>
      )}
    </div>
  );
}
