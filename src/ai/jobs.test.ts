import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, before, after } from "node:test";
import { signSession, sessionSecret } from "./privilege.server.ts";
import {
  createIsolatedJob,
  promoteJobHandler,
  rejectJobHandler,
  rollbackStableHandler,
  git,
  stableSha,
} from "./jobs.server.ts";
import { handleAppEditHttp } from "./http.server.ts";
import { PRIV_COOKIE } from "./privilege.server.ts";

const exec = promisify(execFile);
const PROJECT_NODE_MODULES = join(fileURLToPath(new URL("../..", import.meta.url)), "node_modules");
const OWNER = { sub: "owner", role: "owner" as const };
const USER = { sub: "user", role: "user" as const };

const BASE_ENV = {
  APP_EDIT_ENABLED: "true",
  APP_EDIT_OWNER_SECRET: "owner-secret-test",
  APP_EDIT_USER_SECRET: "user-secret-test",
  APP_EDIT_SESSION_SECRET: "session-secret-test",
};

async function makeFixture() {
  const dir = await mkdtemp(join(tmpdir(), "mf-job-"));
  await exec("git", ["init", "-b", "main"], { cwd: dir });
  await exec("git", ["config", "user.email", "t@t.test"], { cwd: dir });
  await exec("git", ["config", "user.name", "t"], { cwd: dir });
  await mkdir(join(dir, "src/components"), { recursive: true });
  await mkdir(join(dir, "src/engineering"), { recursive: true });
  await mkdir(join(dir, "src/ai"), { recursive: true });
  await writeFile(join(dir, "src/components/Panel.ts"), 'export const Panel = "ok";\n');
  await writeFile(join(dir, "src/engineering/core.ts"), "export const CORE = 1;\n");
  await writeFile(join(dir, "src/styles.css"), "body{margin:0}\n");
  await writeFile(join(dir, "src/ai/intent.ts"), "export const x = 1;\n");
  await writeFile(join(dir, "src/ai/registry.ts"), "export const r = [];\n");
  await writeFile(
    join(dir, "src/ok.test.ts"),
    `import assert from "node:assert/strict";\nimport { it } from "node:test";\nit("ok", () => assert.equal(1, 1));\n`,
  );
  await writeFile(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        module: "nodenext",
        moduleResolution: "nodenext",
        target: "es2022",
        types: ["node"],
      },
      include: ["src"],
    }),
  );
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "mf-fixture",
      type: "module",
      scripts: {
        typecheck: "tsc --noEmit",
        test: "node --experimental-strip-types --test src/ok.test.ts",
        build: "tsc --noEmit && mkdir -p dist && echo ok > dist/ok.txt",
      },
    }),
  );
  const nm = join(dir, "node_modules");
  if (!existsSync(nm) && existsSync(PROJECT_NODE_MODULES)) await symlink(PROJECT_NODE_MODULES, nm);
  await exec("git", ["add", "-A"], { cwd: dir });
  await exec("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

describe("Application Edit isolation pipeline", { concurrency: 1 }, () => {
  let dir = "";
  let prev: Record<string, string | undefined> = {};

  before(async () => {
    dir = await makeFixture();
    prev = {
      APP_EDIT_ROOT: process.env.APP_EDIT_ROOT,
      ...Object.fromEntries(Object.keys(BASE_ENV).map((k) => [k, process.env[k]])),
    };
    process.env.APP_EDIT_ROOT = dir;
    Object.assign(process.env, BASE_ENV);
  });

  after(async () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("TEST A/B — isolated job does not change stable SHA or files", async () => {
    const before = await stableSha(dir);
    const panelBefore = await readFile(join(dir, "src/components/Panel.ts"), "utf8");
    const res = await createIsolatedJob(OWNER, {
      request: "Сделай AI-панель сворачиваемой.",
      name: "collapse",
      files: [{ path: "src/components/Panel.ts", content: 'export const Panel = "collapsible";\n' }],
    });
    assert.equal(res.ok, true);
    assert.ok(res.job);
    const after = await stableSha(dir);
    assert.equal(after, before, "stable SHA must not change before PROMOTE");
    assert.equal(await readFile(join(dir, "src/components/Panel.ts"), "utf8"), panelBefore);
    const wt = res.job!.worktree;
    assert.equal(await readFile(join(wt, "src/components/Panel.ts"), "utf8"), 'export const Panel = "collapsible";\n');
    const diff = (await git(["diff", before, res.job!.jobCommitSha!], dir)).stdout;
    assert.match(diff, /collapsible/);
    assert.equal(res.job!.status === "preview" || res.job!.status === "failed", true);
    console.log(`EVIDENCE TEST A job=${res.job!.id} branch=${res.job!.branch} worktree=${wt} stable=${before} jobCommit=${res.job!.jobCommitSha} status=${res.job!.status}`);
  });

  it("TEST C/E — gates run in worktree; valid job can preview; stable still unchanged", async () => {
    const before = await stableSha(dir);
    const res = await createIsolatedJob(OWNER, {
      request: "valid comment",
      name: "valid1",
      files: [{ path: "src/components/Panel.ts", content: 'export const Panel = "ok";\n// collapsible hint\n' }],
    });
    assert.equal(res.ok, true);
    const g = res.job!.gates;
    assert.equal(g.typecheck?.command.includes("typecheck"), true);
    assert.equal(g.tests?.command.includes("test"), true);
    assert.equal(g.build?.command.includes("build"), true);
    assert.equal(typeof g.typecheck?.exitCode, "number");
    assert.equal(g.typecheck?.ok, true, g.typecheck?.stderr);
    assert.equal(g.tests?.ok, true, g.tests?.stderr);
    assert.equal(g.build?.ok, true, g.build?.stderr);
    assert.equal(res.job!.status, "preview");
    assert.ok(res.job!.previewUrl);
    assert.ok(existsSync(join(res.job!.worktree, "preview", "app", "index.html")));
    const appHtml = await readFile(join(res.job!.worktree, "preview", "app", "index.html"), "utf8");
    assert.match(appHtml, /data-mf-preview="app"/);
    assert.match(appHtml, /MINEFORGE/);
    assert.doesNotMatch(appHtml, /Isolated Application Edit preview/);
    const previewMeta = JSON.parse(await readFile(join(res.job!.worktree, "preview", "PREVIEW.json"), "utf8")) as {
      jobCommitSha: string;
      previewCommitSha: string;
      artifactDir: string;
      pid: number;
    };
    assert.equal(previewMeta.jobCommitSha, res.job!.jobCommitSha);
    assert.equal(previewMeta.previewCommitSha, res.job!.jobCommitSha);
    assert.equal(res.job!.previewCommitSha, res.job!.jobCommitSha);
    assert.ok(previewMeta.artifactDir);
    assert.equal(typeof previewMeta.pid, "number");
    const served = await handleAppEditHttp(new Request(`http://app.test/__preview/${res.job!.id}/`));
    assert.equal(served!.status, 200);
    assert.match(served!.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await served!.text(), /data-mf-preview="app"/);
    const metaRes = await handleAppEditHttp(new Request(`http://app.test/__preview/${res.job!.id}/PREVIEW.json`));
    assert.equal(metaRes!.status, 200);
    const metaBody = (await metaRes!.json()) as { jobCommitSha: string; previewCommitSha: string };
    assert.equal(metaBody.jobCommitSha, metaBody.previewCommitSha);
    assert.equal(await stableSha(dir), before);
    console.log(
      `EVIDENCE TEST C/E job=${res.job!.id} typecheck=${g.typecheck?.exitCode} tests=${g.tests?.exitCode} build=${g.build?.exitCode} preview=${res.job!.previewUrl} cmd_typecheck=${g.typecheck?.command} cmd_tests=${g.tests?.command} cmd_build=${g.build?.command}`,
    );
  });

  it("TEST D — compile failure blocks preview/promote; stable unchanged", async () => {
    const before = await stableSha(dir);
    const res = await createIsolatedJob(OWNER, {
      request: "broken",
      name: "broken1",
      files: [{ path: "src/components/Panel.ts", content: 'export const Panel: number = "nope";\n' }],
    });
    assert.equal(res.job!.status, "failed");
    assert.equal(res.job!.gates.typecheck?.ok, false);
    assert.ok((res.job!.gates.typecheck?.exitCode ?? 0) !== 0);
    assert.equal(res.job!.previewUrl, undefined);
    assert.equal(existsSync(join(res.job!.worktree, "preview", "app", "index.html")), false);
    const promo = await promoteJobHandler(OWNER, res.job!.id);
    assert.equal(promo.ok, false);
    assert.equal(await stableSha(dir), before);
    console.log(`EVIDENCE TEST D job=${res.job!.id} status=${res.job!.status} typecheck_exit=${res.job!.gates.typecheck?.exitCode} stable=${before}`);
  });

  it("TEST F — REJECT leaves stable SHA unchanged", async () => {
    const before = await stableSha(dir);
    const res = await createIsolatedJob(OWNER, {
      request: "reject me",
      name: "rej1",
      files: [{ path: "src/components/Panel.ts", content: 'export const Panel = "ok";\n' }],
    });
    const rej = await rejectJobHandler(OWNER, res.job!.id);
    assert.equal(rej.ok, true);
    assert.equal(await stableSha(dir), before);
    console.log(`EVIDENCE TEST F job=${res.job!.id} stable=${before} after_reject=${await stableSha(dir)}`);
  });

  it("TEST G/H — PROMOTE merges the previewed commit only", async () => {
    const before = await stableSha(dir);
    const res = await createIsolatedJob(OWNER, {
      request: "promote me",
      name: "pro1",
      files: [{ path: "src/components/Panel.ts", content: 'export const Panel = "promoted";\n' }],
    });
    assert.equal(
      res.job!.status,
      "preview",
      JSON.stringify({
        status: res.job!.status,
        err: res.job!.error,
        typecheck: res.job!.gates.typecheck,
        tests: res.job!.gates.tests,
        build: res.job!.gates.build,
      }).slice(0, 1800),
    );
    const previewed = res.job!.jobCommitSha!;
    const promo = await promoteJobHandler(OWNER, res.job!.id);
    assert.equal(promo.ok, true);
    const after = await stableSha(dir);
    assert.notEqual(after, before);
    assert.equal(after, previewed);
    assert.match(await readFile(join(dir, "src/components/Panel.ts"), "utf8"), /promoted/);
    console.log(`EVIDENCE TEST G/H before=${before} previewed=${previewed} after=${after} job=${res.job!.id}`);
  });

  it("TEST I — ROLLBACK returns previous confirmed stable", async () => {
    const log = JSON.parse(await readFile(join(dir, ".grok/jobs/promote-log.json"), "utf8")) as { previousSha: string };
    const rb = await rollbackStableHandler(OWNER, log.previousSha);
    assert.equal(rb.ok, true);
    assert.equal(await stableSha(dir), log.previousSha);
    assert.doesNotMatch(await readFile(join(dir, "src/components/Panel.ts"), "utf8"), /promoted/);
    console.log(`EVIDENCE TEST I rolled_back_to=${log.previousSha} now=${await stableSha(dir)}`);
  });

  it("TEST J — standard user HTTP job is 403", async () => {
    const cookie = signSession(USER, sessionSecret(BASE_ENV)!);
    const req = new Request("http://app.test/api/app-edit/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${PRIV_COOKIE}=${cookie}` },
      body: JSON.stringify({ request: "nope", files: [{ path: "src/components/Panel.ts", content: "x" }] }),
    });
    const res = await handleAppEditHttp(req);
    assert.equal(res!.status, 403);
  });
});
