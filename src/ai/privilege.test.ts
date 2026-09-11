import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, before, after } from "node:test";
import {
  authorizeMutation,
  isAppEditEnabled,
  loginWithPassphrase,
  signSession,
  sessionSecret,
  PRIV_COOKIE,
} from "./privilege.server.ts";
import { handleAppEditHttp } from "./http.server.ts";

const exec = promisify(execFile);

const BASE = {
  APP_EDIT_ENABLED: "true",
  APP_EDIT_OWNER_SECRET: "owner-secret-test",
  APP_EDIT_USER_SECRET: "user-secret-test",
  APP_EDIT_SESSION_SECRET: "session-secret-test",
};

function env(over: Record<string, string> = {}) {
  return { ...process.env, ...BASE, ...over };
}

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), "mf-auth-"));
  await exec("git", ["init", "-b", "main"], { cwd: dir });
  await exec("git", ["config", "user.email", "t@t.test"], { cwd: dir });
  await exec("git", ["config", "user.name", "t"], { cwd: dir });
  await mkdir(join(dir, "src/components"), { recursive: true });
  await writeFile(join(dir, "src/components/Panel.tsx"), "export const Panel = () => null;\n");
  await writeFile(join(dir, "README"), "x\n");
  await exec("git", ["add", "-A"], { cwd: dir });
  await exec("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

async function sha(dir: string) {
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: dir });
  return stdout.trim();
}

async function branches(dir: string) {
  const { stdout } = await exec("git", ["branch"], { cwd: dir });
  return stdout;
}

describe("AC flag deny-by-default", () => {
  it("unset flag is disabled", () => {
    assert.equal(isAppEditEnabled({}), false);
    assert.equal(isAppEditEnabled({ APP_EDIT_ENABLED: "false" }), false);
  });
  it("true enables", () => {
    assert.equal(isAppEditEnabled({ APP_EDIT_ENABLED: "true" }), true);
  });
});

describe("AC-1..AC-8 authorizeMutation", { concurrency: 1 }, () => {
  it("AC-1 anonymous is 401", () => {
    const g = authorizeMutation("create_edit_branch", { env: env() });
    assert.equal(g.ok, false);
    if (!g.ok) assert.equal(g.status, 401);
  });
  it("AC-5 standard user is 403", () => {
    const secret = sessionSecret(env())!;
    const cookie = signSession({ sub: "user", role: "user" }, secret);
    const g = authorizeMutation("write_source", { cookie, env: env() });
    assert.equal(g.ok, false);
    if (!g.ok) assert.equal(g.status, 403);
  });
  it("AC-6 owner is ok", () => {
    const secret = sessionSecret(env())!;
    const cookie = signSession({ sub: "owner", role: "owner" }, secret);
    const g = authorizeMutation("commit", { cookie, env: env() });
    assert.equal(g.ok, true);
  });
  it("AC-7 spoofed body role=owner is ignored", () => {
    const g = authorizeMutation("create_edit_branch", {
      env: env(),
      body: { role: "owner", isOwner: true, isAdmin: true, userId: "owner", permission: "all" },
      headers: { "x-role": "owner" },
    });
    assert.equal(g.ok, false);
    if (!g.ok) assert.equal(g.status, 401);
  });
  it("AC-8 flag off blocks even owner", () => {
    const e = env({ APP_EDIT_ENABLED: "false" });
    const secret = sessionSecret(e)!;
    const cookie = signSession({ sub: "owner", role: "owner" }, secret);
    const g = authorizeMutation("rollback_stable", { cookie, env: e });
    assert.equal(g.ok, false);
    if (!g.ok) assert.equal(g.status, 403);
  });
});

describe("HTTP privileged endpoints", { concurrency: 1 }, () => {
  let dir = "";
  let prevRoot = "";
  let prevEnv: Record<string, string | undefined> = {};

  before(async () => {
    dir = await makeRepo();
    prevRoot = process.env.APP_EDIT_ROOT ?? "";
    prevEnv = {
      APP_EDIT_ENABLED: process.env.APP_EDIT_ENABLED,
      APP_EDIT_OWNER_SECRET: process.env.APP_EDIT_OWNER_SECRET,
      APP_EDIT_USER_SECRET: process.env.APP_EDIT_USER_SECRET,
      APP_EDIT_SESSION_SECRET: process.env.APP_EDIT_SESSION_SECRET,
    };
    process.env.APP_EDIT_ROOT = dir;
    Object.assign(process.env, BASE);
  });
  after(() => {
    if (prevRoot) process.env.APP_EDIT_ROOT = prevRoot;
    else delete process.env.APP_EDIT_ROOT;
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  async function post(path: string, body: unknown, cookie?: string) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cookie) headers.cookie = `${PRIV_COOKIE}=${cookie}`;
    const req = new Request(`http://app.test${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    return handleAppEditHttp(req);
  }

  it("AC-1 anonymous create-branch 401, no branch", async () => {
    const beforeSha = await sha(dir);
    const beforeBr = await branches(dir);
    const res = await post("/api/app-edit/create-branch", { name: "anon-branch" });
    assert.ok(res);
    assert.equal(res!.status, 401);
    const body = (await res!.json()) as { ok: boolean };
    assert.equal(body.ok, false);
    assert.equal(await sha(dir), beforeSha);
    assert.equal(await branches(dir), beforeBr);
  });

  it("AC-2 anonymous write 401, file unchanged", async () => {
    const before = await readFile(join(dir, "src/components/Panel.tsx"), "utf8");
    const res = await post("/api/app-edit/write", {
      files: [{ path: "src/components/Panel.tsx", content: "HACKED" }],
      message: "hack",
      branch: "x",
    });
    assert.equal(res!.status, 401);
    assert.equal(await readFile(join(dir, "src/components/Panel.tsx"), "utf8"), before);
  });

  it("AC-3 anonymous commit 401", async () => {
    const beforeSha = await sha(dir);
    const res = await post("/api/app-edit/commit", {
      files: [{ path: "src/components/Panel.tsx", content: "HACKED" }],
      message: "commit",
    });
    assert.equal(res!.status, 401);
    assert.equal(await sha(dir), beforeSha);
  });

  it("AC-4 anonymous rollback 401, HEAD unchanged", async () => {
    const beforeSha = await sha(dir);
    const res = await post("/api/app-edit/rollback", { ref: "HEAD~1" });
    assert.equal(res!.status, 401);
    assert.equal(await sha(dir), beforeSha);
  });

  it("AC-5 standard user 403", async () => {
    const cookie = signSession({ sub: "user", role: "user" }, sessionSecret(env())!);
    const beforeSha = await sha(dir);
    const res = await post("/api/app-edit/create-branch", { name: "user-branch" }, cookie);
    assert.equal(res!.status, 403);
    assert.equal(await sha(dir), beforeSha);
    assert.equal((await branches(dir)).includes("user-branch"), false);
  });

  it("AC-7 spoof role=owner without cookie 401", async () => {
    const res = await post("/api/app-edit/create-branch", { name: "spoof", role: "owner", isOwner: true, isAdmin: true });
    assert.equal(res!.status, 401);
  });

  it("AC-8 flag off blocks owner", async () => {
    process.env.APP_EDIT_ENABLED = "false";
    const cookie = signSession({ sub: "owner", role: "owner" }, sessionSecret(env())!);
    const res = await post("/api/app-edit/write", { files: [], message: "x", branch: "x" }, cookie);
    process.env.APP_EDIT_ENABLED = "true";
    assert.equal(res!.status, 403);
  });

  it("server-function smoke: GET /api/runtime JSON", async () => {
    const res = await handleAppEditHttp(new Request("http://app.test/api/runtime"));
    assert.ok(res);
    assert.equal(res!.status, 200);
    assert.match(res!.headers.get("content-type") ?? "", /application\/json/);
    const body = (await res!.json()) as { mode: string; sha?: string; buildId?: string };
    assert.equal(body.mode, "server");
    assert.equal(typeof body.sha, "string");
    assert.ok((body.sha ?? "").length > 0);
    assert.equal(typeof body.buildId, "string");
  });

  it("AC-6 owner login + mutation path is authorized (login ignores client role claim)", async () => {
    const gate = loginWithPassphrase("owner-secret-test", env());
    assert.equal(gate.ok, true);
    const spoof = loginWithPassphrase("wrong", env());
    assert.equal(spoof.ok, false);
    const user = loginWithPassphrase("user-secret-test", env());
    assert.equal(user.ok, true);
    if (user.ok) assert.equal(user.actor.role, "user");
  });

  it("AC-6 owner HTTP job creates isolated branch; stable SHA unchanged", async () => {
    const cookie = signSession({ sub: "owner", role: "owner" }, sessionSecret(env())!);
    const beforeSha = await sha(dir);
    const res = await post(
      "/api/app-edit/jobs",
      {
        name: "ac6http",
        request: "owner mutation",
        files: [{ path: "src/components/Panel.tsx", content: "export const Panel = () => null;\n// owner-ok\n" }],
      },
      cookie,
    );
    assert.equal(res!.status, 200);
    const body = (await res!.json()) as { ok: boolean; job?: { id: string; branch: string; status: string; worktree: string } };
    assert.equal(body.ok, true);
    assert.ok(body.job);
    assert.equal(body.job!.id, "ac6http");
    assert.equal(body.job!.branch, "ai-edit/ac6http");
    assert.equal(await sha(dir), beforeSha);
    assert.match(await branches(dir), /ai-edit\/ac6http/);
    const stableFile = await readFile(join(dir, "src/components/Panel.tsx"), "utf8");
    assert.equal(stableFile.includes("owner-ok"), false);
  });
});
