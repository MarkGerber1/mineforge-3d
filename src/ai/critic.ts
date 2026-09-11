import type { EngineeringResult, Project } from "../engineering/types.ts";

export interface CritiqueItem {
  id: string;
  severity: "INFO" | "WARNING" | "CRITICAL" | "BLOCKER";
  title: string;
  detail: string;
}

/** Read-only critic. Uses Engineering Core results only — never invents numbers. */
export function critiqueProject(project: Project, result: EngineeringResult): CritiqueItem[] {
  const items: CritiqueItem[] = [];
  const safe = result.capacity.safe;
  if (safe != null && project.fleet.requestedCount > safe) {
    items.push({
      id: "over-request",
      severity: "CRITICAL",
      title: `Запрос ${project.fleet.requestedCount} выше SAFE ${safe}`,
      detail: `Bottleneck: ${result.capacity.bottlenecks.join(", ")}. ${result.capacity.why[0]?.display ?? ""}`,
    });
  }
  if (result.capacity.confidence !== "VERIFIED") {
    items.push({
      id: "confidence",
      severity: "WARNING",
      title: `Уверенность ${result.capacity.confidence}`,
      detail: result.missing.filter((m) => !m.complete).map((m) => m.question || m.key).join("; ") || "Не все входы подтверждены.",
    });
  }
  if (project.constraints.floorLoadingUnknown) {
    items.push({
      id: "floor",
      severity: "WARNING",
      title: "Нагрузка на перекрытие UNKNOWN",
      detail: "SAFE не может быть VERIFIED без несущей способности пола.",
    });
  }
  if (result.fan.pass === false) {
    items.push({
      id: "fan",
      severity: "CRITICAL",
      title: "Вентилятор FAIL на рабочей точке",
      detail: result.fan.reason,
    });
  }
  if (result.fan.dirtyPass === false) {
    items.push({
      id: "dirty",
      severity: "WARNING",
      title: "Нет запаса на грязный фильтр",
      detail: "Чистый режим может проходить, грязный — нет. Нет резерва по отказу фильтра.",
    });
  }
  if (project.fans.length < 2) {
    items.push({
      id: "redundancy",
      severity: "WARNING",
      title: "Нет резервного вентилятора",
      detail: "Отказ единственного вентилятора обнуляет вентиляционную ёмкость.",
    });
  }
  if (result.racks.recirculation.length) {
    items.push({
      id: "recirc",
      severity: "WARNING",
      title: "Риск рециркуляции горячего воздуха",
      detail: `${result.racks.recirculation.length} пар стоек с зазором < 0.6 m между выхлопом и забором.`,
    });
  }
  if (result.racks.collisions.length) {
    items.push({
      id: "collide",
      severity: "CRITICAL",
      title: "Столкновение стоек",
      detail: result.racks.collisions.map((c) => c.reason).join(" "),
    });
  }
  const asBuilt = project.reality?.asBuilt ?? [];
  if (asBuilt.length) {
    items.push({
      id: "asbuilt",
      severity: "INFO",
      title: `As-built объектов: ${asBuilt.length}`,
      detail: asBuilt.map((o) => `${o.kind} «${o.name}» (${o.provenance})`).join("; "),
    });
  }
  if (!result.electrical.asic?.manufacturerAirflowM3h) {
    items.push({
      id: "air-eq",
      severity: "INFO",
      title: "Нет паспортного расхода ASIC",
      detail: "Воздух считается по тепловому балансу Q = P / (ρ Cp ΔT). Это оценка, не CFD.",
    });
  }
  return items;
}
