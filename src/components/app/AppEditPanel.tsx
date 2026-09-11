import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/project/store";
import { createEditBranch, inspectRepo, readSourceFile, rollbackChange, writeSourceFiles } from "@/ai/appedit";
import { UI_REGISTRY } from "@/ai/registry";

export function AppEditPanel() {
  const store = useProjectStore();
  const [info, setInfo] = useState<string>("Проверка локального Git…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void inspectRepo()
      .then((r) => {
        if (r && "ok" in r && r.ok) setInfo(`Git ${r.branch}\n${r.status || "clean"}\n${r.log}`);
        else setInfo("APP EDIT BACKEND NOT CONNECTED");
      })
      .catch(() => setInfo("APP EDIT BACKEND NOT CONNECTED"));
  }, []);

  const job = store.pendingAppEdit;

  const apply = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const br = await createEditBranch({ data: { name: job.branch.replace(/^ai-edit\//, "") || "ui" } });
      if (!br?.ok) {
        store.pushGrok({ id: `ae${Date.now()}`, role: "assistant", text: br?.error || "Не удалось создать ветку ai-edit/…" });
        return;
      }
      const files = job.files ?? [];
      const written: Array<{ path: string; content: string }> = [];
      for (const f of files) {
        if (!f.path || !f.newSnippet) continue;
        const cur = await readSourceFile({ data: { path: f.path } });
        if (!cur?.ok) continue;
        let next = cur.content;
        if (f.oldSnippet && cur.content.includes(f.oldSnippet)) next = cur.content.replace(f.oldSnippet, f.newSnippet);
        else if (f.newSnippet.startsWith(cur.content.slice(0, 40))) next = f.newSnippet;
        else {
          store.pushGrok({
            id: `ae${Date.now()}`,
            role: "assistant",
            text: `Не могу безопасно применить ${f.path}: нет точного oldSnippet в файле. Файл не перезаписан.`,
          });
          continue;
        }
        written.push({ path: f.path, content: next });
      }
      if (!written.length) {
        store.pushGrok({
          id: `ae${Date.now()}`,
          role: "assistant",
          text: "Нет безопасного patch. APP EDIT не затирает файлы по расплывчатой инструкции.",
        });
        return;
      }
      const res = await writeSourceFiles({
        data: {
          branch: br.branch,
          message: job.request.slice(0, 120),
          files: written,
        },
      });
      if (!res?.ok) {
        store.pushGrok({ id: `ae${Date.now()}`, role: "assistant", text: res?.error || "Write blocked" });
        return;
      }
      store.pushAppEditJob({ ...job, status: "applied", diff: res.diff, at: Date.now() });
      store.setPendingAppEdit(null);
      store.pushGrok({
        id: `ae${Date.now()}`,
        role: "assistant",
        text: `Применено на ${res.branch}. Живой preview — текущее приложение (HMR). Rollback — «Верни как было».`,
      });
    } finally {
      setBusy(false);
    }
  };

  const rollback = async () => {
    setBusy(true);
    const r = await rollbackChange({ data: { ref: "main" } });
    setBusy(false);
    store.pushGrok({
      id: `ae${Date.now()}`,
      role: "assistant",
      text: r?.ok ? "Откат UI с main. Engineering Core не тронут." : r?.error || "Rollback failed",
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-3 text-[12px]">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted">Application editor</div>
      <pre className="mt-2 whitespace-pre-wrap rounded-[8px] border border-border bg-bg p-2 font-mono text-[11px] text-muted">{info}</pre>
      {store.pickedUi && (
        <div className="mt-2 rounded-[8px] border border-border p-2">
          Указан: {store.pickedUi.name}
          <div className="font-mono text-[11px] text-muted">{store.pickedUi.file}</div>
        </div>
      )}
      <Button variant="outline" className="mt-2 h-10" onClick={() => store.setUiPick(true)}>
        Указать элемент интерфейса
      </Button>
      {job && (
        <div className="mt-3 rounded-[10px] border border-border bg-panel p-2">
          <div className="font-medium">{job.request}</div>
          <div className="mt-1 font-mono text-[11px] text-muted">{job.files.map((f) => f.path).join(", ")}</div>
          <div className="mt-2 flex gap-1">
            <Button disabled={busy} onClick={() => void apply()}>
              APPLY
            </Button>
            <Button variant="outline" onClick={() => store.setPendingAppEdit(null)}>
              CANCEL
            </Button>
          </div>
        </div>
      )}
      <Button variant="outline" className="mt-2 h-10" disabled={busy} onClick={() => void rollback()}>
        Верни как было (main)
      </Button>
      <div className="mt-3 text-[10px] uppercase tracking-[0.12em] text-muted">Компоненты</div>
      <ul className="mt-1 space-y-1 text-muted">
        {UI_REGISTRY.map((c) => (
          <li key={c.id} className="font-mono text-[11px]">
            {c.id} — {c.file}
          </li>
        ))}
      </ul>
      {store.appEditJobs.length > 0 && (
        <div className="mt-3 space-y-1">
          {store.appEditJobs.slice(0, 6).map((j) => (
            <div key={j.id} className="text-[11px] text-muted">
              {j.status} · {j.branch} · {j.request.slice(0, 60)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
