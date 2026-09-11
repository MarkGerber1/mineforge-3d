import type { ComponentLoss, Project, VentComponent } from "./types.ts";
import {
  crossSectionAreaM2,
  dynamicPressurePa,
  frictionLossPa,
  hydraulicDiameterM,
  localLossPa,
  velocityMs,
} from "./airflow.ts";

export function componentLossAtFlow(c: VentComponent, flowM3h: number): ComponentLoss {
  const areaM2 = crossSectionAreaM2(c);
  const dhM = hydraulicDiameterM(c);
  const v = velocityMs(flowM3h, areaM2);
  const pv = Number.isFinite(v) ? dynamicPressurePa(v) : Infinity;
  const frictionPa = frictionLossPa(c.frictionFactor, c.lengthM, dhM, pv);
  const localPa = localLossPa(c.kLocal, pv);
  const extraPa = c.extraPressurePa;
  return {
    componentId: c.id,
    name: c.name,
    kind: c.kind,
    flowM3h,
    areaM2,
    velocityMs: v,
    dynamicPa: pv,
    frictionPa,
    localPa,
    extraPa,
    totalPa: frictionPa + localPa + extraPa,
    dhM,
  };
}

export function networkLosses(components: VentComponent[], flowM3h: number): ComponentLoss[] {
  return components.map((c) => componentLossAtFlow(c, flowM3h));
}

export function totalNetworkPa(components: VentComponent[], flowM3h: number): number {
  return networkLosses(components, flowM3h).reduce((s, x) => s + x.totalPa, 0);
}

/**
 * System curve: losses that scale with Q² plus fixed extras (dirty filter).
 * P(Q) = k * Q² + P_fixed, with k fitted at a reference flow from the network.
 */
export function systemPressurePa(components: VentComponent[], flowM3h: number, extraFixedPa = 0): number {
  return totalNetworkPa(components, flowM3h) + extraFixedPa;
}

export function calculatePressure(project: Project, designFlowM3h: number) {
  const extra = project.ventilation.dirtyFilter ? project.ventilation.dirtyFilterExtraPa : 0;
  const comps = project.ventilation.components.map((c) =>
    c.kind === "filter" && project.ventilation.dirtyFilter
      ? { ...c, extraPressurePa: c.extraPressurePa + extra }
      : extra && c.kind === "filter"
        ? c
        : c,
  );
  const flow = designFlowM3h > 0 ? designFlowM3h : 1;
  const components = networkLosses(comps, flow);
  const totalPa = components.reduce((s, x) => s + x.totalPa, 0);
  const q2 = flow * flow;
  const fixed = comps.reduce((s, c) => s + c.extraPressurePa, 0);
  const systemK = q2 > 0 ? (totalPa - fixed) / q2 : 0;
  return {
    components,
    totalPa,
    systemK,
    traces: components.map((c) => ({
      id: c.componentId,
      label: c.name,
      formula: "ΔP = f·L/Dh·Pv + K·Pv + P_extra",
      inputs: {
        flow_m3h: c.flowM3h,
        v_ms: c.velocityMs,
        Pv_Pa: c.dynamicPa,
        f: 0,
        L: 0,
        Dh: c.dhM,
      },
      raw: c.totalPa,
      unit: "Pa",
      display: `${c.totalPa.toFixed(3)} Pa`,
    })),
  };
}

export function resolvedVentComponents(project: Project): VentComponent[] {
  return project.ventilation.components.map((c) => {
    if (c.openingId) {
      const o = project.openings.find((x) => x.id === c.openingId);
      if (o) {
        return { ...c, shape: "rect" as const, widthM: o.widthM, heightM: o.heightM };
      }
    }
    return c;
  });
}
