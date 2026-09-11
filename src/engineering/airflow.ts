import { AIR_DENSITY_KG_M3 } from "./constants.ts";
import type { DuctShape, VentComponent } from "./types.ts";
import { m3hToM3s } from "./units.ts";

export function crossSectionAreaM2(c: Pick<VentComponent, "shape" | "widthM" | "heightM" | "diameterM">): number {
  if (c.shape === "round") {
    const d = c.diameterM ?? 0;
    return (Math.PI * d * d) / 4;
  }
  return (c.widthM ?? 0) * (c.heightM ?? 0);
}

export function hydraulicDiameterM(c: Pick<VentComponent, "shape" | "widthM" | "heightM" | "diameterM">): number {
  if (c.shape === "round") return c.diameterM ?? 0;
  const a = c.widthM ?? 0;
  const b = c.heightM ?? 0;
  if (a + b <= 0) return 0;
  return (2 * a * b) / (a + b);
}

export function velocityMs(flowM3h: number, areaM2: number): number {
  if (areaM2 <= 0) return Infinity;
  return m3hToM3s(flowM3h) / areaM2;
}

export function dynamicPressurePa(velocityMs: number, rho = AIR_DENSITY_KG_M3): number {
  return (rho * velocityMs * velocityMs) / 2;
}

export function frictionLossPa(f: number, lengthM: number, dhM: number, pvPa: number): number {
  if (dhM <= 0) return 0;
  return f * (lengthM / dhM) * pvPa;
}

export function localLossPa(k: number, pvPa: number): number {
  return k * pvPa;
}

export function rectDuct(widthM: number, heightM: number): { areaM2: number; dhM: number } {
  const dummy: VentComponent = {
    id: "_",
    kind: "duct",
    name: "_",
    shape: "rect" satisfies DuctShape,
    widthM,
    heightM,
    lengthM: 0,
    frictionFactor: 0,
    kLocal: 0,
    extraPressurePa: 0,
  };
  return { areaM2: crossSectionAreaM2(dummy), dhM: hydraulicDiameterM(dummy) };
}
