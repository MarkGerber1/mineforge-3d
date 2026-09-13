import { useLiveProject, useLiveResult, useProjectStore } from "@/project/store";
import { formatKw, formatM3h } from "@/engineering/units";
import { HUD_SAFETY_LABEL_RU } from "@/engineering/capacity";
import { FAILURE_LABELS } from "@/ai/failure";
import { cn } from "@/lib/utils";

export function MobileHud() {
  const p = useLiveProject();
  const r = useLiveResult();
  const store = useProjectStore();
  const safety = r.capacity.safety;
  const verifiedGreen = r.capacity.verified;
  const safetyTone = verifiedGreen ? "text-ok" : safety === "OVER_CAPACITY" || safety === "PRELIMINARY" ? "text-warn" : "text-crit";
  const crit = r.warnings.filter((w) => w.severity === "BLOCKER" || w.severity === "CRITICAL").length;
  const sim = store.failureSim !== "none";
  return (
    <div className="mf-mobile-hud relative z-20 flex min-h-0 min-w-0 shrink-0 items-stretch overflow-hidden border-t border-border bg-surface md:hidden" data-mf-id="hud">
      <button
        type="button"
        className="flex min-h-[48px] min-w-0 flex-1 flex-col justify-center px-2.5 text-left sm:px-3"
        onClick={() => {
          store.setWhyOpen(true);
          store.openSheet("why", "half");
        }}
      >
        <span className="truncate text-[10px] uppercase tracking-[0.12em] text-muted">
          {sim ? FAILURE_LABELS[store.failureSim] : HUD_SAFETY_LABEL_RU[safety]}
        </span>
        <span
          className={cn("font-mono text-[18px] tabular leading-tight", safetyTone)}
          data-mf-id="hud-safe"
          data-mf-hud="mobile"
          data-mf-requested={p.fleet.requestedCount}
          data-mf-safe={r.capacity.safe ?? ""}
          data-mf-placed={r.inventory.placedAsicCount}
          data-mf-confidence={r.capacity.confidence}
          data-mf-safety={safety}
          data-mf-verified={verifiedGreen ? "1" : "0"}
        >
          {p.fleet.requestedCount} / {r.capacity.safe ?? "—"}
        </span>
      </button>
      <button
        type="button"
        className="flex min-w-0 flex-col justify-center border-l border-border px-2 text-left"
        onClick={() => store.openSheet("props", "half")}
      >
        <span className="text-[10px] uppercase tracking-[0.1em] text-muted">kW</span>
        <span className="font-mono text-[12px] tabular">{formatKw(r.electrical.designTotalW)}</span>
      </button>
      <button
        type="button"
        className="flex min-w-0 flex-col justify-center border-l border-border px-2 text-left"
        onClick={() => store.openSheet("props", "half")}
      >
        <span className="text-[10px] uppercase tracking-[0.1em] text-muted">Воздух</span>
        <span className="truncate font-mono text-[12px] tabular">{formatM3h(r.thermal.designAirflowM3h)}</span>
      </button>
      <button
        type="button"
        className="flex min-w-0 max-w-[96px] flex-col justify-center border-l border-border px-2 text-left"
        onClick={() => store.openSheet("why", "half")}
      >
        <span className="truncate text-[10px] uppercase tracking-[0.1em] text-muted">{crit ? `CRIT ${crit}` : "Узкое"}</span>
        <span className={cn("truncate font-mono text-[11px]", safetyTone)}>
          {HUD_SAFETY_LABEL_RU[safety]}
        </span>
      </button>
    </div>
  );
}