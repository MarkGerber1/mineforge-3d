import { FAN_STRONG, FAN_WEAK, getFan } from "../equipment/fan-catalog.ts";
import { calculateAll, type Catalogs } from "./pipeline.ts";
import type { Project } from "./types.ts";

export interface UpgradeOption {
  id: string;
  title: string;
  current: string;
  change: string;
  newSafe: number | null;
  newAirflowM3h: number | null;
  newPressurePa: number | null;
  newElectricW: number;
  impact: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  patch: PartialProjectPatch;
}

export type PartialProjectPatch = {
  room?: Partial<Project["room"]>;
  openings?: Project["openings"];
  ventilation?: Partial<Project["ventilation"]> & { componentResize?: { id: string; widthM?: number; heightM?: number } };
  electrical?: Partial<Project["electrical"]>;
  fans?: Project["fans"];
  thermal?: Partial<Project["thermal"]>;
  fleet?: Partial<Project["fleet"]>;
  reality?: Partial<Project["reality"]> & { asBuilt?: NonNullable<Project["reality"]>["asBuilt"] };
};

export function applyPatch(project: Project, patch: PartialProjectPatch): Project {
  let next: Project = { ...project, updatedAt: Date.now() };
  if (patch.room) next = { ...next, room: { ...next.room, ...patch.room } };
  if (patch.openings) next = { ...next, openings: patch.openings };
  if (patch.ventilation) {
    const { componentResize, ...rest } = patch.ventilation;
    next = { ...next, ventilation: { ...next.ventilation, ...rest } };
    if (componentResize) {
      next = {
        ...next,
        ventilation: {
          ...next.ventilation,
          components: next.ventilation.components.map((c) =>
            c.id === componentResize.id ? { ...c, ...componentResize } : c,
          ),
        },
      };
      const opening = next.openings.find((o) => o.id === componentResize.id || next.ventilation.components.find((c) => c.id === componentResize.id)?.openingId === o.id);
      if (opening && (componentResize.widthM || componentResize.heightM)) {
        next = {
          ...next,
          openings: next.openings.map((o) =>
            o.id === opening.id
              ? {
                  ...o,
                  widthM: componentResize.widthM ?? o.widthM,
                  heightM: componentResize.heightM ?? o.heightM,
                }
              : o,
          ),
        };
      }
    }
  }
  if (patch.electrical) next = { ...next, electrical: { ...next.electrical, ...patch.electrical } };
  if (patch.fans) next = { ...next, fans: patch.fans };
  if (patch.thermal) next = { ...next, thermal: { ...next.thermal, ...patch.thermal } };
  if (patch.fleet) next = { ...next, fleet: { ...next.fleet, ...patch.fleet } };
  if (patch.reality) {
    const asBuilt = patch.reality.asBuilt ?? next.reality?.asBuilt ?? [];
    next = {
      ...next,
      reality: {
        photos: next.reality?.photos ?? [],
        findings: next.reality?.findings ?? [],
        asBuilt,
        compareMode: patch.reality.compareMode ?? next.reality?.compareMode ?? "as-designed",
        interview: next.reality?.interview ?? [],
      },
    };
  }
  return next;
}

function optionFrom(
  id: string,
  title: string,
  current: string,
  change: string,
  before: Project,
  after: Project,
  catalogs: Catalogs,
  patch: PartialProjectPatch,
): UpgradeOption {
  const a = calculateAll(after, catalogs);
  const b = calculateAll(before, catalogs);
  const ds = (a.capacity.safe ?? 0) - (b.capacity.safe ?? 0);
  return {
    id,
    title,
    current,
    change,
    newSafe: a.capacity.safe,
    newAirflowM3h: a.fan.operatingQ_m3h,
    newPressurePa: a.fan.operatingP_pa,
    newElectricW: a.electrical.typicalTotalW,
    impact: ds > 0 ? `SAFE ${b.capacity.safe ?? "—"} → ${a.capacity.safe ?? "—"}` : ds === 0 ? "SAFE unchanged (not the bottleneck)" : `SAFE ${b.capacity.safe ?? "—"} → ${a.capacity.safe ?? "—"}`,
    confidence: a.capacity.confidence === "VERIFIED" ? "HIGH" : a.capacity.confidence === "PRELIMINARY" ? "MEDIUM" : "LOW",
    patch,
  };
}

export function generateUpgradeOptions(project: Project, catalogs: Catalogs, target?: number): UpgradeOption[] {
  const result = calculateAll(project, catalogs);
  const want = target ?? project.fleet.requestedCount;
  const options: UpgradeOption[] = [];

  const exhaust = project.openings.find((o) => o.type === "EXHAUST" || o.type === "SHAFT_CONNECTION");
  if (exhaust) {
    const wider = project.openings.map((o) => (o.id === exhaust.id ? { ...o, widthM: Math.max(o.widthM, 1.4) } : o));
    const patchedOpenings = wider.map((o) => (o.id === exhaust.id ? { ...o, widthM: Math.min(project.room.widthM, Math.max(o.widthM * 1.25, o.widthM + 0.3)) } : o));
    options.push(
      optionFrom(
        "open-wider",
        "Increase exhaust opening",
        `${exhaust.widthM.toFixed(3)} × ${exhaust.heightM.toFixed(3)} m`,
        `Widen exhaust opening`,
        project,
        applyPatch(project, { openings: patchedOpenings }),
        catalogs,
        { openings: patchedOpenings },
      ),
    );
  }

  const shaft = project.ventilation.components.find((c) => c.kind === "duct" && c.lengthM >= 10);
  if (shaft) {
    const w = Math.max((shaft.widthM ?? 0.9) + 0.3, 1.4);
    const h = Math.max(shaft.heightM ?? 0.9, 0.9);
    const next = applyPatch(project, { ventilation: { componentResize: { id: shaft.id, widthM: w, heightM: h } } });
    options.push(
      optionFrom(
        "shaft-section",
        "Increase shaft section",
        `${shaft.widthM ?? "?"} × ${shaft.heightM ?? "?"} m`,
        `Shaft → ${w.toFixed(2)} × ${h.toFixed(2)} m`,
        project,
        next,
        catalogs,
        { ventilation: { componentResize: { id: shaft.id, widthM: w, heightM: h } } },
      ),
    );
  }

  const primary = project.fans[0];
  if (primary && primary.specId !== FAN_STRONG.id) {
    const fans = project.fans.map((f, i) => (i === 0 ? { ...f, specId: FAN_STRONG.id } : f));
    options.push(
      optionFrom("swap-fan", "Replace fan with higher static curve", primary.specId, `Use ${FAN_STRONG.model}`, project, applyPatch(project, { fans }), catalogs, { fans }),
    );
  }
  if (primary && primary.count === 1) {
    const fans = project.fans.map((f, i) => (i === 0 ? { ...f, arrangement: "parallel" as const, count: 2 } : f));
    options.push(
      optionFrom("parallel-fan", "Add a second identical fan in parallel", `${getFan(primary.specId)?.model ?? primary.specId} × 1`, "Parallel × 2", project, applyPatch(project, { fans }), catalogs, { fans }),
    );
  }

  const silencer = project.ventilation.components.find((c) => c.kind === "silencer");
  if (silencer && silencer.kLocal > 0) {
    const components = project.ventilation.components.map((c) => (c.id === silencer.id ? { ...c, kLocal: Math.max(0.3, c.kLocal * 0.4) } : c));
    const next = { ...project, ventilation: { ...project.ventilation, components } };
    options.push(
      optionFrom("reduce-k", "Reduce silencer / local resistance", `K = ${silencer.kLocal}`, "Lower local loss coefficient", project, next, catalogs, { ventilation: { components } }),
    );
  }

  if (project.electrical.known) {
    const electrical = { ...project.electrical, availablePowerW: project.electrical.availablePowerW * 1.25 };
    options.push(
      optionFrom(
        "more-power",
        "Increase available electrical power +25%",
        `${(project.electrical.availablePowerW / 1000).toFixed(1)} kW`,
        `${(electrical.availablePowerW / 1000).toFixed(1)} kW`,
        project,
        applyPatch(project, { electrical }),
        catalogs,
        { electrical },
      ),
    );
  }

  if (project.thermal.deltaTK < 15) {
    const thermal = { ...project.thermal, deltaTK: 15 };
    options.push(
      optionFrom("delta-t", "Allow a higher ΔT (15 °C)", `${project.thermal.deltaTK} °C`, "ΔT = 15 °C", project, applyPatch(project, { thermal }), catalogs, { thermal }),
    );
  }

  // Rank by how close they get to target, then by remaining gap.
  options.sort((a, b) => (b.newSafe ?? 0) - (a.newSafe ?? 0));
  void want;
  void result;
  void FAN_WEAK;
  return options;
}

export function solveForTarget(project: Project, catalogs: Catalogs, target: number) {
  const baseline = calculateAll(project, catalogs);
  const steps: UpgradeOption[] = [];
  let current = project;
  let guard = 0;
  while (guard < 6) {
    const now = calculateAll(current, catalogs);
    if ((now.capacity.safe ?? 0) >= target) {
      return { achieved: true, project: current, result: now, steps, baseline };
    }
    const opts = generateUpgradeOptions(current, catalogs, target).filter((o) => (o.newSafe ?? 0) > (now.capacity.safe ?? 0));
    if (!opts.length) break;
    const best = opts[0];
    steps.push(best);
    current = applyPatch(current, best.patch);
    guard += 1;
  }
  const result = calculateAll(current, catalogs);
  return { achieved: (result.capacity.safe ?? 0) >= target, project: current, result, steps, baseline };
}

export function sensitivity(project: Project, catalogs: Catalogs) {
  const base = calculateAll(project, catalogs);
  const baseSafe = base.capacity.safe ?? 0;
  const rows: Array<{ param: string; delta: string; dSafe: number }> = [];

  const tryRow = (param: string, delta: string, next: Project) => {
    const r = calculateAll(next, catalogs);
    rows.push({ param, delta, dSafe: (r.capacity.safe ?? 0) - baseSafe });
  };

  const exhaust = project.openings.find((o) => o.type === "EXHAUST" || o.type === "SHAFT_CONNECTION");
  if (exhaust) {
    tryRow("Opening area", "+20%", applyPatch(project, { openings: project.openings.map((o) => (o.id === exhaust.id ? { ...o, widthM: o.widthM * 1.2 } : o)) }));
  }
  const shaft = project.ventilation.components.find((c) => c.kind === "duct" && (c.lengthM ?? 0) >= 10);
  if (shaft) {
    tryRow("Shaft section", "+20%", applyPatch(project, { ventilation: { componentResize: { id: shaft.id, widthM: (shaft.widthM ?? 1) * 1.2, heightM: shaft.heightM } } }));
  }
  if (project.electrical.known) {
    tryRow("Available power", "+20%", applyPatch(project, { electrical: { availablePowerW: project.electrical.availablePowerW * 1.2 } }));
  }
  tryRow("ΔT", "+2 K", applyPatch(project, { thermal: { deltaTK: Math.min(15, project.thermal.deltaTK + 2) } }));
  const f = project.fans[0];
  if (f && f.specId !== FAN_STRONG.id) {
    tryRow("Fan selection", `→ ${FAN_STRONG.model}`, applyPatch(project, { fans: project.fans.map((x, i) => (i === 0 ? { ...x, specId: FAN_STRONG.id } : x)) }));
  }
  rows.sort((a, b) => b.dSafe - a.dSafe);
  return { baseSafe, rows };
}
