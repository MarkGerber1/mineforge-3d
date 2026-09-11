import { createServerFn } from "@tanstack/react-start";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, normalize, relative, resolve } from "node:path";
import { z } from "zod";
import { isWritablePath } from "./paths.ts";

const exec = promisify(execFile);
const ROOT = resolve(process.cwd());

function relSafe(p: string): string {
  const abs = resolve(ROOT, p);
  const rel = relative(ROOT, abs);
  if (rel.startsWith("..") || normalize(rel).startsWith("..")) throw new Error("Path escapes workspace");
  return rel.replace(/\\/g, "/");
}

async function git(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec("git", args, { cwd: ROOT, timeout: 20000 });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? err.message ?? "git failed") };
  }
}

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else acc.push(relative(ROOT, p).replace(/\\/g, "/"));
  }
  return acc;
}

export const inspectRepo = createServerFn({ method: "POST" }).handler(async () => {
  const files = (await walk(join(ROOT, "src"))).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".css"));
  const status = await git(["status", "-sb"]);
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const log = await git(["log", "-8", "--oneline"]);
  return {
    ok: true as const,
    branch: branch.stdout || "unknown",
    status: status.stdout,
    log: log.stdout,
    files: files.slice(0, 400),
  };
});

export const searchCode = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ query: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const r = await git(["grep", "-n", "-I", "-e", data.query, "--", "src"]);
    return { ok: true as const, hits: r.stdout.split("\n").filter(Boolean).slice(0, 40) };
  });

export const readSourceFile = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ path: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const rel = relSafe(data.path);
    if (!rel.startsWith("src/")) return { ok: false as const, error: "Only src/ is readable." };
    const abs = join(ROOT, rel);
    const st = await stat(abs).catch(() => null);
    if (!st || !st.isFile()) return { ok: false as const, error: "Missing file" };
    if (st.size > 200_000) return { ok: false as const, error: "File too large" };
    const content = await readFile(abs, "utf8");
    return { ok: true as const, path: rel, content };
  });

export const writeSourceFiles = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        files: z.array(z.object({ path: z.string(), content: z.string().max(400_000) })).max(8),
        message: z.string().min(1).max(200),
        branch: z.string().min(1).max(80),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    for (const f of data.files) {
      const rel = relSafe(f.path);
      if (!isWritablePath(rel)) {
        return { ok: false as const, error: `APP EDIT blocked: ${rel} is protected (Engineering Core).` };
      }
    }
    const br = data.branch.replace(/[^a-zA-Z0-9/_-]/g, "-");
    const cur = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (cur.stdout === "main" || cur.stdout === "stable") {
      const co = await git(["checkout", "-B", br]);
      if (!co.ok) return { ok: false as const, error: co.stderr || "Cannot create branch" };
    }
    for (const f of data.files) {
      const rel = relSafe(f.path);
      const abs = join(ROOT, rel);
      await writeFile(abs, f.content, "utf8");
    }
    await git(["add", "--", ...data.files.map((f) => relSafe(f.path))]);
    const commit = await git(["commit", "-m", data.message]);
    const diff = await git(["show", "--stat", "--oneline", "-1"]);
    return {
      ok: true as const,
      branch: (await git(["rev-parse", "--abbrev-ref", "HEAD"])).stdout,
      commit: commit.ok ? commit.stdout : "unstaged (nothing to commit)",
      diff: diff.stdout,
    };
  });

export const rollbackChange = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ ref: z.string().min(1).max(80).optional() }).parse(d))
  .handler(async ({ data }) => {
    const ref = data.ref ?? "main";
    const r = await git(["checkout", ref, "--", "src/components", "src/styles.css", "src/ai/registry.ts", "src/ai/intent.ts"]);
    if (!r.ok) return { ok: false as const, error: r.stderr || "rollback failed" };
    return { ok: true as const, restored: ref };
  });

export const runOracle = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const { glob } = await import("node:fs/promises");
    const files: string[] = [];
    for await (const f of glob("src/engineering/oracle/*.test.ts", { cwd: ROOT })) files.push(f);
    const { stdout, stderr } = await exec("node", ["--experimental-strip-types", "--test", ...files], {
      cwd: ROOT,
      timeout: 60000,
      env: process.env,
    });
    const pass = /# fail\s+0/.test(stdout);
    return { ok: pass, stdout: stdout.slice(-4000), stderr: stderr.slice(-1000) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, stdout: String(err.stdout ?? "").slice(-4000), stderr: String(err.stderr ?? "").slice(-1000) };
  }
});

export const createEditBranch = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ name: z.string().min(3).max(60) }).parse(d))
  .handler(async ({ data }) => {
    const name = `ai-edit/${data.name.replace(/[^a-zA-Z0-9/_-]/g, "-")}`;
    const r = await git(["checkout", "-B", name]);
    return { ok: r.ok, branch: name, error: r.ok ? "" : r.stderr };
  });

export const runTypecheck = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const { stdout, stderr } = await exec("npx", ["tsc", "--noEmit"], { cwd: ROOT, timeout: 120000, env: process.env });
    return { ok: true as const, stdout: stdout.slice(-2000), stderr: stderr.slice(-1000) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false as const,
      stdout: String(err.stdout ?? "").slice(-2000),
      stderr: String(err.stderr ?? err.message ?? "").slice(-1000),
    };
  }
});
