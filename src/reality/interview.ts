import type { Project } from "../engineering/types.ts";
import { photoCalibration } from "../engineering/reality.ts";

export function nextInterviewQuestion(project: Project): string | null {
  const r = project.reality ?? { photos: [], asBuilt: [], findings: [], interview: [], compareMode: "as-designed" as const };
  const asked = new Set(r.interview.map((i) => i.q));
  const q: string[] = [];
  if (!r.photos.length) q.push("Загрузите фото фронтальной стены помещения.");
  else {
    const active = r.photos[r.photos.length - 1];
    if (!r.photos.some((p) => p.wallHint)) q.push("Какая стена на фото — юг, север, запад или восток?");
    if (!r.photos.some((p) => photoCalibration(p))) {
      q.push("Укажите известный размер на фото: две точки A–B и длину в метрах (например 2,43). Это калибровка масштаба, не сантиметровая съёмка.");
    }
    const door = project.openings.find((o) => o.type === "DOOR");
    if (door && !r.photos.some((p) => p.markers.some((m) => m.kind === "door")) && !r.findings.some((f) => f.kind === "door")) {
      q.push(`Это та же дверь ${door.name ?? door.id}, что в проекте (${(door.widthM * 1000).toFixed(0)} мм)? Отметьте её на фото.`);
    }
    const exhaust = project.openings.find((o) => o.type === "EXHAUST" || o.type === "SHAFT_CONNECTION");
    if (exhaust && !r.photos.some((p) => p.markers.some((m) => m.kind === "shaft" || m.kind === "opening"))) {
      q.push("Это вентиляционная шахта / вытяжной проём с фото? Аннотируйте и подтвердите ADD TO MODEL.");
    }
    if (r.photos.length === 1) q.push("Сделайте ещё одно фото с правого угла — одного кадра недостаточно для геометрии.");
    void active;
  }
  return q.find((x) => !asked.has(x)) ?? null;
}
