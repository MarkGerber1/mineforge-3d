import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rm, symlink, stat, cp, readdir } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve, relative, dirname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { isWritablePath } from "./paths.ts";
import type { Actor } from "./privilege.server.ts";
import { auditFromActor, writeAudit } from "./audit.server.ts";

const exec = promisify(execFile);

export type JobStatus = "created" | "verifying" | "failed" | "preview" | "rejected" | "promoted";

export interface GateRun {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  ok: boolean;
}

export interface PreviewRuntime {
  kind: "artifact-proxy" | "job-ssr";
  pid: number;
  port?: number;
}

export interface JobRecord {
  id: string;
  branch: string;
  worktree: string;
  request: string;
  status: JobStatus;
  stableShaBefore: string;
  jobCommitSha?: string;
  previewCommitSha?: string;
  artifactDir?: string;
  previewRuntime?: PreviewRuntime;
  files: string[];
  gates: { typecheck?: GateRun; tests?: GateRun; build?: GateRun };
  previewUrl?: string;
  error?: string;
  createdAt: number;
  promotedSha?: string;
}

export interface HandlerResult {
  ok: boolean;
  status?: number;
  error?: string;
  job?: JobRecord;
  branch?: string;
  commit?: string;
  diff?: string;
  stableSha?: string;
}

const previewChildren = new Map<string, { pid: number; port: number }>();

function repoRoot(): string {
  return resolve(process.env.APP_EDIT_ROOT || process.cwd());
}

function jobsDir(root: string): string {
  return join(root, ".grok", "jobs");
}

function jobMetaPath(root: string, id: string): string {
  return join(jobsDir(root), `${id}.json`);
}

function promoteLogPath(root: string): string {
  return join(jobsDir(root), "promote-log.json");
}

export async function git(
  args: string[],
  cwd: string,
  timeout = 20000,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await exec("git", args, { cwd, timeout });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string; code?: number };
    return {
      ok: false,
      stdout: String(err.stdout ?? "").trim(),
      stderr: String(err.stderr ?? err.message ?? "git failed").trim(),
      code: typeof err.code === "number" ? err.code : 1,
    };
  }
}

async function runGate(command: string, args: string[], cwd: string, timeout: number): Promise<GateRun> {
  const label = [command, ...args].join(" ");
  try {
    const { stdout, stderr } = await exec(command, args, { cwd, timeout, env: process.env });
    return { command: label, exitCode: 0, stdout: String(stdout).slice(-8000), stderr: String(stderr).slice(-4000), ok: true };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number; message?: string };
    const exitCode = typeof err.code === "number" ? err.code : 1;
    return {
      command: label,
      exitCode,
      stdout: String(err.stdout ?? "").slice(-8000),
      stderr: String(err.stderr ?? err.message ?? "").slice(-4000),
      ok: false,
    };
  }
}

function relSafe(root: string, p: string): string {
  const abs = resolve(root, p);
  const rel = relative(root, abs).replace(/\\/g, "/");
  if (rel.startsWith("..") || rel.includes("\0")) throw new Error("Path escapes workspace");
  return rel;
}

export async function loadJob(root: string, id: string): Promise<JobRecord | null> {
  const p = jobMetaPath(root, id);
  try {
    return JSON.parse(await readFile(p, "utf8")) as JobRecord;
  } catch {
    return null;
  }
}

async function saveJob(root: string, job: JobRecord): Promise<void> {
  await mkdir(jobsDir(root), { recursive: true });
  await writeFile(jobMetaPath(root, idSafe(job.id)), JSON.stringify(job, null, 2), "utf8");
}

function idSafe(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
}

export async function stableSha(root = repoRoot()): Promise<string> {
  const r = await git(["rev-parse", "HEAD"], root);
  return r.stdout;
}

export async function workingTreeCleanExceptGrok(root: string): Promise<boolean> {
  const r = await git(["status", "--porcelain"], root);
  if (!r.ok) return false;
  const lines = r.stdout.split("\n").filter(Boolean);
  return lines.every((l) => l.includes(".grok/"));
}

async function linkNodeModules(root: string, worktree: string): Promise<void> {
  const src = join(root, "node_modules");
  const dest = join(worktree, "node_modules");
  if (!existsSync(src) || existsSync(dest)) return;
  try {
    await symlink(src, dest);
  } catch {
    /* optional */
  }
}

function previewPrefix(jobId: string): string {
  return `/__preview/${idSafe(jobId)}`;
}

function findClientBuild(worktree: string): string | null {
  const candidates = [
    join(worktree, ".vercel/output/static"),
    join(worktree, ".output/public"),
    join(worktree, "dist"),
  ];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    if (existsSync(join(c, "assets")) || existsSync(join(c, "index.html"))) return c;
  }
  return null;
}

function rewritePreviewText(text: string, prefix: string): string {
  const p = prefix.replace(/\/$/, "");
  return text
    .replaceAll("return`/`+e", `return\`${p}/\`+e`)
    .replaceAll("return '/' + e", `return '${p}/' + e`)
    .replaceAll("basepath:``", `basepath:\`${p}\``)
    .replaceAll('basepath:""', `basepath:"${p}"`)
    .replaceAll("e.update({basepath:``})", `e.update({basepath:\`${p}\`})`)
    .replaceAll('e.update({basepath:""})', `e.update({basepath:"${p}"})`)
    .replaceAll('href="/assets/', `href="${p}/assets/`)
    .replaceAll("href='/assets/", `href='${p}/assets/`)
    .replaceAll('src="/assets/', `src="${p}/assets/`)
    .replaceAll("src='/assets/", `src='${p}/assets/`)
    .replaceAll('href="/__grok/', `href="${p}/__grok/`)
    .replaceAll('href="/favicon', `href="${p}/favicon`)
    .replaceAll("href=`/favicon.svg`", `href=\`${p}/favicon.svg\``)
    .replaceAll("href:`/favicon.svg`", `href:\`${p}/favicon.svg\``)
    .replaceAll("href:`/__grok/", `href:\`${p}/__grok/`)
    .replaceAll("href:`/assets/", `href:\`${p}/assets/`)
    .replaceAll('href="/src/', `href="${p}/src/`)
    .replaceAll('src="/src/', `src="${p}/src/`)
    .replaceAll('href="/@', `href="${p}/@`)
    .replaceAll(`"${p}${p}/`, `"${p}/`);
}

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkFiles(p)));
    else out.push(p);
  }
  return out;
}

async function rewritePreviewTree(appDir: string, prefix: string): Promise<void> {
  const files = await walkFiles(appDir);
  for (const f of files) {
    if (!/\.(html|js|css|webmanifest|json)$/.test(f)) continue;
    const orig = await readFile(f, "utf8");
    const next = rewritePreviewText(orig, prefix);
    if (next !== orig) await writeFile(f, next, "utf8");
  }
}

function synthesizeIndexHtml(appDir: string, prefix: string, meta: Record<string, unknown>): string {
  const p = prefix.replace(/\/$/, "");
  let jsFile = "";
  let cssFile = "";
  const assets = join(appDir, "assets");
  if (existsSync(assets)) {
    const names = readdirSync(assets);
    jsFile = names.find((n) => n.startsWith("index-") && n.endsWith(".js")) || names.find((n) => n.endsWith(".js")) || "";
    cssFile = names.find((n) => n.endsWith(".css")) || "";
  }
  const css = cssFile ? `<link rel="stylesheet" href="${p}/assets/${cssFile}"/>` : "";
  const js = jsFile ? `<script type="module" src="${p}/assets/${jsFile}"></script>` : "";
  return `<!DOCTYPE html>
<html lang="ru" class="antialiased">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>MINEFORGE 3D</title>
<link rel="icon" type="image/svg+xml" href="${p}/favicon.svg"/>
${css}
</head>
<body class="bg-bg text-fg" data-mf-preview="app" data-job-commit="${String(meta.jobCommitSha ?? "")}">
<div id="root"></div>
<script>window.__MF_PREVIEW__=${JSON.stringify(meta)};</script>
${js}
</body>
</html>`;
}

function fixtureAppHtml(job: JobRecord, files: Array<{ path: string; content: string }>): string {
  const sources = files
    .map((f) => `<section data-file="${escapeHtml(f.path)}"><h2>${escapeHtml(f.path)}</h2><pre>${escapeHtml(f.content)}</pre></section>`)
    .join("\n");
  const collapsible = files.some((f) => /grok-collapse|collapsible/i.test(f.content));
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8"/>
<title>MINEFORGE 3D</title>
<style>
body{margin:0;background:#0b0d10;color:#d6d3ce;font:14px/1.4 "IBM Plex Sans",ui-sans-serif,system-ui}
#mf-app{display:flex;flex-direction:column;min-height:100vh}
header{border-bottom:1px solid #2a2e33;padding:12px 16px;font-weight:600}
[data-mf-id="grok"]{border-top:1px solid #2a2e33;padding:12px 16px}
button{background:#1a1f24;color:#d6d3ce;border:1px solid #2a2e33;border-radius:6px;padding:6px 10px;cursor:pointer}
pre{white-space:pre-wrap;background:#12151a;padding:12px;border-radius:6px}
</style>
</head>
<body data-mf-preview="app" data-job-commit="${escapeHtml(job.jobCommitSha ?? "")}">
<div id="mf-app">
<header>MINEFORGE 3D</header>
<main>
<p>Изолированная сборка job <code>${escapeHtml(job.id)}</code></p>
<div data-mf-id="grok">
  <div>MINEFORGE AI</div>
  ${collapsible ? `<button type="button" data-mf-id="grok-collapse" onclick="this.nextElementSibling.hidden=!this.nextElementSibling.hidden">Свернуть</button>` : ""}
  <div data-mf-id="grok-body">AI panel from job ${escapeHtml(job.id)}</div>
</div>
${sources}
</main>
</div>
<script>window.__MF_PREVIEW__=${JSON.stringify({
    jobId: job.id,
    jobCommitSha: job.jobCommitSha,
    previewCommitSha: job.jobCommitSha,
  })};</script>
</body>
</html>`;
}

function portForJob(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return 19100 + (h % 800);
}

function killPreviewRuntime(jobId: string): void {
  const rec = previewChildren.get(jobId);
  if (!rec) return;
  try {
    process.kill(rec.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  previewChildren.delete(jobId);
}

async function waitHttp(url: string, ms = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status === 404) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function startJobSsr(job: JobRecord): Promise<{ pid: number; port: number; html?: string } | null> {
  const output = join(job.worktree, ".vercel/output");
  const entry = join(output, "functions/__server.func/index.mjs");
  const staticDir = join(output, "static");
  const bin = join(job.worktree, "node_modules/.bin/srvx");
  if (!existsSync(entry) || !existsSync(bin) || !existsSync(staticDir)) return null;
  killPreviewRuntime(job.id);
  const port = portForJob(job.id);
  const child = spawn(
    bin,
    ["serve", "--prod", "--host", "127.0.0.1", "--port", String(port), "--static", "static", "--entry", "./functions/__server.func/index.mjs"],
    { cwd: output, detached: true, stdio: "ignore", env: { ...process.env, PORT: String(port) } },
  );
  if (!child.pid) return null;
  child.unref();
  previewChildren.set(job.id, { pid: child.pid, port });
  const ok = await waitHttp(`http://127.0.0.1:${port}/`);
  if (!ok) {
    killPreviewRuntime(job.id);
    return null;
  }
  let html: string | undefined;
  try {
    html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  } catch {
    html = undefined;
  }
  return { pid: child.pid, port, html };
}

async function clearPreviewApp(job: JobRecord): Promise<void> {
  killPreviewRuntime(job.id);
  await rm(join(job.worktree, "preview", "app"), { recursive: true, force: true }).catch(() => undefined);
  job.previewUrl = undefined;
  job.previewCommitSha = undefined;
  job.artifactDir = undefined;
  job.previewRuntime = undefined;
}

async function writePreview(job: JobRecord, diff: string): Promise<string> {
  const dir = join(job.worktree, "preview");
  const appDir = join(dir, "app");
  await rm(appDir, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(appDir, { recursive: true });
  const prefix = previewPrefix(job.id);
  const commit = job.jobCommitSha ?? "";
  const meta = {
    jobId: job.id,
    branch: job.branch,
    jobCommitSha: commit,
    previewCommitSha: commit,
    stableShaBefore: job.stableShaBefore,
    artifactDir: appDir,
    pid: process.pid,
    gates: {
      typecheck: job.gates.typecheck?.ok,
      tests: job.gates.tests?.ok,
      build: job.gates.build?.ok,
    },
  };

  const evidence = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><title>Evidence ${job.id}</title>
<style>body{font:14px/1.4 ui-monospace,monospace;background:#0b0d10;color:#d6d3ce;padding:24px}pre{white-space:pre-wrap}</style>
</head><body>
<h1>Application Edit evidence</h1>
<p>job ${escapeHtml(job.id)}</p>
<p>branch ${escapeHtml(job.branch)}</p>
<p>commit ${escapeHtml(commit)}</p>
<p>stable before ${escapeHtml(job.stableShaBefore)}</p>
<p>typecheck ${job.gates.typecheck?.ok ? "PASS" : "FAIL"} (${job.gates.typecheck?.exitCode ?? "-"})</p>
<p>tests ${job.gates.tests?.ok ? "PASS" : "FAIL"} (${job.gates.tests?.exitCode ?? "-"})</p>
<p>build ${job.gates.build?.ok ? "PASS" : "FAIL"} (${job.gates.build?.exitCode ?? "-"})</p>
<p><a href="${prefix}/">Open runnable preview</a></p>
<h2>diff</h2><pre>${escapeHtml(diff)}</pre>
</body></html>`;
  await writeFile(join(dir, "evidence.html"), evidence, "utf8");

  const buildRoot = findClientBuild(job.worktree);
  let runtime: PreviewRuntime = { kind: "artifact-proxy", pid: process.pid };
  if (buildRoot && existsSync(join(buildRoot, "assets"))) {
    await cp(buildRoot, appDir, { recursive: true });
    const ssr = await startJobSsr(job);
    if (ssr) {
      runtime = { kind: "job-ssr", pid: ssr.pid, port: ssr.port };
      meta.pid = ssr.pid;
      if (ssr.html && /<html/i.test(ssr.html) && !/Application Edit evidence/i.test(ssr.html)) {
        const injected = ssr.html.replace(/<body([^>]*)>/i, `<body$1 data-mf-preview="app" data-job-commit="${commit}">`);
        await writeFile(join(appDir, "index.html"), injected, "utf8");
      }
    }
    if (!existsSync(join(appDir, "index.html"))) {
      await writeFile(join(appDir, "index.html"), synthesizeIndexHtml(appDir, prefix, meta), "utf8");
    } else {
      const html = await readFile(join(appDir, "index.html"), "utf8");
      if (!/data-mf-preview/.test(html)) {
        await writeFile(
          join(appDir, "index.html"),
          html.replace(/<body([^>]*)>/i, `<body$1 data-mf-preview="app" data-job-commit="${commit}">`),
          "utf8",
        );
      }
    }
    await rewritePreviewTree(appDir, prefix);
  } else {
    const fileSnippets: Array<{ path: string; content: string }> = [];
    for (const rel of job.files) {
      try {
        fileSnippets.push({ path: rel, content: await readFile(join(job.worktree, rel), "utf8") });
      } catch {
        /* skip */
      }
    }
    await writeFile(join(appDir, "index.html"), fixtureAppHtml(job, fileSnippets), "utf8");
  }

  job.previewCommitSha = commit;
  job.artifactDir = appDir;
  job.previewRuntime = runtime;
  meta.pid = runtime.pid;
  await writeFile(
    join(dir, "PREVIEW.json"),
    JSON.stringify(
      {
        ...meta,
        previewCommitSha: commit,
        artifactDir: appDir,
        pid: runtime.pid,
        previewRuntime: runtime,
      },
      null,
      2,
    ),
    "utf8",
  );
  return `${prefix}/`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&" + "amp;";
      case "<":
        return "&" + "lt;";
      case ">":
        return "&" + "gt;";
      case '"':
        return "&" + "quot;";
      default:
        return "&#39;";
    }
  });
}

export async function runJobGates(worktree: string): Promise<{ typecheck: GateRun; tests: GateRun; build: GateRun; ok: boolean }> {
  let testArgs = ["test"];
  try {
    const pkg = JSON.parse(await readFile(join(worktree, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    if (pkg.scripts && pkg.scripts["test:oracle"]) testArgs = ["run", "test:oracle"];
  } catch {
    /* fixture without package.json scripts */
  }
  const typecheck = await runGate("npm", ["run", "typecheck"], worktree, 120000);
  const tests = await runGate("npm", testArgs, worktree, 120000);
  const build = await runGate("npm", ["run", "build"], worktree, 180000);
  return { typecheck, tests, build, ok: typecheck.ok && tests.ok && build.ok };
}

async function copyGeneratedIntoWorktree(root: string, worktree: string): Promise<void> {
  const generated = ["src/routeTree.gen.ts"];
  for (const rel of generated) {
    const src = join(root, rel);
    if (!existsSync(src)) continue;
    const dest = join(worktree, rel);
    try {
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, await readFile(src));
    } catch {
      /* optional generated files */
    }
  }
}

export async function createIsolatedJob(
  actor: Actor,
  input: {
    request: string;
    files?: Array<{ path: string; content: string }>;
    name?: string;
  },
): Promise<HandlerResult> {
  const root = repoRoot();
  const id = idSafe(input.name || randomUUID().slice(0, 12)) || randomUUID().slice(0, 12);
  const branch = `ai-edit/${id}`;
  const before = await stableSha(root);
  const worktree = join(jobsDir(root), id);
  await mkdir(jobsDir(root), { recursive: true });
  if (existsSync(worktree)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  const add = await git(["worktree", "add", "-b", branch, worktree, "HEAD"], root);
  if (!add.ok) {
    await writeAudit(root, auditFromActor(actor, "create_edit_branch", { jobId: id, branch, success: false, error: "worktree" }));
    return { ok: false, status: 403, error: "Forbidden" };
  }
  await linkNodeModules(root, worktree);
  await copyGeneratedIntoWorktree(root, worktree);
  const job: JobRecord = {
    id,
    branch,
    worktree,
    request: input.request.slice(0, 200),
    status: "created",
    stableShaBefore: before,
    files: [],
    gates: {},
    createdAt: Date.now(),
  };
  const files = input.files ?? [];
  for (const f of files) {
    let rel: string;
    try {
      rel = relSafe(worktree, f.path);
    } catch {
      await writeAudit(root, auditFromActor(actor, "write_source", { jobId: id, branch, files: [f.path], success: false }));
      return { ok: false, status: 403, error: "Forbidden" };
    }
    if (!isWritablePath(rel)) {
      await writeAudit(root, auditFromActor(actor, "write_source", { jobId: id, branch, files: [rel], success: false }));
      return { ok: false, status: 403, error: "APP EDIT blocked: protected path" };
    }
    const abs = join(worktree, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, f.content, "utf8");
    job.files.push(rel);
  }
  if (job.files.length) {
    await git(["add", "--", ...job.files], worktree);
    const commit = await git(["commit", "-m", `ai-edit: ${job.request}`.slice(0, 120)], worktree);
    if (commit.ok) {
      job.jobCommitSha = (await git(["rev-parse", "HEAD"], worktree)).stdout;
    }
  } else {
    job.jobCommitSha = (await git(["rev-parse", "HEAD"], worktree)).stdout;
  }
  const afterStable = await stableSha(root);
  if (afterStable !== before) {
    await writeAudit(root, auditFromActor(actor, "create_edit_branch", { jobId: id, branch, success: false, error: "stable-mutated" }));
    return { ok: false, status: 403, error: "Forbidden" };
  }
  job.status = "verifying";
  await saveJob(root, job);
  const gates = await runJobGates(worktree);
  job.gates = { typecheck: gates.typecheck, tests: gates.tests, build: gates.build };
  const diff = (await git(["show", "--stat", "--oneline", "-1"], worktree)).stdout;
  if (!gates.ok) {
    job.status = "failed";
    job.error = "verification gates failed";
    await clearPreviewApp(job);
    await saveJob(root, job);
    await writeAudit(
      root,
      auditFromActor(actor, "create_edit_job", {
        jobId: id,
        branch,
        files: job.files,
        success: false,
        error: "gates",
      }),
    );
    return { ok: true, job, diff, stableSha: before, error: job.error };
  }
  job.status = "preview";
  job.previewUrl = await writePreview(job, diff);
  await saveJob(root, job);
  await writeAudit(
    root,
    auditFromActor(actor, "create_edit_job", { jobId: id, branch, files: job.files, success: true }),
  );
  return { ok: true, job, diff, branch, commit: job.jobCommitSha, stableSha: before };
}

export async function createEditBranchHandler(actor: Actor, name: string): Promise<HandlerResult> {
  return createIsolatedJob(actor, { request: `branch ${name}`, name });
}

export async function writeSourceFilesHandler(
  actor: Actor,
  input: { files: Array<{ path: string; content: string }>; message: string; branch?: string; jobId?: string },
): Promise<HandlerResult> {
  const root = repoRoot();
  if (input.jobId) {
    const job = await loadJob(root, input.jobId);
    if (!job) return { ok: false, status: 403, error: "Forbidden" };
    if (job.status === "promoted" || job.status === "rejected") return { ok: false, status: 403, error: "Forbidden" };
    for (const f of input.files) {
      const rel = relSafe(job.worktree, f.path);
      if (!isWritablePath(rel)) return { ok: false, status: 403, error: "APP EDIT blocked: protected path" };
      const abs = join(job.worktree, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, f.content, "utf8");
      if (!job.files.includes(rel)) job.files.push(rel);
    }
    await git(["add", "--", ...input.files.map((f) => relSafe(job.worktree, f.path))], job.worktree);
    const commit = await git(["commit", "-m", input.message.slice(0, 120)], job.worktree);
    job.jobCommitSha = (await git(["rev-parse", "HEAD"], job.worktree)).stdout;
    job.previewCommitSha = undefined;
    job.status = "verifying";
    const gates = await runJobGates(job.worktree);
    job.gates = { typecheck: gates.typecheck, tests: gates.tests, build: gates.build };
    if (gates.ok) {
      job.status = "preview";
      const diff = (await git(["show", "--stat", "--oneline", "-1"], job.worktree)).stdout;
      job.previewUrl = await writePreview(job, diff);
    } else {
      job.status = "failed";
      job.error = "verification gates failed";
      await clearPreviewApp(job);
    }
    await saveJob(root, job);
    await writeAudit(
      root,
      auditFromActor(actor, "write_source", { jobId: job.id, branch: job.branch, files: job.files, success: gates.ok }),
    );
    const stable = await stableSha(root);
    return {
      ok: true,
      job,
      commit: commit.ok ? job.jobCommitSha : "nothing-to-commit",
      diff: (await git(["show", "--stat", "--oneline", "-1"], job.worktree)).stdout,
      stableSha: stable,
    };
  }
  return createIsolatedJob(actor, { request: input.message, files: input.files, name: input.branch?.replace(/^ai-edit\//, "") });
}

export async function rejectJobHandler(actor: Actor, jobId: string): Promise<HandlerResult> {
  const root = repoRoot();
  const job = await loadJob(root, jobId);
  if (!job) return { ok: false, status: 403, error: "Forbidden" };
  const before = await stableSha(root);
  killPreviewRuntime(job.id);
  await git(["worktree", "remove", "--force", job.worktree], root);
  await git(["branch", "-D", job.branch], root);
  job.status = "rejected";
  job.previewUrl = undefined;
  await saveJob(root, job);
  const after = await stableSha(root);
  await writeAudit(root, auditFromActor(actor, "reject_job", { jobId, branch: job.branch, success: after === before }));
  return { ok: true, job, stableSha: after };
}

export async function promoteJobHandler(actor: Actor, jobId: string): Promise<HandlerResult> {
  const root = repoRoot();
  const job = await loadJob(root, jobId);
  if (!job || job.status !== "preview" || !job.jobCommitSha) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  if (!job.previewCommitSha || job.previewCommitSha !== job.jobCommitSha) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  const headNow = (await git(["rev-parse", "HEAD"], job.worktree)).stdout;
  if (headNow !== job.jobCommitSha) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  const before = await stableSha(root);
  const merge = await git(["merge", "--ff-only", job.jobCommitSha], root);
  if (!merge.ok) {
    await writeAudit(root, auditFromActor(actor, "promote_job", { jobId, branch: job.branch, success: false }));
    return { ok: false, status: 403, error: "Forbidden" };
  }
  const after = await stableSha(root);
  job.status = "promoted";
  job.promotedSha = after;
  await saveJob(root, job);
  await mkdir(jobsDir(root), { recursive: true });
  await writeFile(
    promoteLogPath(root),
    JSON.stringify({ previousSha: before, newSha: after, jobId: job.id, commit: job.jobCommitSha, at: Date.now() }),
    "utf8",
  );
  await writeAudit(
    root,
    auditFromActor(actor, "promote_job", { jobId, branch: job.branch, files: job.files, success: true }),
  );
  return { ok: true, job, commit: after, stableSha: after };
}

export async function rollbackStableHandler(actor: Actor, ref?: string): Promise<HandlerResult> {
  const root = repoRoot();
  let target = ref;
  if (!target) {
    try {
      const log = JSON.parse(await readFile(promoteLogPath(root), "utf8")) as { previousSha?: string };
      target = log.previousSha;
    } catch {
      target = "HEAD";
    }
  }
  if (!target || !/^[a-zA-Z0-9/_.=-]+$/.test(target)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  const before = await stableSha(root);
  const r = await git(["reset", "--hard", target], root);
  const after = await stableSha(root);
  await writeAudit(
    root,
    auditFromActor(actor, "rollback_stable", { success: r.ok, error: r.ok ? undefined : "git" }),
  );
  if (!r.ok) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, stableSha: after, commit: `${before} -> ${after}` };
}

export async function inspectRepoHandler(): Promise<{
  ok: true;
  branch: string;
  status: string;
  log: string;
  files: string[];
}> {
  const root = repoRoot();
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git" || e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        const rel = relative(root, p).replace(/\\/g, "/");
        if (rel.endsWith(".ts") || rel.endsWith(".tsx") || rel.endsWith(".css")) files.push(rel);
      }
    }
  }
  await walk(join(root, "src")).catch(() => undefined);
  const status = await git(["status", "-sb"], root);
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], root);
  const log = await git(["log", "-8", "--oneline"], root);
  return { ok: true, branch: branch.stdout || "unknown", status: status.stdout, log: log.stdout, files: files.slice(0, 400) };
}

export async function readSourceFileHandler(path: string): Promise<{ ok: true; path: string; content: string } | { ok: false; error: string }> {
  const root = repoRoot();
  const rel = relSafe(root, path);
  if (!rel.startsWith("src/")) return { ok: false, error: "Only src/ is readable." };
  const abs = join(root, rel);
  const st = await stat(abs).catch(() => null);
  if (!st || !st.isFile()) return { ok: false, error: "Missing file" };
  if (st.size > 200_000) return { ok: false, error: "File too large" };
  return { ok: true, path: rel, content: await readFile(abs, "utf8") };
}

export function previewFilePath(jobId: string, urlPath: string): string | null {
  const resolved = resolvePreviewFile(jobId, urlPath);
  return resolved?.abs ?? null;
}

export function resolvePreviewFile(jobId: string, urlPath: string): { abs: string; spa: boolean } | null {
  const root = repoRoot();
  const id = idSafe(jobId);
  if (!id) return null;
  const jobRoot = resolve(join(jobsDir(root), id));
  const previewRoot = resolve(join(jobRoot, "preview"));
  const appRoot = resolve(join(previewRoot, "app"));
  const rel = decodeURIComponent(urlPath.replace(/^\/+/, "")) || "index.html";
  if (rel.includes("..") || rel.includes("\0")) return null;
  if (rel === "PREVIEW.json" || rel === "evidence.html") {
    const abs = resolve(previewRoot, rel);
    if (!abs.startsWith(previewRoot)) return null;
    return existsSync(abs) ? { abs, spa: false } : null;
  }
  const abs = resolve(appRoot, rel);
  if (!abs.startsWith(appRoot)) return null;
  if (existsSync(abs)) {
    try {
      const st = readdirSync(abs);
      void st;
      const idx = resolve(abs, "index.html");
      if (existsSync(idx)) return { abs: idx, spa: false };
    } catch {
      return { abs, spa: false };
    }
  }
  const index = resolve(appRoot, "index.html");
  if (existsSync(index) && !rel.includes(".")) return { abs: index, spa: true };
  return null;
}

export { basename };
