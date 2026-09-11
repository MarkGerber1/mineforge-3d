import type { Project } from "../engineering/types.ts";

export function nextInterviewQuestion(project: Project): string | null {
  const r = project.reality ?? { photos: [], asBuilt: [], findings: [], interview: [], compareMode: "as-designed" as const };
  const asked = new Set(r.interview.map((i) => i.q));
  const q: string[] = [];
  if (!r.photos.length) q.push("Загрузите фото фронтальной стены помещения.");
  else {
    if (!r.photos.some((p) => p.wallHint)) q.push("Какая из загруженных фотографий — фронтальная стена?");
    if (!r.photos.some((p) => p.markers.some((m) => m.lengthM))) {
      q.push("Укажите известный размер на фото: две точки A–B и длину в метрах (например 2,43).");
    }
    const door = project.openings.find((o) => o.type === "DOOR");
    if (door && !r.photos.some((p) => p.markers.some((m) => m.kind === "door"))) {
      q.push(`Это та же дверь ${door.name ?? door.id}, что в проекте (${(door.widthM * 1000).toFixed(0)} мм)?`);
    }
    const exhaust = project.openings.find((o) => o.type === "EXHAUST" || o.type === "SHAFT_CONNECTION");
    if (exhaust && !r.photos.some((p) => p.markers.some((m) => m.kind === "shaft" || m.kind === "opening"))) {
      q.push("Это вентиляционная шахта / вытяжной проём с фото?");
    }
    if (r.photos.length === 1) q.push("Сделайте ещё одно фото с правого угла — одного кадра недостаточно для геометрии.");
  }
  return q.find((x) => !asked.has(x)) ?? null;
}
