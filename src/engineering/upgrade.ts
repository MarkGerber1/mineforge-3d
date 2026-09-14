import { FAN_STRONG, FAN_WEAK, getFan } from "../equipment/fan-catalog.ts";
import { validateCanonicalProjectDomains } from "./canonical.ts";
import { MAX_AVAILABLE_POWER_W, MAX_DELTA_T_K } from "./constants.ts";
import { defaultCatalogs } from "./catalogs.ts";
import { validateAvailablePowerW } from "./electrical.ts";
import { openingMaxWidthOnWallM, validateOpening, fanIsSpatiallyValid } from "./geometry.ts";
import { calculateAll, type Catalogs } from "./pipeline.ts";
import { validateRacksConfiguration } from "./placement.ts";
import { validateRoomHeightM, validateRoomLengthM } from "./room-resize.ts";
import { isCanonicalLocked, OBJECT_LOCKED_RU } from "./object-lock.ts";
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
  racks?: Project["racks"];
  constraints?: Partial<Project["constraints"]>;
};

export function applyPatch(project: Project, patch: PartialProjectPatch): Project {
  let next: Project = { ...project, updatedAt: Date.now() };
  if (patch.room) next = { ...next, room: { ...next.room, ...patch.room } };
  if (patch.openings) next = { ...next, openings: patch.openings };
  if (patch.racks) next = { ...next, racks: patch.racks };
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
  if (patch.constraints) next = { ...next, constraints: { ...next.constraints, ...patch.constraints } };
  if (patch.reality) {
    const prev = next.reality ?? {
      photos: [],
      videos: [],
      findings: [],
      asBuilt: [],
      compareMode: "as-designed" as const,
      interview: [],
    };
    const asBuilt = patch.reality.asBuilt ?? prev.asBuilt;
    next = {
      ...next,
      reality: {
        photos: patch.reality.photos ?? prev.photos,
        videos: patch.reality.videos ?? prev.videos ?? [],
        findings: patch.reality.findings ?? prev.findings,
        asBuilt,
        compareMode: patch.reality.compareMode ?? prev.compareMode,
        interview: patch.reality.interview ?? prev.interview,
      },
    };
  }
  return next;
}

export interface PatchApplyResult {
  ok: boolean;
  project: Project;
  errors: string[];
}

function patchTouchesGeometry(patch: PartialProjectPatch): boolean {
  return Boolean(
    patch.room ||
      patch.openings ||
      patch.racks ||
      patch.fans ||
      patch.reality?.asBuilt ||
      patch.ventilation?.componentResize,
  );
}

export function applyPatchValidated(
  project: Project,
  patch: PartialProjectPatch,
  catalogs: Catalogs = defaultCatalogs(),
): PatchApplyResult {
  const next = applyPatch(project, patch);
  const errors: string[] = [];
  if (patch.openings) {
    for (const o of project.openings) {
      if (isCanonicalLocked(project, o.id) && !next.openings.some((x) => x.id === o.id)) {
        errors.push(OBJECT_LOCKED_RU);
      }
    }
  }
  if (patch.racks) {
    for (const r of project.racks) {
      if (isCanonicalLocked(project, r.id) && !next.racks.some((x) => x.id === r.id)) {
        errors.push(OBJECT_LOCKED_RU);
      }
    }
  }
  if (patch.room) {
    if (patch.room.widthM != null) {
      const w = validateRoomLengthM(patch.room.widthM);
      if (!w.ok) errors.push(w.reason);
    }
    if (patch.room.depthM != null) {
      const d = validateRoomLengthM(patch.room.depthM);
      if (!d.ok) errors.push(d.reason);
    }
    if (patch.room.heightM != null) {
      const h = validateRoomHeightM(patch.room.heightM);
      if (!h.ok) errors.push(h.reason);
    }
  }
  if (patchTouchesGeometry(patch)) {
    for (const o of next.openings) {
      const v = validateOpening(next, o);
      if (!v.ok) errors.push(...v.errors.map((e) => `${o.name ?? o.id}: ${e}`));
    }
    if (patch.racks || patch.room) {
      const ids = next.racks.map((r) => r.id);
      const v = validateRacksConfiguration(next, next.racks, ids);
      if (!v.ok) errors.push(...v.errors);
    }
    if (patch.fans) {
      for (const f of next.fans) {
        if (!fanIsSpatiallyValid(next, f)) {
          errors.push(`Вентилятор ${f.name} вне помещения.`);
        }
      }
    }
  }
  const domains = validateCanonicalProjectDomains(next, catalogs);
  if (!domains.ok) errors.push(...domains.errors);
  if (errors.length) {
    return { ok: false, project, errors };
  }
  return { ok: true, project: next, errors: [] };
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
    const span = openingMaxWidthOnWallM(project, exhaust);
    const desired = Math.max(exhaust.widthM * 1.25, exhaust.widthM + 0.3);
    const newWidth = Math.min(span, desired);
    if (newWidth > exhaust.widthM + 1e-9) {
      const patchedOpenings = project.openings.map((o) => (o.id === exhaust.id ? { ...o, widthM: newWidth } : o));
      const candidate = applyPatch(project, { openings: patchedOpenings });
      const v = validateOpening(candidate, candidate.openings.find((o) => o.id === exhaust.id)!);
      if (v.ok) {
        options.push(
          optionFrom(
            "open-wider",
            "Increase exhaust opening",
            `${exhaust.widthM.toFixed(3)} × ${exhaust.heightM.toFixed(3)} m`,
            `Widen exhaust opening`,
            project,
            candidate,
            catalogs,
            { openings: patchedOpenings },
          ),
        );
      }
    }
  }

  const shaft = project.ventilation.components.find((c) => c.kind === "duct" && c.lengthM >= 10);
  if (shaft) {
    const w = Math.max((shaft.widthM ?? 0.9) + 0.3, 1.4);
    const h = Math.max(shaft.heightM ?? 0.9, 0.9);
    const next = applyPatch(project, { ventilation: { componentResize: { id: shaft.id, widthM: w, heightM: h } } });
    const openingId = next.ventilation.components.find((c) => c.id === shaft.id)?.openingId;
    const opening = openingId ? next.openings.find((o) => o.id === openingId) : undefined;
    const openingOk = !opening || validateOpening(next, opening).ok;
    if (openingOk) {
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
    const bumped = Math.min(MAX_AVAILABLE_POWER_W, project.electrical.availablePowerW * 1.25);
    const powerOk = validateAvailablePowerW(bumped);
    if (powerOk.ok && bumped > project.electrical.availablePowerW + 1e-9) {
      const electrical = { ...project.electrical, availablePowerW: powerOk.watts };
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
  }

  if (project.thermal.deltaTK < MAX_DELTA_T_K) {
    const thermal = { ...project.thermal, deltaTK: MAX_DELTA_T_K };
    options.push(
      optionFrom("delta-t", "Allow a higher ΔT (15 °C)", `${project.thermal.deltaTK} °C`, `ΔT = ${MAX_DELTA_T_K} °C`, project, applyPatch(project, { thermal }), catalogs, { thermal }),
    );
  }

  // Rank by how close they get to target, then by remaining gap.
  // Never return a patch that the canonical domain boundary would reject.
  const valid = options.filter((o) => applyPatchValidated(project, o.patch, catalogs).ok);
  valid.sort((a, b) => (b.newSafe ?? 0) - (a.newSafe ?? 0));
  void want;
  void result;
  void FAN_WEAK;
  return valid;
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
    const applied = applyPatchValidated(current, best.patch, catalogs);
    if (!applied.ok) break;
    steps.push(best);
    current = applied.project;
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
    const span = openingMaxWidthOnWallM(project, exhaust);
    const w = Math.min(span, exhaust.widthM * 1.2);
    if (w > exhaust.widthM + 1e-9) {
      tryRow("Opening area", "+20%", applyPatch(project, { openings: project.openings.map((o) => (o.id === exhaust.id ? { ...o, widthM: w } : o)) }));
    }
  }
  const shaft = project.ventilation.components.find((c) => c.kind === "duct" && (c.lengthM ?? 0) >= 10);
  if (shaft) {
    tryRow("Shaft section", "+20%", applyPatch(project, { ventilation: { componentResize: { id: shaft.id, widthM: (shaft.widthM ?? 1) * 1.2, heightM: shaft.heightM } } }));
  }
  if (project.electrical.known) {
    const bumped = Math.min(MAX_AVAILABLE_POWER_W, project.electrical.availablePowerW * 1.2);
    if (validateAvailablePowerW(bumped).ok && bumped > project.electrical.availablePowerW + 1e-9) {
      tryRow("Available power", "+20%", applyPatch(project, { electrical: { availablePowerW: bumped } }));
    }
  }
  tryRow("ΔT", "+2 K", applyPatch(project, { thermal: { deltaTK: Math.min(MAX_DELTA_T_K, project.thermal.deltaTK + 2) } }));
  const f = project.fans[0];
  if (f && f.specId !== FAN_STRONG.id) {
    tryRow("Fan selection", `→ ${FAN_STRONG.model}`, applyPatch(project, { fans: project.fans.map((x, i) => (i === 0 ? { ...x, specId: FAN_STRONG.id } : x)) }));
  }
  rows.sort((a, b) => b.dSafe - a.dSafe);
  return { baseSafe, rows };
}
