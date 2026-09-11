import type { FanSpec } from "../engineering/types.ts";

function quadraticCurve(p0: number, qMax: number, n = 13) {
  const curve = [];
  for (let i = 0; i <= n; i++) {
    const flowM3h = (qMax * i) / n;
    const r = flowM3h / qMax;
    curve.push({ flowM3h, pressurePa: p0 * (1 - r * r) });
  }
  return curve;
}

/** Synthetic weak fan: huge free-air, insufficient pressure. Mandatory FAIL fixture. */
export const FAN_WEAK: FanSpec = {
  id: "FAN_WEAK",
  manufacturer: "TEST FIXTURE",
  model: "FAN_WEAK",
  curve: quadraticCurve(700, 60000),
  analytic: { p0: 700, qMax: 60000 },
  powerW: 5500,
  voltage: 400,
  phases: 3,
  soundDba: 78,
  freeAirM3h: 60000,
  source: { label: "Verification Pack FAN_WEAK", trust: "TEST_FIXTURE" },
};

export const FAN_STRONG: FanSpec = {
  id: "FAN_STRONG",
  manufacturer: "TEST FIXTURE",
  model: "FAN_STRONG",
  curve: quadraticCurve(1600, 60000),
  analytic: { p0: 1600, qMax: 60000 },
  powerW: 11000,
  voltage: 400,
  phases: 3,
  soundDba: 82,
  freeAirM3h: 60000,
  source: { label: "Verification Pack FAN_STRONG", trust: "TEST_FIXTURE" },
};

/** Industrial centrifugal-ish curve suitable for a 75 m shaft at ~30–40k m³/h. */
export const FAN_VKR_400: FanSpec = {
  id: "vkr-400-shaft",
  manufacturer: "MINEFORGE Library",
  model: "VKR-900-75",
  curve: quadraticCurve(1400, 52000),
  analytic: { p0: 1400, qMax: 52000 },
  powerW: 15000,
  voltage: 400,
  phases: 3,
  soundDba: 84,
  freeAirM3h: 52000,
  source: {
    label: "Library analytic curve (document as ESTIMATED until manufacturer curve is imported)",
    trust: "ESTIMATED",
  },
};

export const FAN_ROOF_800: FanSpec = {
  id: "roof-800",
  manufacturer: "MINEFORGE Library",
  model: "RF-800-ST",
  curve: quadraticCurve(900, 45000),
  analytic: { p0: 900, qMax: 45000 },
  powerW: 7500,
  voltage: 400,
  phases: 3,
  soundDba: 76,
  freeAirM3h: 45000,
  source: {
    label: "Library analytic curve — ESTIMATED",
    trust: "ESTIMATED",
  },
};

export const FAN_CATALOG: FanSpec[] = [FAN_STRONG, FAN_WEAK, FAN_VKR_400, FAN_ROOF_800];

export function getFan(id: string): FanSpec | undefined {
  return FAN_CATALOG.find((f) => f.id === id);
}

export function fanSpecMap(): Record<string, FanSpec> {
  return Object.fromEntries(FAN_CATALOG.map((f) => [f.id, f]));
}

export function findFan(query: string): FanSpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return FAN_CATALOG;
  return FAN_CATALOG.filter((f) => `${f.manufacturer} ${f.model} ${f.id}`.toLowerCase().includes(q));
}
