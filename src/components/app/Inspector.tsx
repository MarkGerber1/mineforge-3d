import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLiveProject, useLiveResult, useProjectStore } from "@/project/store";
import { parseLengthToMeters, formatAmps, formatKw, formatM3h, formatPa } from "@/engineering/units";
import { validateRoomHeightInput, validateRoomLengthInput } from "@/engineering/room-resize";
import { validateAvailablePowerInput } from "@/engineering/electrical";
import { rackAsicCapacity, validateRackAsicCountInput } from "@/engineering/racks";
import { getAsic } from "@/equipment/asic-catalog";
import { getFan } from "@/equipment/fan-catalog";
import { generateUpgradeOptions, solveForTarget, sensitivity } from "@/engineering/upgrade";
import { defaultCatalogs } from "@/engineering/catalogs";
import { GrokPanel } from "./GrokPanel";
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { critiqueProject } from "@/ai/critic";
import { FAILURE_LABELS, type FailureKind } from "@/ai/failure";

function Field({
  label,
  value,
  onCommit,
  mfId,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => string | void;
  mfId?: string;
}) {
  const [v, setV] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setV(value);
    setError(null);
  }, [value]);
  const commit = (raw: string) => {
    const reason = onCommit(raw);
    setError(typeof reason === "string" ? reason : null);
  };
  return (
    <label className="block">
      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <Input
        value={v}
        data-mf-id={mfId}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => commit(v)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(v);
        }}
        className="font-mono"
        inputMode="decimal"
      />
      {error && (
        <div className="mt-1 text-[12px] text-crit" data-mf-id="inspector-dim-error">
          {error}
        </div>
      )}
    </label>
  );
}

export function Inspector({ hideGrok }: { hideGrok?: boolean }) {
  const project = useLiveProject();
  const result = useLiveResult();
  const store = useProjectStore();
  const id = store.selectedIds[0];
  const opening = project.openings.find((o) => o.id === id);
  const rack = project.racks.find((r) => r.id === id);
  const fanInst = project.fans.find((f) => f.id === id);
  const asic = getAsic(project.fleet.asicId) ?? project.fleet.imported;
  const catalogs = useMemo(() => defaultCatalogs(), []);
  const why = store.whyOpen;
  const [how, setHow] = useState(false);
  const upgrades = how ? generateUpgradeOptions(store.project, catalogs) : [];

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-surface max-md:w-full max-md:border-l-0" data-mf-id="inspector">
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted">Свойства</div>

        {!id && (
          <div className="mt-3 space-y-3">
            <Field
              label="Ширина"
              value={`${project.room.widthM}`}
              onCommit={(v) => {
                const check = validateRoomLengthInput(v);
                if (!check.ok) return check.reason;
                store.resizeWall("east", check.meters);
              }}
            />
            <Field
              label="Глубина"
              value={`${project.room.depthM}`}
              onCommit={(v) => {
                const check = validateRoomLengthInput(v);
                if (!check.ok) return check.reason;
                store.resizeWall("north", check.meters);
              }}
            />
            <Field
              label="Высота потолка"
              value={`${project.room.heightM}`}
              mfId="inspector-height"
              onCommit={(v) => {
                const check = validateRoomHeightInput(v);
                if (!check.ok) return check.reason;
                const res = store.setRoomHeight(check.meters);
                if (!res.ok) return res.reason;
              }}
            />
            <Field
              label="ASIC count (requested)"
              value={`${project.fleet.requestedCount}`}
              onCommit={(v) => store.setFleet(project.fleet.asicId, Number(v) || 0)}
            />
            <Field
              label="Мощность, kW"
              value={`${project.electrical.availablePowerW / 1000}`}
              mfId="inspector-power"
              onCommit={(v) => {
                const check = validateAvailablePowerInput(v, "kW");
                if (!check.ok) return check.reason;
                const res = store.setPower(check.watts);
                if (!res.ok) return res.reason;
              }}
            />
            <label className="block">
              <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted">Резерв %</div>
              <select
                className="h-8 w-full rounded-[6px] border border-border bg-bg px-2 text-[13px]"
                value={project.electrical.reservePct}
                onChange={(e) => store.setPower(project.electrical.availablePowerW, Number(e.target.value))}
              >
                {[0, 10, 15, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}%
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted">ΔT {project.thermal.deltaTK} °C</div>
              <input
                suppressHydrationWarning
                type="range"
                min={5}
                max={15}
                step={0.5}
                value={project.thermal.deltaTK}
                onChange={(e) => store.setDeltaT(Number(e.target.value))}
                className="w-full"
              />
            </label>
            <label className="flex items-center gap-2 text-[12px]">
              <input
                suppressHydrationWarning
                type="checkbox"
                checked={project.ventilation.dirtyFilter}
                onChange={(e) =>
                  store.commit(
                    { ...store.project, ventilation: { ...store.project.ventilation, dirtyFilter: e.target.checked } },
                    "Toggle dirty filter",
                  )
                }
              />
              Грязный фильтр
            </label>
          </div>
        )}

        {opening && (
          <div className="mt-3 space-y-2">
            <div className="text-[13px] font-medium">{opening.name ?? opening.type}</div>
            <Field
              label="Ширина"
              value={`${opening.widthM}`}
              onCommit={(v) => {
                const m = parseLengthToMeters(v);
                if (m) store.updateOpening(opening.id, { widthM: m });
              }}
            />
            <Field
              label="Высота"
              value={`${opening.heightM}`}
              onCommit={(v) => {
                const m = parseLengthToMeters(v);
                if (m) store.updateOpening(opening.id, { heightM: m });
              }}
            />
            <Field
              label="Offset"
              value={`${opening.offsetFromWallStartM}`}
              onCommit={(v) => {
                const m = parseLengthToMeters(v);
                if (m != null) store.updateOpening(opening.id, { offsetFromWallStartM: m });
              }}
            />
            <Field
              label="Низ, m"
              value={`${opening.bottomElevationM}`}
              onCommit={(v) => {
                const m = parseLengthToMeters(v);
                if (m != null) store.updateOpening(opening.id, { bottomElevationM: m });
              }}
            />
            <div className="font-mono text-[11px] text-muted">
              S = {(opening.widthM * opening.heightM).toFixed(3)} m²
            </div>
          </div>
        )}

        {rack && (
          <div className="mt-3 space-y-2">
            <div className="text-[13px] font-medium">{rack.name}</div>
            <div className="font-mono text-[11px] text-muted">
              {rack.widthM} × {rack.depthM} × {rack.heightM} m
            </div>
            <Field
              label="ASIC on rack"
              value={`${rack.asicCount}`}
              mfId="inspector-rack-asic"
              onCommit={(v) => {
                const cap = asic ? rackAsicCapacity(rack, asic) : 0;
                const check = validateRackAsicCountInput(v, cap);
                if (!check.ok) return check.reason;
                const res = store.setRackAsicCount(rack.id, check.count);
                if (!res.ok) return res.reason;
              }}
            />
            <div className="grid grid-cols-2 gap-1">
              <Button variant="outline" data-mf-id="rotate-rack" onClick={() => store.rotateSelectedRack()}>
                Поворот 90°
              </Button>
              <Button variant="outline" data-mf-id="duplicate-rack" onClick={() => store.duplicateSelectedRack()}>
                Дублировать
              </Button>
            </div>
          </div>
        )}

        {store.selectedIds.length >= 2 && store.selectedIds.every((i) => project.racks.some((r) => r.id === i)) && (
          <div className="mt-3 grid grid-cols-2 gap-1">
            {(["left", "right", "top", "bottom", "centerX", "centerY"] as const).map((e) => (
              <Button
                key={e}
                variant="outline"
                data-mf-id={`align-${e}`}
                onClick={() => store.alignSelection(e)}
              >
                Align {e}
              </Button>
            ))}
            <Button
              variant="outline"
              data-mf-id="distribute-x"
              onClick={() => store.distributeSelection("x")}
            >
              Dist X
            </Button>
            <Button
              variant="outline"
              data-mf-id="distribute-y"
              onClick={() => store.distributeSelection("y")}
            >
              Dist Y
            </Button>
          </div>
        )}

        {fanInst && (
          <div className="mt-3 space-y-2 text-[12px]">
            <div className="font-medium">{getFan(fanInst.specId)?.model ?? fanInst.specId}</div>
            <div className="text-muted">{result.fan.reason}</div>
            <div className="font-mono">
              Qop {result.fan.operatingQ_m3h?.toFixed(0) ?? "—"} m³/h · {formatPa(result.fan.operatingP_pa ?? 0)}
            </div>
            <div className={result.fan.pass ? "text-ok" : "text-crit"}>{result.fan.pass ? "PASS" : "FAIL"}</div>
          </div>
        )}

        {asic && (
          <div className="mt-4 rounded-[10px] border border-border bg-panel p-2 text-[12px]">
            <div className="font-medium">
              {asic.manufacturer} {asic.model}
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted">
              {asic.hashrateThs} TH/s · {asic.typicalPowerW} W typ · {asic.designPowerW} W des
            </div>
            <div className="mt-1 text-[10px] text-subtle">
              {asic.source.trust} · {asic.source.label}
            </div>
          </div>
        )}

        <div className="mt-4 space-y-1">
          <Button variant="outline" className="w-full" onClick={() => store.setWhyOpen(!why)}>
            {result.capacity.safe != null && project.fleet.requestedCount > result.capacity.safe
              ? `Почему только ${result.capacity.safe}?`
              : "Разбор ограничений"}
          </Button>
          <Button variant="outline" className="w-full" onClick={() => setHow((v) => !v)}>
            Как довести до {project.fleet.requestedCount}?
          </Button>
          <Button
            variant="default"
            className="w-full"
            onClick={() => {
              const sol = solveForTarget(store.project, catalogs, project.fleet.requestedCount);
              store.propose({
                id: "target",
                summary: sol.achieved ? `Достичь ${project.fleet.requestedCount}` : "Частичное улучшение",
                detail: sol.steps.map((s) => s.change).join(" → ") || "Нет хода",
                patch: { fans: sol.project.fans, openings: sol.project.openings, ventilation: sol.project.ventilation, electrical: sol.project.electrical },
                fromGrok: false,
              });
            }}
          >
            Достичь {project.fleet.requestedCount}
          </Button>
          <Button variant="outline" className="w-full" onClick={() => store.duplicateScenario("A")}>
            Дублировать сценарий
          </Button>
        </div>

        {why && (
          <div className="mt-3 space-y-2 rounded-[10px] border border-border p-2">
            {result.capacity.slots.map((s) => (
              <div key={s.kind} className="flex items-center justify-between text-[12px]">
                <span className="text-muted">{s.label}</span>
                <span className={`font-mono ${s.value === result.capacity.safe ? "text-crit" : "text-ok"}`}>
                  {s.known ? s.value : "UNKNOWN"}
                </span>
              </div>
            ))}
            {result.capacity.why.slice(0, 8).map((t) => (
              <div key={t.id} className="text-[11px] text-subtle">
                <div className="font-medium text-fg">{t.label}</div>
                <div className="font-mono">{t.formula}</div>
                <div>{t.display}</div>
              </div>
            ))}
          </div>
        )}

        {how && (
          <div className="mt-3 space-y-2">
            {upgrades.slice(0, 6).map((u) => (
              <button
                key={u.id}
                type="button"
                className="w-full rounded-[10px] border border-border bg-panel p-2 text-left text-[12px] hover:border-border-strong"
                onClick={() =>
                  store.propose({
                    id: u.id,
                    summary: u.title,
                    detail: `${u.change}. ${u.impact}`,
                    patch: u.patch,
                    fromGrok: false,
                  })
                }
              >
                <div className="font-medium">{u.title}</div>
                <div className="text-muted">{u.change}</div>
                <div className="font-mono text-cold">SAFE → {u.newSafe ?? "—"}</div>
              </button>
            ))}
            <div className="text-[11px] text-muted">
              Чувствительность:{" "}
              {sensitivity(store.project, catalogs)
                .rows.slice(0, 3)
                .map((r) => `${r.param} ${r.dSafe >= 0 ? "+" : ""}${r.dSafe}`)
                .join(" · ")}
            </div>
          </div>
        )}

        <div className="mt-4 h-36">
          <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted">Fan / system</div>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={fanChart(result)}>
              <XAxis dataKey="q" hide />
              <YAxis hide />
              <Line type="monotone" dataKey="fan" stroke="#9aa8b8" dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="sys" stroke="#c47a52" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-3 font-mono text-[11px] text-muted">
          {formatKw(result.electrical.typicalTotalW)} typ · {formatKw(result.electrical.designTotalW)} des
          <br />
          L1 {formatAmps(result.electrical.l1CurrentA)} · L2 {formatAmps(result.electrical.l2CurrentA)} · L3 {formatAmps(result.electrical.l3CurrentA)}
          <br />
          {formatM3h(result.thermal.designAirflowM3h)} req · {result.fan.operatingQ_m3h?.toFixed(0) ?? "—"} op
        </div>

        <div className="mt-4">
          <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted">Потери давления</div>
          <div className="max-h-40 space-y-1 overflow-auto font-mono text-[11px]">
            {result.pressure.components.map((c) => (
              <div key={c.componentId} className="flex justify-between gap-2 text-muted">
                <span className="truncate">{c.name}</span>
                <span className="text-fg">{c.totalPa.toFixed(1)} Pa</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-border pt-1 text-fg">
              <span>TOTAL</span>
              <span>{result.pressure.totalPa.toFixed(1)} Pa</span>
            </div>
          </div>
        </div>

        {store.scenarios.length > 0 && (
          <div className="mt-4">
            <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted">Сценарии</div>
            <button
              type="button"
              className="mb-2 text-[12px] text-cold"
              onClick={() => store.duplicateScenario(`S${store.scenarios.length + 1}`)}
            >
              Дублировать текущий
            </button>
            <div className="space-y-1 text-[11px]">
              {store.scenarios.map((s) => (
                <div key={s.id} className="flex justify-between gap-2 rounded-[8px] border border-border px-2 py-1">
                  <span>{s.name}</span>
                  <span className="font-mono text-muted">{s.project.fleet.requestedCount} ASIC</span>
                </div>
              ))}
              <div className="flex justify-between gap-2 rounded-[8px] bg-raised px-2 py-1">
                <span>Текущий</span>
                <span className="font-mono">
                  {project.fleet.requestedCount} / {result.capacity.safe ?? "—"} · {formatKw(result.electrical.typicalTotalW)}
                </span>
              </div>
            </div>
          </div>
        )}
        <div className="mt-4">
          <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted">Симуляция отказа</div>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(FAILURE_LABELS) as FailureKind[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`rounded-[6px] border px-2 py-1 text-[11px] ${store.failureSim === k ? "border-warn text-warn" : "border-border text-muted"}`}
                onClick={() => store.setFailureSim(k)}
              >
                {FAILURE_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted">Проверь мой проект</div>
          <div className="space-y-1 text-[11px] text-muted">
            {critiqueProject(project, result).map((c) => (
              <div key={c.id}>
                <span className="text-fg">{c.severity}</span> · {c.title}
              </div>
            ))}
          </div>
        </div>
      </div>
      {hideGrok ? null : <GrokPanel />}
    </aside>
  );
}

function fanChart(result: ReturnType<typeof useLiveResult>) {
  const n = Math.max(result.fan.curve.length, result.fan.systemCurve.length);
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      q: result.fan.curve[i]?.flowM3h ?? result.fan.systemCurve[i]?.flowM3h ?? i,
      fan: result.fan.curve[i]?.pressurePa ?? null,
      sys: result.fan.systemCurve[i]?.pressurePa ?? null,
    });
  }
  return rows;
}
