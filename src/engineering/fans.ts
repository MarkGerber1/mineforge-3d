import type { FanCurvePoint, FanInstance, FanSpec, Project, VentComponent } from "./types.ts";
import { fanIsSpatiallyValid } from "./geometry.ts";
import { systemPressurePa } from "./pressure.ts";

export function fanPressurePa(spec: FanSpec, flowM3h: number): number {
  if (spec.analytic) {
    const { p0, qMax } = spec.analytic;
    if (flowM3h < 0) return p0;
    if (flowM3h >= qMax) return 0;
    const r = flowM3h / qMax;
    return p0 * (1 - r * r);
  }
  const pts = spec.curve;
  if (pts.length === 0) return 0;
  if (flowM3h <= pts[0].flowM3h) return pts[0].pressurePa;
  const last = pts[pts.length - 1];
  if (flowM3h >= last.flowM3h) {
    if (pts.length < 2) return last.pressurePa;
    const a = pts[pts.length - 2];
    const t = (flowM3h - a.flowM3h) / (last.flowM3h - a.flowM3h);
    return a.pressurePa + t * (last.pressurePa - a.pressurePa);
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (flowM3h <= b.flowM3h) {
      const t = (flowM3h - a.flowM3h) / (b.flowM3h - a.flowM3h || 1);
      return a.pressurePa + t * (b.pressurePa - a.pressurePa);
    }
  }
  return last.pressurePa;
}

/** Identical fans in parallel: P(Q_total) = P_one(Q_total / n). */
export function parallelPressurePa(spec: FanSpec, count: number, flowTotalM3h: number): number {
  if (count <= 0) return 0;
  return fanPressurePa(spec, flowTotalM3h / count);
}

/** Series: pressures add at the same flow. */
export function seriesPressurePa(spec: FanSpec, count: number, flowM3h: number): number {
  return count * fanPressurePa(spec, flowM3h);
}

export function combinedFanPressure(spec: FanSpec, inst: FanInstance, flowM3h: number): number {
  if (inst.arrangement === "parallel") return parallelPressurePa(spec, inst.count, flowM3h);
  if (inst.arrangement === "series") return seriesPressurePa(spec, inst.count, flowM3h);
  return fanPressurePa(spec, flowM3h);
}

export function combinedQMax(spec: FanSpec, inst: FanInstance): number {
  const q = spec.analytic?.qMax ?? spec.freeAirM3h;
  if (inst.arrangement === "parallel") return q * inst.count;
  return q;
}

/**
 * Solve fan curve ∩ system curve. Returns operating (Q m³/h, P Pa).
 * Uses analytic quadratic intersection when both sides are quadratic,
 * otherwise bisection.
 */
export function findOperatingPoint(
  fanP: (q: number) => number,
  sysP: (q: number) => number,
  qMin: number,
  qMax: number,
): { q: number; p: number } | null {
  const f = (q: number) => fanP(q) - sysP(q);
  const f0 = f(qMin);
  const f1 = f(Math.max(qMin, qMax - 1e-9));
  if (!Number.isFinite(f0) || !Number.isFinite(f1)) return null;
  // Operating point exists if fan is above system at low flow.
  if (f0 < 0) {
    // fan cannot produce static at Q=0 vs system
    if (fanP(qMin) <= 0) return { q: 0, p: sysP(0) };
  }
  let lo = qMin;
  let hi = qMax;
  let flo = f(lo);
  if (flo === 0) return { q: lo, p: sysP(lo) };
  // If no sign change, pick the feasible end.
  const fhi = f(hi);
  if (flo > 0 && fhi > 0) {
    // fan above system throughout — operating at free air-ish high Q, but
    // still return the high-Q intersection-ish: clamp to qMax if fan still +ve
    return { q: hi, p: sysP(hi) };
  }
  if (flo < 0 && fhi < 0) {
    return { q: lo, p: sysP(lo) };
  }
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    const fm = f(mid);
    if (Math.abs(fm) < 1e-9 || hi - lo < 1e-8) {
      return { q: mid, p: sysP(mid) };
    }
    if (flo * fm <= 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  const q = 0.5 * (lo + hi);
  return { q, p: sysP(q) };
}

/** Closed-form intersection for P = p0 (1-(Q/qMax)^2) and P = k Q^2 + pFixed. */
export function quadraticOperatingPoint(
  p0: number,
  qMax: number,
  k: number,
  pFixed: number,
): { q: number; p: number } | null {
  // p0 - p0 (Q/qMax)^2 = k Q^2 + pFixed
  // p0 - pFixed = Q^2 (k + p0/qMax^2)
  const lhs = p0 - pFixed;
  const denom = k + p0 / (qMax * qMax);
  if (denom <= 0 || lhs < 0) return null;
  const q2 = lhs / denom;
  if (q2 < 0) return null;
  const q = Math.sqrt(q2);
  if (q > qMax) return { q: qMax, p: pFixed + k * qMax * qMax };
  const p = pFixed + k * q * q;
  return { q, p };
}

export function sampleCurve(fn: (q: number) => number, qMax: number, n = 25): FanCurvePoint[] {
  const pts: FanCurvePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const flowM3h = (qMax * i) / n;
    pts.push({ flowM3h, pressurePa: Math.max(0, fn(flowM3h)) });
  }
  return pts;
}

export function evaluateFanDuty(
  spec: FanSpec,
  inst: FanInstance,
  components: VentComponent[],
  requiredM3h: number,
  extraFixedPa: number,
): {
  operatingQ_m3h: number | null;
  operatingP_pa: number | null;
  pass: boolean;
  marginM3h: number;
  reason: string;
  curve: FanCurvePoint[];
  systemCurve: FanCurvePoint[];
} {
  const qMax = combinedQMax(spec, inst);
  const fanP = (q: number) => combinedFanPressure(spec, inst, q);
  const sysP = (q: number) => systemPressurePa(components, q, extraFixedPa);

  let op: { q: number; p: number } | null = null;
  if (spec.analytic && inst.arrangement !== "series") {
    const n = inst.arrangement === "parallel" ? inst.count : 1;
    // Combined analytic: P = p0 (1 - (Q/(n*qMax))^2)
    const p0 = spec.analytic.p0;
    const qMaxC = spec.analytic.qMax * n;
    // Fit k from two-point of Q² part of system (exclude extraFixed which is already extraFixedPa)
    // systemPressurePa already includes component extras; pass extraFixed separately so
    // we estimate k using a reference flow.
    const qRef = Math.max(requiredM3h, 1000);
    const pRef = systemPressurePa(components, qRef, 0);
    const k = qRef > 0 ? pRef / (qRef * qRef) : 0;
    op = quadraticOperatingPoint(p0, qMaxC, k, extraFixedPa + 0);
    // Verify by residual — if network has non-Q² extras inside components, fall back.
    if (op) {
      const residual = Math.abs(fanP(op.q) - sysP(op.q));
      if (residual > 0.5) {
        op = findOperatingPoint(fanP, sysP, 0, qMaxC);
      }
    }
  } else {
    op = findOperatingPoint(fanP, sysP, 0, qMax);
  }

  const operatingQ_m3h = op?.q ?? null;
  const operatingP_pa = op?.p ?? null;
  const pass = operatingQ_m3h != null && operatingQ_m3h + 1e-6 >= requiredM3h;
  const marginM3h = operatingQ_m3h != null ? operatingQ_m3h - requiredM3h : -requiredM3h;
  let reason = "";
  if (operatingQ_m3h == null) reason = "No intersection between fan curve and system curve.";
  else if (!pass)
    reason = `Operating airflow ${operatingQ_m3h.toFixed(1)} m³/h is below required ${requiredM3h.toFixed(1)} m³/h. Free-air rating is not a duty point.`;
  else reason = "Operating point meets required airflow.";

  return {
    operatingQ_m3h,
    operatingP_pa,
    pass,
    marginM3h,
    reason,
    curve: sampleCurve(fanP, qMax),
    systemCurve: sampleCurve(sysP, qMax),
  };
}

export function evaluateProjectFans(
  project: Project,
  specs: Record<string, FanSpec>,
  components: VentComponent[],
  requiredM3h: number,
) {
  if (project.fans.length === 0) {
    return {
      instances: project.fans,
      combinedLabel: "No fan selected",
      operatingQ_m3h: null as number | null,
      operatingP_pa: null as number | null,
      requiredQ_m3h: requiredM3h,
      requiredP_pa: systemPressurePa(components, requiredM3h, 0),
      pass: null as boolean | null,
      dirtyPass: null as boolean | null,
      cleanQ_m3h: null as number | null,
      dirtyQ_m3h: null as number | null,
      marginM3h: null as number | null,
      reason: "No fan in the project. Ventilation capacity is UNKNOWN.",
      curve: [] as FanCurvePoint[],
      systemCurve: [] as FanCurvePoint[],
    };
  }

  // PHASE 1: evaluate the primary fan group (first instance). Parallel count is on the instance.
  const inst = project.fans[0];
  if (!fanIsSpatiallyValid(project, inst)) {
    return {
      instances: project.fans,
      combinedLabel: "Fan outside room",
      operatingQ_m3h: null,
      operatingP_pa: null,
      requiredQ_m3h: requiredM3h,
      requiredP_pa: systemPressurePa(components, requiredM3h, 0),
      pass: null,
      dirtyPass: null,
      cleanQ_m3h: null,
      dirtyQ_m3h: null,
      marginM3h: null,
      reason: "Fan is outside the room. Operating point is not valid.",
      curve: [],
      systemCurve: [],
    };
  }
  const spec = specs[inst.specId];
  if (!spec) {
    return {
      instances: project.fans,
      combinedLabel: "Unknown fan",
      operatingQ_m3h: null,
      operatingP_pa: null,
      requiredQ_m3h: requiredM3h,
      requiredP_pa: systemPressurePa(components, requiredM3h, 0),
      pass: null,
      dirtyPass: null,
      cleanQ_m3h: null,
      dirtyQ_m3h: null,
      marginM3h: null,
      reason: "Fan specification missing. Cannot verify duty.",
      curve: [],
      systemCurve: [],
    };
  }

  const extraDirty = project.ventilation.dirtyFilterExtraPa;
  const clean = evaluateFanDuty(spec, inst, components, requiredM3h, 0);
  const dirty = evaluateFanDuty(spec, inst, components, requiredM3h, extraDirty);
  const useDirty = project.ventilation.dirtyFilter || inst.dirtyFilter;
  const active = useDirty ? dirty : clean;
  const label =
    inst.arrangement === "parallel" && inst.count > 1
      ? `${spec.model} × ${inst.count} parallel`
      : spec.model;

  return {
    instances: project.fans,
    combinedLabel: label,
    operatingQ_m3h: active.operatingQ_m3h,
    operatingP_pa: active.operatingP_pa,
    requiredQ_m3h: requiredM3h,
    requiredP_pa: systemPressurePa(components, requiredM3h, useDirty ? extraDirty : 0),
    pass: active.pass,
    dirtyPass: dirty.pass,
    cleanQ_m3h: clean.operatingQ_m3h,
    dirtyQ_m3h: dirty.operatingQ_m3h,
    marginM3h: active.marginM3h,
    reason: active.reason,
    curve: active.curve,
    systemCurve: active.systemCurve,
  };
}
