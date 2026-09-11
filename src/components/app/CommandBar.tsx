import { useProjectStore } from "@/project/store";
import { findAsic } from "@/equipment/asic-catalog";
import { findFan } from "@/equipment/fan-catalog";
import { parseLengthToMeters } from "@/engineering/units";

export function parseCommand(raw: string, store: ReturnType<typeof useProjectStore.getState>): string | null {
  const s = raw.trim();
  const lower = s.toLowerCase();
  const countAsic = s.match(/(\d+)\s*(?:x|×)?\s*(s21[^\s]*|t21|m60s?|test_asic_a)?/i);
  if ((/поставить|set|add/.test(lower) || countAsic) && countAsic) {
    const n = Number(countAsic[1]);
    const q = countAsic[2] ?? "";
    const found = q ? findAsic(q)[0] : undefined;
    store.setFleet(found?.id ?? store.project.fleet.asicId, n);
    return `Запрошено ${n} × ${found?.model ?? store.project.fleet.asicId}`;
  }
  if (/почему|why/.test(lower)) {
    store.setWhyOpen(true);
    store.setInspectorOpen(true);
    return `SAFE ${store.result.capacity.safe ?? "—"} из‑за ${store.result.capacity.bottlenecks.join(", ")}`;
  }
  if (/довест|достич|reach|target/.test(lower)) {
    return "Откройте «Как довести» в инспекторе — варианты считает ядро, не чат.";
  }
  const shaft = s.match(/шахт[^\d]*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
  if (shaft) {
    const w = parseLengthToMeters(shaft[1]);
    const h = parseLengthToMeters(shaft[2]);
    const comp = store.project.ventilation.components.find((c) => c.kind === "duct" && c.lengthM >= 10);
    if (w && h && comp) {
      store.commit(
        {
          ...store.project,
          ventilation: {
            ...store.project.ventilation,
            components: store.project.ventilation.components.map((c) =>
              c.id === comp.id || c.openingId ? { ...c, widthM: w, heightM: h } : c,
            ),
          },
        },
        "Resize shaft from command",
      );
      return `Шахта ${w} × ${h} m`;
    }
  }
  if (/втор(ой|ой вентилятор)|parallel|второй вентилятор/.test(lower)) {
    const f = store.project.fans[0];
    if (f) {
      store.setFan(f.specId, 2, "parallel");
      return "Параллельно × 2";
    }
  }
  const fanQ = findFan(s);
  if (/вентилятор|fan/.test(lower) && fanQ[0]) {
    store.setFan(fanQ[0].id, 1, "single");
    return `Вентилятор ${fanQ[0].model}`;
  }
  if (/сравн|compare/.test(lower)) {
    store.duplicateScenario("B");
    return "Сценарий B создан. Сравнение — по ASIC / kW / airflow / SAFE.";
  }
  return null;
}

export function CommandBar() {
  const store = useProjectStore();
  return (
    <form
      className="hidden h-9 items-center gap-2 border-b border-border bg-panel px-3 md:flex"
      data-mf-id="command"
      onSubmit={(e) => {
        e.preventDefault();
        const local = parseCommand(store.command, useProjectStore.getState());
        if (local) {
          store.pushGrok({ id: `c${Date.now()}`, role: "assistant", text: local });
          store.setCommand("");
        } else if (store.command.trim()) {
          const msg = store.command;
          store.setCommand("");
          store.askGrok(msg);
          store.setInspectorOpen(true);
        }
      }}
    >
      <span className="text-[11px] uppercase tracking-[0.12em] text-muted">Command</span>
      <input
        suppressHydrationWarning
        className="h-7 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
        placeholder='Поставить 30 S21 Pro · Увеличить шахту до 1.4 × 1.0 · Почему только 24?'
        value={store.command}
        onChange={(e) => store.setCommand(e.target.value)}
      />
    </form>
  );
}
