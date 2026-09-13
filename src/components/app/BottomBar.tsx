import { useLiveProject, useLiveResult, useProjectStore } from "@/project/store";
import { formatKw, formatM3h, formatPa, formatThs } from "@/engineering/units";
import { HUD_SAFETY_LABEL_RU } from "@/engineering/capacity";
import { cn } from "@/lib/utils";

export function BottomBar() {
  const p = useLiveProject();
  const r = useLiveResult();
  const store = useProjectStore();
  const safety = r.capacity.safety;
  const verifiedGreen = r.capacity.verified;
  const safetyTone = verifiedGreen ? "text-ok" : safety === "OVER_CAPACITY" || safety === "PRELIMINARY" ? "text-warn" : "text-crit";
  const openWhy = () => {
    store.setWhyOpen(true);
    store.setInspectorOpen(true);
  };
  return (
    <footer className="hidden min-h-14 flex-nowrap items-stretch overflow-x-auto border-t border-border bg-surface md:flex" data-mf-id="bottombar">
      <button type="button" className="hud-chip min-w-[168px] shrink-0 text-left" onClick={openWhy}>
        <span className="k">Requested / Safe</span>
        <span
          className={cn("v text-[18px]", safetyTone)}
          data-mf-id="hud-safe-bar"
          data-mf-safety={safety}
          data-mf-verified={verifiedGreen ? "1" : "0"}
        >
          {p.fleet.requestedCount} / {r.capacity.safe ?? "—"}
        </span>
      </button>
      <button type="button" className="hud-chip shrink-0 text-left" onClick={openWhy}>
        <span className="k">Узкое место</span>
        <span className={cn("v", safetyTone)}>{HUD_SAFETY_LABEL_RU[safety]} · {r.capacity.bottlenecks.join(" · ") || "—"}</span>
      </button>
      <div className="hud-chip hidden shrink-0 sm:flex">
        <span className="k">ASIC</span>
        <span className="v">{r.electrical.asic?.model ?? "—"}</span>
      </div>
      <div className="hud-chip hidden shrink-0 sm:flex">
        <span className="k">Hashrate</span>
        <span className="v">{formatThs(r.electrical.hashrateThs)}</span>
      </div>
      <div className="hud-chip shrink-0">
        <span className="k">Typical / Design</span>
        <span className="v">
          {formatKw(r.electrical.typicalTotalW)} / {formatKw(r.electrical.designTotalW)}
        </span>
      </div>
      <div className="hud-chip shrink-0">
        <span className="k">Воздух req / op</span>
        <span className="v">
          {formatM3h(r.thermal.designAirflowM3h)} / {r.fan.operatingQ_m3h != null ? formatM3h(r.fan.operatingQ_m3h) : "—"}
        </span>
      </div>
      <div className="hud-chip hidden shrink-0 md:flex">
        <span className="k">Static</span>
        <span className="v">{r.fan.operatingP_pa != null ? formatPa(r.fan.operatingP_pa) : "—"}</span>
      </div>
      <div className="hud-chip hidden shrink-0 md:flex">
        <span className="k">Fan</span>
        <span className={cn("v", r.fan.pass ? "text-ok" : r.fan.pass === false ? "text-crit" : "text-muted")}>
          {r.fan.combinedLabel} {r.fan.pass == null ? "" : r.fan.pass ? "PASS" : "FAIL"}
        </span>
      </div>
      <div className="hud-chip shrink-0">
        <span className="k">Статус</span>
        <span
          className={cn(
            "v",
            r.capacity.status === "PASS" && "text-ok",
            r.capacity.status === "FAIL" && "text-crit",
            r.capacity.status === "WARNING" && "text-warn",
            r.capacity.status === "INCOMPLETE" && "text-muted",
          )}
        >
          {r.capacity.status} · {r.capacity.confidence}
        </span>
      </div>
      {r.warnings
        .filter((w) => w.severity === "BLOCKER" || w.severity === "CRITICAL")
        .slice(0, 2)
        .map((w) => (
          <div key={w.id} className="hud-chip shrink-0">
            <span className="k">{w.severity}</span>
            <span className="v text-crit">{w.title}</span>
          </div>
        ))}
    </footer>
  );
}
