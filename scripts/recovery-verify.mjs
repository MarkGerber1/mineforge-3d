#!/usr/bin/env node
/**
 * Lightweight recovery verification. No production secret VALUES required.
 * Playwright WebKit / full CI gate stay in `npm run test:gate`.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const fail = [];
const ok = [];

function check(name, cond, detail = "") {
  if (cond) ok.push(name);
  else fail.push(detail ? `${name}: ${detail}` : name);
}

const requiredFiles = [
  "README.md",
  "RECOVERY.md",
  "PROJECT_STATE.md",
  "ARCHITECTURE.md",
  "AI_HANDOFF.md",
  "project-handoff.json",
  ".env.example",
  "package.json",
  "package-lock.json",
  "docs/DEVLOG.md",
  "docs/VERIFICATION.md",
  "docs/BATCH4.md",
  "scripts/ci-gate.sh",
  "scripts/recovery-verify.mjs",
  ".github/workflows/batch1-gate.yml",
  "src/engineering/pipeline.ts",
  "src/engineering/reality.ts",
  "src/reality/video.ts",
  "src/project/store.ts",
  "src/components/cad/Cad2D.tsx",
  "src/components/twin/Twin3D.tsx",
  "src/ai/grok-engine.server.ts",
  "src/ai/privilege.server.ts",
  "tests/fixtures/video/frames-rgb.webm",
  "tests/fixtures/video/corrupt.mp4",
];

for (const rel of requiredFiles) {
  check(`file ${rel}`, existsSync(join(root, rel)), "missing");
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const requiredScripts = [
  "dev",
  "build",
  "typecheck",
  "test",
  "test:oracle",
  "test:security",
  "test:isolation",
  "test:mobile",
  "test:gate",
  "scan:secrets",
  "recovery:verify",
];
for (const s of requiredScripts) {
  check(`script ${s}`, typeof pkg.scripts?.[s] === "string");
}
check("engines.node", typeof pkg.engines?.node === "string");
check("lockfile", existsSync(join(root, "package-lock.json")));

const envExample = readFileSync(join(root, ".env.example"), "utf8");
const documented = new Set(
  [...envExample.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]),
);
const requiredEnvNames = [
  "XAI_API_KEY",
  "APP_EDIT_ENABLED",
  "APP_EDIT_OWNER_SECRET",
  "APP_EDIT_USER_SECRET",
  "APP_EDIT_SESSION_SECRET",
  "APP_EDIT_ROOT",
  "RATE_LIMIT_TRUST",
  "MF_DEPLOY_SHA",
  "VITE_AUTH_ENABLED",
  "DATABASE_URL",
  "PLAYWRIGHT_BASE_URL",
  "WEBKIT_GST_DMABUF_SINK_DISABLED",
  "CLOUDFLARE_TUNNEL_TOKEN",
];
for (const k of requiredEnvNames) {
  check(`env name ${k}`, documented.has(k), "not in .env.example");
}

let handoff;
try {
  handoff = JSON.parse(readFileSync(join(root, "project-handoff.json"), "utf8"));
  check("handoff.project", handoff.project === "MINEFORGE 3D");
  check("handoff.repository", typeof handoff.repository === "string");
  check("handoff.acceptedFunctionalBaselineSha", typeof handoff.acceptedFunctionalBaselineSha === "string");
  check("handoff.requiredStatusCheck", handoff.requiredStatusCheck === "gate");
  check("handoff.envVarNames", Array.isArray(handoff.envVarNames) && handoff.envVarNames.includes("XAI_API_KEY"));
  check("handoff.no secrets field", !("XAI_API_KEY_VALUE" in handoff) && !("secrets" in handoff));
} catch (e) {
  check("handoff JSON", false, e instanceof Error ? e.message : String(e));
}

const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
check("gitignore keeps .env out", /^\.env$/m.test(gitignore) || gitignore.includes("\n.env\n"));
check("gitignore allows .env.example", gitignore.includes("!.env.example"));

const secretEnvKeys = [
  "XAI_API_KEY",
  "APP_EDIT_OWNER_SECRET",
  "APP_EDIT_USER_SECRET",
  "APP_EDIT_SESSION_SECRET",
  "CLOUDFLARE_TUNNEL_TOKEN",
];
for (const line of envExample.split("\n")) {
  if (line.startsWith("#") || !line.includes("=")) continue;
  const eq = line.indexOf("=");
  const k = line.slice(0, eq).trim();
  const v = line.slice(eq + 1).trim();
  if (secretEnvKeys.includes(k) && v.length > 0) {
    fail.push(`env example ${k} must have empty placeholder (no secret value)`);
  } else if (secretEnvKeys.includes(k)) {
    ok.push(`env example ${k} empty`);
  }
  if (/^(xai-|ghu_|github_pat_|sk-)/i.test(v)) {
    fail.push(`env example ${k} looks like a live credential prefix`);
  }
}

const devlog = readFileSync(join(root, "docs/DEVLOG.md"), "utf8");
check("DEVLOG batch 1 history", /REPAIR BATCH 1/.test(devlog));
check("DEVLOG batch 4 history", /REPAIR BATCH 4/.test(devlog));
check("DEVLOG continuity section", /CONTINUITY \/ RECOVERY PACKAGE/.test(devlog));

check(
  "handoff.acceptedFunctionalBaselineSha format",
  /^[0-9a-f]{40}$/.test(handoff?.acceptedFunctionalBaselineSha || ""),
);

const misleadingLiveKeys = ["currentCandidateSha", "currentMainSha", "latestSha", "currentSha"];
for (const k of misleadingLiveKeys) {
  check(`handoff has no static live HEAD field ${k}`, !handoff || !(k in handoff));
}
check("handoff.authoritativeBranch", handoff?.authoritativeBranch === "main");
check(
  "handoff.currentStateResolution.source is git",
  handoff?.currentStateResolution?.source === "git",
);
check(
  "handoff.currentStateResolution.commands include fetch + rev-parse origin/main",
  Array.isArray(handoff?.currentStateResolution?.commands) &&
    handoff.currentStateResolution.commands.includes("git fetch origin") &&
    handoff.currentStateResolution.commands.includes("git rev-parse origin/main"),
);

function gitOk(args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" });
}

const gitDir = gitOk(["rev-parse", "--git-dir"]);
if (gitDir.status !== 0) {
  fail.push("git metadata unavailable: cannot verify repository identity (HEAD vs accepted baseline)");
} else {
  const baseline = handoff?.acceptedFunctionalBaselineSha || "";
  let exists = gitOk(["cat-file", "-e", `${baseline}^{commit}`]);
  if (exists.status !== 0) {
    gitOk(["fetch", "--depth", "1", "origin", baseline]);
    exists = gitOk(["cat-file", "-e", `${baseline}^{commit}`]);
  }
  if (exists.status !== 0) {
    gitOk(["fetch", "--deepen", "200", "origin"]);
    exists = gitOk(["cat-file", "-e", `${baseline}^{commit}`]);
  }
  check("accepted baseline commit exists in local git", exists.status === 0, baseline);
  const anc = gitOk(["merge-base", "--is-ancestor", baseline, "HEAD"]);
  check(
    "HEAD is the accepted baseline or a descendant of it",
    anc.status === 0,
    anc.status === 0 ? "" : (anc.stderr || "git merge-base --is-ancestor failed").trim(),
  );
}

function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", env: process.env, maxBuffer: 20 * 1024 * 1024 });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  if (r.status === 0) {
    ok.push(label);
    return;
  }
  fail.push(`${label} exit ${r.status}\n${out.slice(-1200)}`);
}

if (!process.env.RECOVERY_VERIFY_SKIP_TESTS) {
  run("typecheck", "npm", ["run", "typecheck"]);
  run("test:oracle", "npm", ["run", "test:oracle"]);
  run("test:security", "npm", ["run", "test:security"]);
  run("scan:secrets", "npm", ["run", "scan:secrets"]);
}

if (process.env.RECOVERY_VERIFY_BUILD === "1") {
  run("build", "npm", ["run", "build"]);
}

console.log(`RECOVERY VERIFY ok=${ok.length} fail=${fail.length}`);
for (const x of ok) console.log(`  PASS  ${x}`);
for (const x of fail) console.log(`  FAIL  ${x}`);
if (fail.length) {
  process.exit(1);
}
console.log("RECOVERY VERIFY PASS");
console.log("Playwright WebKit / full gate: npm run test:gate (not part of recovery:verify).");
