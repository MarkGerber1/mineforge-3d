import type { Project } from "../engineering/types.ts";

export type FailureKind =
  | "none"
  | "fan-fail"
  | "dirty-filter"
  | "intake-blocked"
  | "exhaust-blocked"
  | "hot-35"
  | "cold-25"
  | "power-cut";

export const FAILURE_LABELS: Record<FailureKind, string> = {
  none: "Норма",
  "fan-fail": "Отказ вентилятора",
  "dirty-filter": "Грязный / забитый фильтр",
  "intake-blocked": "Заблокирован приток",
  "exhaust-blocked": "Заблокирована вытяжка",
  "hot-35": "На улице +35 °C",
  "cold-25": "На улице −25 °C",
  "power-cut": "Снижение мощности −30%",
};

/** Clone-and-perturb. Does not mutate the canonical project. */
export function applyFailure(project: Project, kind: FailureKind): Project {
  if (kind === "none") return project;
  const p: Project = structuredClone(project);
  if (kind === "fan-fail") p.fans = [];
  if (kind === "dirty-filter") p.ventilation.dirtyFilter = true;
  if (kind === "intake-blocked") {
    p.openings = p.openings.map((o) => (o.type === "INTAKE" ? { ...o, widthM: Math.min(o.widthM, 0.08), heightM: Math.min(o.heightM, 0.08) } : o));
  }
  if (kind === "exhaust-blocked") {
    p.openings = p.openings.map((o) =>
      o.type === "EXHAUST" || o.type === "SHAFT_CONNECTION" ? { ...o, widthM: Math.min(o.widthM, 0.08), heightM: Math.min(o.heightM, 0.08) } : o,
    );
  }
  if (kind === "hot-35") {
    p.thermal.outdoorTempC = 35;
    p.thermal.intakeTempC = 35;
    p.ventilation.outdoorTempC = 35;
  }
  if (kind === "cold-25") {
    p.thermal.outdoorTempC = -25;
    p.thermal.intakeTempC = -25;
    p.ventilation.outdoorTempC = -25;
  }
  if (kind === "power-cut") {
    p.electrical.availablePowerW = Math.round(p.electrical.availablePowerW * 0.7);
  }
  return p;
}
