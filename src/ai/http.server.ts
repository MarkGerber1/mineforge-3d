import { readFile, stat } from "node:fs/promises";
import {
  authorizeMutation,
  cookieClearHeader,
  cookieSetHeader,
  loginWithPassphrase,
  runtimeSnapshot,
  type Actor,
} from "./privilege.server.ts";
import {
  createEditBranchHandler,
  createIsolatedJob,
  loadJob,
  resolvePreviewFile,
  promoteJobHandler,
  rejectJobHandler,
  rollbackStableHandler,
  writeSourceFilesHandler,
} from "./jobs.server.ts";
import { writeAudit, auditFromActor } from "./audit.server.ts";
import { allow, LIMITS, clientIpFromHeaders } from "./ratelimit.server.ts";

const ROOT = () => process.env.APP_EDIT_ROOT || process.cwd();

function json(status: number, body: unknown, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(extraHeaders ?? {}) },
  });
}

function tooMany(retryAfter: number): Response {
  return json(
    429,
    { ok: false, status: 429, error: "Too Many Requests", retryAfter },
    { "retry-after": String(retryAfter) },
  );
}

function denied(gate: { status: 401 | 403; error: string; actor: Actor; code: string }, action: string): Response {
  void writeAudit(
    ROOT(),
    auditFromActor(gate.actor, action, { success: false, status: gate.status, error: gate.code }),
  );
  return json(gate.status, { ok: false, status: gate.status, error: gate.error });
}

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function cookieHeader(req: Request): string | undefined {
  return req.headers.get("cookie") ?? undefined;
}

function isSecure(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return proto === "https";
}

async function requireMut(req: Request, action: string, body: unknown) {
  return authorizeMutation(action, { cookieHeader: cookieHeader(req), body, headers: { cookie: cookieHeader(req) } });
}

function mimeFor(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js") || file.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".woff2")) return "font/woff2";
  if (file.endsWith(".woff")) return "font/woff";
  if (file.endsWith(".wasm")) return "application/wasm";
  if (file.endsWith(".webmanifest")) return "application/manifest+json";
  if (file.endsWith(".map")) return "application/json";
  return "application/octet-stream";
}

export async function handleAppEditHttp(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();
  const ip = clientIpFromHeaders(req.headers);

  if (method === "GET" && (path === "/api/runtime" || path === "/api/runtime/")) {
    return new Response("<html>broken runtime</html>", { status: 500, headers: { "content-type": "text/html" } });
  }

  if (method === "GET" && path.startsWith("/__preview/")) {
    const rest = path.slice("/__preview/".length);
    const [jobId, ...fileParts] = rest.split("/");
    const rel = fileParts.join("/") || "index.html";
    const file = resolvePreviewFile(jobId || "", rel);
    if (!file) return json(404, { ok: false, error: "Not found" });
    try {
      const st = await stat(file.abs);
      if (!st.isFile()) return json(404, { ok: false, error: "Not found" });
      const buf = await readFile(file.abs);
      return new Response(buf, {
        status: 200,
        headers: { "content-type": mimeFor(file.abs), "cache-control": "no-store" },
      });
    } catch {
      return json(404, { ok: false, error: "Not found" });
    }
  }

  if (!path.startsWith("/api/app-edit")) return null;

  if (method === "POST" && (path === "/api/app-edit/login" || path === "/api/app-edit/login/")) {
    const lim = allow(`login:${ip}`, LIMITS.login);
    if (!lim.ok) return tooMany(lim.retryAfter);
    const body = (await readJson(req)) as { passphrase?: string; role?: string; isOwner?: boolean };
    const gate = loginWithPassphrase(String(body.passphrase ?? ""));
    if (!gate.ok) {
      void writeAudit(ROOT(), auditFromActor(gate.actor, "login", { success: false, status: gate.status, error: gate.code }));
      return json(gate.status, { ok: false, status: gate.status, error: gate.error });
    }
    void writeAudit(ROOT(), auditFromActor(gate.actor, "login", { success: true }));
    const headers: Record<string, string> = { "set-cookie": cookieSetHeader(gate.token!, isSecure(req)) };
    return json(200, { ok: true, role: gate.actor.role }, headers);
  }

  if (method === "POST" && (path === "/api/app-edit/logout" || path === "/api/app-edit/logout/")) {
    return json(200, { ok: true }, { "set-cookie": cookieClearHeader(isSecure(req)) });
  }

  if (method === "GET" && path.startsWith("/api/app-edit/jobs/")) {
    const gate = await requireMut(req, "read_job", {});
    if (!gate.ok) return denied(gate, "read_job");
    const id = path.slice("/api/app-edit/jobs/".length).replace(/\/$/, "");
    const job = await loadJob(ROOT(), id);
    if (!job) return json(404, { ok: false, error: "Not found" });
    return json(200, { ok: true, job });
  }

  if (method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const mutLim = allow(`mutate:${ip}`, LIMITS.mutate);
  if (!mutLim.ok) return tooMany(mutLim.retryAfter);

  const body = await readJson(req);

  if (path === "/api/app-edit/create-branch" || path === "/api/app-edit/create-branch/") {
    const gate = await requireMut(req, "create_edit_branch", body);
    if (!gate.ok) return denied(gate, "create_edit_branch");
    const name = String((body as { name?: string }).name ?? "ui");
    const res = await createEditBranchHandler(gate.actor, name);
    return json(res.ok ? 200 : (res.status ?? 403), res);
  }

  if (path === "/api/app-edit/write" || path === "/api/app-edit/write/") {
    const gate = await requireMut(req, "write_source", body);
    if (!gate.ok) return denied(gate, "write_source");
    const b = body as { files?: Array<{ path: string; content: string }>; message?: string; branch?: string; jobId?: string };
    const res = await writeSourceFilesHandler(gate.actor, {
      files: b.files ?? [],
      message: b.message ?? "ai-edit",
      branch: b.branch,
      jobId: b.jobId,
    });
    return json(res.ok ? 200 : (res.status ?? 403), res);
  }

  if (path === "/api/app-edit/commit" || path === "/api/app-edit/commit/") {
    const gate = await requireMut(req, "commit", body);
    if (!gate.ok) return denied(gate, "commit");
    const b = body as { files?: Array<{ path: string; content: string }>; message?: string; branch?: string; jobId?: string };
    const res = await writeSourceFilesHandler(gate.actor, {
      files: b.files ?? [],
      message: b.message ?? "commit",
      branch: b.branch,
      jobId: b.jobId,
    });
    return json(res.ok ? 200 : (res.status ?? 403), res);
  }

  if (path === "/api/app-edit/rollback" || path === "/api/app-edit/rollback/") {
    const gate = await requireMut(req, "rollback_stable", body);
    if (!gate.ok) return denied(gate, "rollback_stable");
    const res = await rollbackStableHandler(gate.actor, (body as { ref?: string }).ref);
    return json(res.ok ? 200 : (res.status ?? 403), res);
  }

  if (path === "/api/app-edit/jobs" || path === "/api/app-edit/jobs/") {
    const gate = await requireMut(req, "create_edit_job", body);
    if (!gate.ok) return denied(gate, "create_edit_job");
    const b = body as { request?: string; files?: Array<{ path: string; content: string }>; name?: string };
    const res = await createIsolatedJob(gate.actor, {
      request: b.request ?? "app edit",
      files: b.files,
      name: b.name,
    });
    return json(res.ok ? 200 : (res.status ?? 403), res);
  }

  if (path === "/api/app-edit/promote" || path === "/api/app-edit/promote/") {
    const gate = await requireMut(req, "promote_job", body);
    if (!gate.ok) return denied(gate, "promote_job");
    const res = await promoteJobHandler(gate.actor, String((body as { jobId?: string }).jobId ?? ""));
    return json(res.ok ? 200 : (res.status ?? 403), res);
  }

  if (path === "/api/app-edit/reject" || path === "/api/app-edit/reject/") {
    const gate = await requireMut(req, "reject_job", body);
    if (!gate.ok) return denied(gate, "reject_job");
    const res = await rejectJobHandler(gate.actor, String((body as { jobId?: string }).jobId ?? ""));
    return json(res.ok ? 200 : (res.status ?? 403), res);
  }

  return json(404, { ok: false, error: "Not found" });
}
