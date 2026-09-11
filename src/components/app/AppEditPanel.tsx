import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useProjectStore } from "@/project/store";
import { readSourceFile } from "@/ai/appedit";
import { loadRuntime } from "@/ai/runtime-client";
import { UI_REGISTRY } from "@/ai/registry";
import { isWritablePath } from "@/ai/paths";

async function postAppEdit(path: string, body: unknown = {}): Promise<Record<string, unknown> & { httpStatus: number; ok: boolean }> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({ ok: false, error: "Request failed" }))) as Record<string, unknown>;
  return { ...json, httpStatus: res.status, ok: json.ok === true };
}

export function AppEditPanel() {
  const store = useProjectStore();
  const rt = store.runtime;
  const [pass, setPass] = useState("");
  const [info, setInfo] = useState("Проверка runtime…");
  const [busy, setBusy] = useState(false);
  const [jobMsg, setJobMsg] = useState("");

  useEffect(() => {
    void loadRuntime().then((s) => {
      store.setRuntime(s);
      if (s.mode !== "server") setInfo("STATIC MODE — Application Edit недоступен. CAD и Engineering Core работают локально.");
      else if (!s.appEditEnabled) setInfo("Application Edit unavailable on this deployment — APP EDIT DISABLED.");
      else if (s.role !== "owner") setInfo("APP EDIT требует server-side вход владельца. Анонимный и standard user не пишут репозиторий.");
      else setInfo("Владелец аутентифицирован. Правки идут в изолированный job, не в stable.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const job = store.pendingAppEdit;
  const staticMode = rt?.mode !== "server";
  const disabled = staticMode || !rt?.appEditEnabled;
  const isOwner = rt?.role === "owner";

  const login = async () => {
    setBusy(true);
    try {
      const res = await postAppEdit("/api/app-edit/login", { passphrase: pass, role: "owner", isOwner: true });
      const next = await loadRuntime();
      store.setRuntime(next);
      if (!res.ok) {
        setInfo(typeof res.error === "string" ? res.error : "Unauthorized");
      } else if (next.role !== "owner") {
        setInfo("Forbidden — client role=owner проигнорирован, нужна server-side сессия.");
      } else {
        setInfo("Владелец аутентифицирован.");
        setPass("");
      }
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await postAppEdit("/api/app-edit/logout");
    const next = await loadRuntime();
    store.setRuntime(next);
    setInfo("Сессия закрыта.");
  };

  const applyIsolated = async () => {
    if (!job || disabled || !isOwner) return;
    setBusy(true);
    setJobMsg("");
    try {
      const files: Array<{ path: string; content: string }> = [];
      for (const f of job.files ?? []) {
        if (!f.path || !isWritablePath(f.path) || !f.newSnippet) continue;
        const cur = await readSourceFile({ data: { path: f.path } });
        if (!cur || !("ok" in cur) || !cur.ok) continue;
        let next = cur.content;
        if (f.oldSnippet && cur.content.includes(f.oldSnippet)) next = cur.content.replace(f.oldSnippet, f.newSnippet);
        else if (f.newSnippet.startsWith(cur.content.slice(0, 40))) next = f.newSnippet;
        else continue;
        files.push({ path: f.path, content: next });
      }
      const res = await postAppEdit("/api/app-edit/jobs", {
        request: job.request.slice(0, 200),
        name: job.branch.replace(/^ai-edit\//, "").slice(0, 20) || undefined,
        files: files.length ? files : undefined,
      });
      if (!res.ok) {
        store.pushGrok({
          id: `ae${Date.now()}`,
          role: "assistant",
          text: typeof res.error === "string" ? res.error : "APP EDIT отклонён.",
        });
        return;
      }
      const j = res.job as
        | {
            id: string;
            status: string;
            previewUrl?: string;
            gates: { typecheck?: { ok?: boolean }; tests?: { ok?: boolean }; build?: { ok?: boolean } };
            stableShaBefore?: string;
            jobCommitSha?: string;
          }
        | undefined;
      const status = j?.status === "preview" ? "preview" : j?.status === "failed" ? "failed" : "proposed";
      store.pushAppEditJob({
        ...job,
        status,
        jobId: j?.id,
        previewUrl: j?.previewUrl,
        gates: {
          typecheck: j?.gates.typecheck?.ok,
          tests: j?.gates.tests?.ok,
          build: j?.gates.build?.ok,
        },
        stableSha: j?.stableShaBefore,
        jobCommitSha: j?.jobCommitSha,
        diff: typeof res.diff === "string" ? res.diff : "",
        at: Date.now(),
      });
      store.setPendingAppEdit(
        j
          ? {
              ...job,
              status,
              jobId: j.id,
              previewUrl: j.previewUrl,
              gates: {
                typecheck: j.gates.typecheck?.ok,
                tests: j.gates.tests?.ok,
                build: j.gates.build?.ok,
              },
              stableSha: j.stableShaBefore,
              jobCommitSha: j.jobCommitSha,
            }
          : null,
      );
      setJobMsg(
        j
          ? `job ${j.id} · ${j.status} · typecheck ${j.gates.typecheck?.ok ? "PASS" : "FAIL"} tests ${j.gates.tests?.ok ? "PASS" : "FAIL"} build ${j.gates.build?.ok ? "PASS" : "FAIL"}`
          : "job created",
      );
    } finally {
      setBusy(false);
    }
  };

  const promote = async () => {
    if (!job?.jobId || !isOwner) return;
    setBusy(true);
    try {
      const res = await postAppEdit("/api/app-edit/promote", { jobId: job.jobId });
      store.pushGrok({
        id: `ae${Date.now()}`,
        role: "assistant",
        text: res.ok ? `PROMOTE ${job.jobId}` : typeof res.error === "string" ? res.error : "Promote blocked",
      });
      if (res.ok) store.setPendingAppEdit(null);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (job?.jobId && isOwner) {
      setBusy(true);
      await postAppEdit("/api/app-edit/reject", { jobId: job.jobId });
      setBusy(false);
    }
    store.setPendingAppEdit(null);
  };

  const rollback = async () => {
    if (!isOwner || disabled) return;
    setBusy(true);
    const r = await postAppEdit("/api/app-edit/rollback", {});
    setBusy(false);
    store.pushGrok({
      id: `ae${Date.now()}`,
      role: "assistant",
      text: r.ok ? "ROLLBACK stable к предыдущей подтверждённой ревизии." : typeof r.error === "string" ? r.error : "Rollback blocked",
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-3 text-[12px]">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted">Application editor</div>
      <pre className="mt-2 whitespace-pre-wrap rounded-[8px] border border-border bg-bg p-2 font-mono text-[11px] text-muted">{info}</pre>
      {rt && (
        <div className="mt-2 font-mono text-[11px] text-muted">
          runtime {rt.mode} · AI {rt.ai ? "ON" : "OFFLINE"} · app-edit {rt.appEditEnabled ? "flag-on" : "flag-off"} · {rt.role}
        </div>
      )}
      {!disabled && !isOwner && (
        <form
          className="mt-2 flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void login();
          }}
        >
          <input
            type="password"
            className="h-10 rounded-[6px] border border-border bg-bg px-2"
            placeholder="Секрет владельца"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete="off"
          />
          <Button type="submit" disabled={busy || !pass} className="h-10">
            Войти как владелец
          </Button>
        </form>
      )}
      {isOwner && (
        <Button variant="outline" className="mt-2 h-10" onClick={() => void logout()}>
          Выйти
        </Button>
      )}
      {store.pickedUi && (
        <div className="mt-2 rounded-[8px] border border-border p-2">
          Указан: {store.pickedUi.name}
          <div className="font-mono text-[11px] text-muted">{store.pickedUi.file}</div>
        </div>
      )}
      <Button variant="outline" className="mt-2 h-10" disabled={disabled} onClick={() => store.setUiPick(true)}>
        Указать элемент интерфейса
      </Button>
      {job && (
        <div className="mt-3 rounded-[10px] border border-border bg-panel p-2">
          <div className="font-medium">{job.request}</div>
          <div className="mt-1 font-mono text-[11px] text-muted">{job.files.map((f) => f.path).join(", ")}</div>
          {jobMsg && <div className="mt-1 font-mono text-[11px] text-cold">{jobMsg}</div>}
          {job.previewUrl && (
            <a className="mt-1 block text-[11px] text-cold underline" href={job.previewUrl} target="_blank" rel="noreferrer">
              Isolated preview
            </a>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            <Button disabled={busy || disabled || !isOwner} onClick={() => void applyIsolated()}>
              RUN JOB
            </Button>
            <Button disabled={busy || !isOwner || job.status !== "preview"} onClick={() => void promote()}>
              PROMOTE
            </Button>
            <Button variant="outline" onClick={() => void reject()}>
              REJECT
            </Button>
          </div>
        </div>
      )}
      <Button variant="outline" className="mt-2 h-10" disabled={busy || disabled || !isOwner} onClick={() => void rollback()}>
        ROLLBACK stable
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
              {j.status} · {j.jobId || j.branch} · {j.request.slice(0, 60)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
