#!/usr/bin/env node
/**
 * Fail if server secrets appear in browser-reachable files.
 * Looks at built client assets when present, plus client source.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const secretEnvKeys = [
  "XAI_API_KEY",
  "APP_EDIT_OWNER_SECRET",
  "APP_EDIT_USER_SECRET",
  "APP_EDIT_SESSION_SECRET",
  "GROK_SERVER_KEY",
  "GH_TOKEN",
  "GITHUB_TOKEN",
];

const forbiddenValues = [];
for (const k of secretEnvKeys) {
  const v = process.env[k]?.trim();
  if (v && v.length >= 8) forbiddenValues.push(v);
}

const patterns = [/ghu_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /xai-[A-Za-z0-9]{20,}/];

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(js|css|html|map|tsx|ts|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

const files = [
  ...walk(join(root, ".vercel/output/static")),
  ...walk(join(root, "src/components")),
  join(root, "src/ai/runtime-client.ts"),
  join(root, "src/ai/appedit.ts"),
  join(root, "src/ai/grok.ts"),
].filter((p) => existsSync(p));

let failed = false;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const rel = file.slice(root.length + 1);
  const isClient = rel.startsWith("src/components/") || rel.includes(".vercel/output/static") || rel.endsWith("runtime-client.ts");
  for (const val of forbiddenValues) {
    if (text.includes(val)) {
      console.error(`[secrets] value of a server secret found in ${rel}`);
      failed = true;
    }
  }
  for (const re of patterns) {
    if (re.test(text)) {
      console.error(`[secrets] credential pattern ${re} in ${rel}`);
      failed = true;
    }
  }
  if (isClient && /APP_EDIT_OWNER_SECRET\s*[:=]/.test(text) && text.includes("process.env") === false) {
    console.error(`[secrets] owner secret assignment in client file ${rel}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log(`[secrets] scanned ${files.length} files; no secret values in client surfaces`);
console.log(`CANDIDATE_SHA=${process.env.GITHUB_SHA || "local"}`);
