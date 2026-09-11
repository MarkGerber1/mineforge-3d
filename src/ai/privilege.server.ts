import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";

export type ActorRole = "anonymous" | "user" | "owner";

export interface Actor {
  sub: string;
  role: ActorRole;
}

export type GateOk = { ok: true; actor: Actor };
export type GateDenied = { ok: false; status: 401 | 403; error: string; actor: Actor; code: string };
export type GateResult = GateOk | GateDenied;

export const PRIV_COOKIE = "mf_priv";
const ANON: Actor = { sub: "anonymous", role: "anonymous" };

const PUBLIC_401 = "Unauthorized";
const PUBLIC_403 = "Forbidden";

export function isAppEditEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.APP_EDIT_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "on";
}

export function sessionSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const direct = env.APP_EDIT_SESSION_SECRET?.trim();
  if (direct) return direct;
  const owner = env.APP_EDIT_OWNER_SECRET?.trim();
  if (owner) return `mf-session:${owner}`;
  return undefined;
}

function sha256(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

function secretEqual(provided: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = sha256(provided);
  const b = sha256(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function ownerSecretMatches(passphrase: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return secretEqual(passphrase, env.APP_EDIT_OWNER_SECRET?.trim());
}

export function userSecretMatches(passphrase: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return secretEqual(passphrase, env.APP_EDIT_USER_SECRET?.trim());
}

export function signSession(
  actor: { sub: string; role: "owner" | "user" },
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
  ttlSec = 8 * 3600,
): string {
  const payload = Buffer.from(
    JSON.stringify({ v: 1, sub: actor.sub, role: actor.role, iat: nowSec, exp: nowSec + ttlSec }),
    "utf8",
  );
  const sig = createHmac("sha256", secret).update(payload).digest();
  return `v1.${payload.toString("base64url")}.${sig.toString("base64url")}`;
}

export function verifySession(token: string | undefined, secret: string | undefined): Actor | null {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  let payload: Buffer;
  let sig: Buffer;
  try {
    payload = Buffer.from(parts[1], "base64url");
    sig = Buffer.from(parts[2], "base64url");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", secret).update(payload).digest();
  if (expected.length !== sig.length || !timingSafeEqual(expected, sig)) return null;
  try {
    const json = JSON.parse(payload.toString("utf8")) as { v?: number; sub?: string; role?: string; exp?: number };
    if (json.v !== 1) return null;
    if (typeof json.exp === "number" && json.exp < Math.floor(Date.now() / 1000)) return null;
    if (json.role !== "owner" && json.role !== "user") return null;
    if (!json.sub || typeof json.sub !== "string") return null;
    return { sub: json.sub, role: json.role };
  } catch {
    return null;
  }
}

export function parseCookieHeader(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/**
 * Deny-by-default authorization for privileged repository mutation.
 * Client-supplied role / userId / isOwner / isAdmin / permission / headers are ignored.
 */
export function authorizeMutation(
  action: string,
  input: {
    cookie?: string;
    cookieHeader?: string;
    body?: unknown;
    headers?: Record<string, string | undefined>;
    env?: NodeJS.ProcessEnv;
  } = {},
): GateResult {
  void action;
  const env = input.env ?? process.env;
  const body = input.body && typeof input.body === "object" ? (input.body as Record<string, unknown>) : {};
  void body.role;
  void body.userId;
  void body.isOwner;
  void body.isAdmin;
  void body.permission;
  void input.headers;

  if (!isAppEditEnabled(env)) {
    return { ok: false, status: 403, error: PUBLIC_403, actor: ANON, code: "APP_EDIT_DISABLED" };
  }

  const secret = sessionSecret(env);
  const token =
    input.cookie ??
    parseCookieHeader(input.cookieHeader, PRIV_COOKIE) ??
    parseCookieHeader(input.headers?.cookie, PRIV_COOKIE) ??
    parseCookieHeader(input.headers?.Cookie, PRIV_COOKIE);

  const session = verifySession(token, secret);
  if (!session) {
    return { ok: false, status: 401, error: PUBLIC_401, actor: ANON, code: "UNAUTHENTICATED" };
  }
  if (session.role !== "owner") {
    return { ok: false, status: 403, error: PUBLIC_403, actor: session, code: "NOT_OWNER" };
  }
  return { ok: true, actor: session };
}

export function deployedIdentity(env: NodeJS.ProcessEnv = process.env): { sha: string; buildId: string } {
  const fromEnv = (env.MF_DEPLOY_SHA || env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || "").trim();
  const sha = /^[0-9a-f]{7,64}$/i.test(fromEnv)
    ? fromEnv.slice(0, 64)
    : gitHead();
  const buildId = (env.MF_BUILD_ID || env.VERCEL_DEPLOYMENT_ID || sha || "unknown").trim().slice(0, 80);
  return { sha: sha || "unknown", buildId: buildId || "unknown" };
}

function gitHead(): string {
  try {
    const r = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 2000 });
    const s = (r.stdout || "").trim();
    return /^[0-9a-f]{7,64}$/i.test(s) ? s.slice(0, 64) : "";
  } catch {
    return "";
  }
}

export function runtimeSnapshot(
  input: { cookieHeader?: string; env?: NodeJS.ProcessEnv } = {},
): {
  mode: "server";
  ai: boolean;
  available: boolean;
  appEditEnabled: boolean;
  role: ActorRole;
  sha: string;
  buildId: string;
} {
  const env = input.env ?? process.env;
  const enabled = isAppEditEnabled(env);
  const session = verifySession(parseCookieHeader(input.cookieHeader, PRIV_COOKIE), sessionSecret(env));
  const ai = Boolean(env.XAI_API_KEY);
  const id = deployedIdentity(env);
  return {
    mode: "server",
    ai,
    available: ai,
    appEditEnabled: enabled,
    role: session?.role ?? "anonymous",
    sha: id.sha,
    buildId: id.buildId,
  };
}

export async function readRequestCookie(): Promise<string | undefined> {
  try {
    const { getCookie } = await import("@tanstack/react-start/server");
    return getCookie(PRIV_COOKIE) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function readRequestCookieHeader(): Promise<string | undefined> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    return req?.headers.get("cookie") ?? undefined;
  } catch {
    return undefined;
  }
}

export async function requireOwner(
  action: string,
  opts?: { cookieHeader?: string; cookie?: string; body?: unknown },
): Promise<GateResult> {
  const cookieHeader = opts?.cookieHeader ?? (await readRequestCookieHeader());
  const cookie = opts?.cookie ?? (await readRequestCookie());
  return authorizeMutation(action, { cookieHeader, cookie, body: opts?.body });
}

export function loginWithPassphrase(
  passphrase: string,
  env: NodeJS.ProcessEnv = process.env,
): GateResult & { token?: string } {
  if (!isAppEditEnabled(env)) {
    return { ok: false, status: 403, error: PUBLIC_403, actor: ANON, code: "APP_EDIT_DISABLED" };
  }
  const secret = sessionSecret(env);
  if (!secret) {
    return { ok: false, status: 401, error: PUBLIC_401, actor: ANON, code: "UNAUTHENTICATED" };
  }
  if (ownerSecretMatches(passphrase, env)) {
    const actor = { sub: "owner", role: "owner" as const };
    return { ok: true, actor, token: signSession(actor, secret) };
  }
  if (userSecretMatches(passphrase, env)) {
    const actor = { sub: "user", role: "user" as const };
    return { ok: true, actor, token: signSession(actor, secret) };
  }
  return { ok: false, status: 401, error: PUBLIC_401, actor: ANON, code: "UNAUTHENTICATED" };
}

export function cookieSetHeader(token: string, secure: boolean): string {
  const parts = [
    `${PRIV_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=28800",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function cookieClearHeader(secure: boolean): string {
  const parts = [`${PRIV_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
