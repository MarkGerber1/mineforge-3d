import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, rm, symlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
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

export interface JobRecord {
  id: string;
  branch: string;
  worktree: string;
  request: string;
  status: JobStatus;
  stableShaBefore: string;
  jobCommitSha?: string;
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

async function writePreview(job: JobRecord, diff: string): Promise<string> {
  const dir = join(job.worktree, "preview");
  await mkdir(dir, { recursive: true });
  const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><title>Preview ${job.id}</title>
<style>body{font:14px/1.4 ui-monospace,monospace;background:#0b0d10;color:#d6d3ce;padding:24px}pre{white-space:pre-wrap}</style>
</head><body>
<h1>Isolated Application Edit preview</h1>
<p>job ${job.id}</p>
<p>branch ${job.branch}</p>
<p>commit ${job.jobCommitSha ?? ""}</p>
<p>stable before ${job.stableShaBefore}</p>
<p>typecheck ${job.gates.typecheck?.ok ? "PASS" : "FAIL"} (${job.gates.typecheck?.exitCode ?? "-"})</p>
<p>tests ${job.gates.tests?.ok ? "PASS" : "FAIL"} (${job.gates.tests?.exitCode ?? "-"})</p>
<p>build ${job.gates.build?.ok ? "PASS" : "FAIL"} (${job.gates.build?.exitCode ?? "-"})</p>
<h2>diff</h2><pre>${escapeHtml(diff)}</pre>
</body></html>`;
  await writeFile(join(dir, "index.html"), html, "utf8");
  await writeFile(
    join(dir, "PREVIEW.json"),
    JSON.stringify(
      {
        jobId: job.id,
        branch: job.branch,
        commit: job.jobCommitSha,
        stableShaBefore: job.stableShaBefore,
        gates: {
          typecheck: job.gates.typecheck?.ok,
          tests: job.gates.tests?.ok,
          build: job.gates.build?.ok,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return `/__preview/${job.id}/`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
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
    job.status = "verifying";
    const gates = await runJobGates(job.worktree);
    job.gates = { typecheck: gates.typecheck, tests: gates.tests, build: gates.build };
    job.status = gates.ok ? "preview" : "failed";
    if (gates.ok) {
      const diff = (await git(["show", "--stat", "--oneline", "-1"], job.worktree)).stdout;
      job.previewUrl = await writePreview(job, diff);
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
  await git(["worktree", "remove", "--force", job.worktree], root);
  await git(["branch", "-D", job.branch], root);
  job.status = "rejected";
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
  const root = repoRoot();
  const id = idSafe(jobId);
  if (!id) return null;
  const base = resolve(join(jobsDir(root), id, "preview"));
  const rel = urlPath.replace(/^\/+/, "") || "index.html";
  if (rel.includes("..") || rel.includes("\0")) return null;
  const abs = resolve(base, rel);
  if (!abs.startsWith(base)) return null;
  return abs;
}

export { basename };
