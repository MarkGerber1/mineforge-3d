/**
 * Process-local rate limiter. Fail-closed: any internal error denies the request.
 *
 * Valid ONLY on a single persistent process (workspace preview).
 * This Map is NOT production-wide protection across serverless instances.
 * Public Grok AI on multi-instance hosts is fail-closed unless a shared limiter exists
 * and has successfully initialized against its durable Postgres store.
 *
 * Client identity is taken only from a trusted source for the deployment
 * architecture. Attacker-controlled X-Forwarded-For first hops are never keys.
 */

import { isIP } from "node:net";
import { isVercelRuntime, rateLimitProtectionKind } from "./runtime-policy.server.ts";
import { createHash } from "node:crypto";

export interface LimitConfig {
  max: number;
  windowMs: number;
}

export const LIMITS = {
  grok: { max: 20, windowMs: 60_000 } satisfies LimitConfig,
  login: { max: 8, windowMs: 60_000 } satisfies LimitConfig,
  mutate: { max: 30, windowMs: 60_000 } satisfies LimitConfig,
};

export interface AllowResult {
  ok: boolean;
  remaining: number;
  retryAfter: number;
}

/** Trusted identity policy. Production must set RATE_LIMIT_TRUST explicitly. */
export type TrustMode = "cloudflare" | "vercel" | "test" | "local" | "auto";

export const UNKNOWN_IP = "unknown";
export const LOCAL_IP = "local";
const MAX_IP_CHARS = 45;
const MAX_KEY_CHARS = 96;

const buckets = new Map<string, number[]>();
let nowFn = () => Date.now();

export function setRateLimitNow(fn: () => number): void {
  nowFn = fn;
}

export function resetRateLimits(): void {
  buckets.clear();
}

export function allow(key: string, cfg: LimitConfig): AllowResult {
  try {
    if (!key || key.length > MAX_KEY_CHARS || cfg.max < 1 || cfg.windowMs < 1) {
      return { ok: false, remaining: 0, retryAfter: 60 };
    }
    const now = nowFn();
    const windowStart = now - cfg.windowMs;
    const prev = buckets.get(key) ?? [];
    const fresh = prev.filter((t) => t > windowStart);
    if (fresh.length >= cfg.max) {
      buckets.set(key, fresh);
      const oldest = fresh[0] ?? now;
      const retryAfter = Math.max(1, Math.ceil((oldest + cfg.windowMs - now) / 1000));
      return { ok: false, remaining: 0, retryAfter };
    }
    fresh.push(now);
    buckets.set(key, fresh);
    return { ok: true, remaining: Math.max(0, cfg.max - fresh.length), retryAfter: 0 };
  } catch {
    return { ok: false, remaining: 0, retryAfter: 60 };
  }
}

let sharedPool: import("pg").Pool | null = null;
let sharedPoolConnectionString = "";
let sharedReadyConnectionString = "";

function sharedKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function sharedConnectionString(env: NodeJS.ProcessEnv): string {
  return (env.RATE_LIMIT_DATABASE_URL ?? env.DATABASE_URL ?? "").trim();
}

async function ensureSharedPool(connectionString: string): Promise<import("pg").Pool> {
  if (!sharedPool || sharedPoolConnectionString !== connectionString) {
    if (sharedPool) await sharedPool.end().catch(() => undefined);
    const { Pool } = await import("pg");
    sharedPool = new Pool({ connectionString, max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 3_000 });
    sharedPoolConnectionString = connectionString;
    sharedReadyConnectionString = "";
  }
  if (sharedReadyConnectionString !== connectionString) {
    // Keep DDL separate from the parameterized quota mutation. node-postgres
    // uses the extended query protocol when parameters are supplied, where a
    // multi-statement prepared query is not valid.
    await sharedPool.query(`CREATE TABLE IF NOT EXISTS mf_rate_limit_buckets (
      bucket_key text PRIMARY KEY,
      window_started_at bigint NOT NULL,
      hit_count integer NOT NULL
    )`);
    await sharedPool.query("SELECT 1");
    sharedReadyConnectionString = connectionString;
  }
  return sharedPool;
}

/** Conservative runtime signal: true only after this process has reached the durable store successfully. */
export function sharedRateLimitOperational(env: NodeJS.ProcessEnv = process.env): boolean {
  const connectionString = sharedConnectionString(env);
  return (
    rateLimitProtectionKind(env) === "shared" &&
    connectionString.length > 0 &&
    sharedReadyConnectionString === connectionString
  );
}

/**
 * Durable multi-instance limiter. Database errors deny the request. The key is
 * hashed before persistence so attacker-controlled identity values are bounded
 * and never become unbounded database identifiers.
 */
export async function allowShared(
  key: string,
  cfg: LimitConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AllowResult> {
  let connectionString = "";
  try {
    if (!key || key.length > MAX_KEY_CHARS || cfg.max < 1 || cfg.windowMs < 1) {
      return { ok: false, remaining: 0, retryAfter: 60 };
    }
    if (rateLimitProtectionKind(env) !== "shared") return { ok: false, remaining: 0, retryAfter: 60 };
    connectionString = sharedConnectionString(env);
    if (!connectionString) return { ok: false, remaining: 0, retryAfter: 60 };
    const pool = await ensureSharedPool(connectionString);
    const now = Date.now();
    const res = await pool.query(
      `INSERT INTO mf_rate_limit_buckets(bucket_key, window_started_at, hit_count)
      VALUES ($1, $2, 1)
      ON CONFLICT (bucket_key) DO UPDATE SET
        window_started_at = CASE WHEN mf_rate_limit_buckets.window_started_at + $3 <= $2 THEN $2 ELSE mf_rate_limit_buckets.window_started_at END,
        hit_count = CASE
          WHEN mf_rate_limit_buckets.window_started_at + $3 <= $2 THEN 1
          WHEN mf_rate_limit_buckets.hit_count < $4 THEN mf_rate_limit_buckets.hit_count + 1
          ELSE $4 + 1
        END
      RETURNING window_started_at, hit_count;`,
      [sharedKey(key), now, cfg.windowMs, cfg.max],
    );
    const row = res.rows[0] as { window_started_at?: string | number; hit_count?: number } | undefined;
    if (!row || typeof row.hit_count !== "number") return { ok: false, remaining: 0, retryAfter: 60 };
    const start = Number(row.window_started_at);
    if (!Number.isFinite(start)) return { ok: false, remaining: 0, retryAfter: 60 };
    if (row.hit_count > cfg.max) {
      return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((start + cfg.windowMs - now) / 1000)) };
    }
    return { ok: true, remaining: Math.max(0, cfg.max - row.hit_count), retryAfter: 0 };
  } catch {
    if (connectionString && sharedPoolConnectionString === connectionString) {
      await resetSharedRateLimit();
    }
    return { ok: false, remaining: 0, retryAfter: 60 };
  }
}

export async function allowRequest(key: string, cfg: LimitConfig, env: NodeJS.ProcessEnv = process.env): Promise<AllowResult> {
  const protection = rateLimitProtectionKind(env);
  if (protection === "shared") return allowShared(key, cfg, env);
  if (protection === "none") return { ok: false, remaining: 0, retryAfter: 60 };
  return allow(key, cfg);
}

export async function resetSharedRateLimit(): Promise<void> {
  if (sharedPool) await sharedPool.end().catch(() => undefined);
  sharedPool = null;
  sharedPoolConnectionString = "";
  sharedReadyConnectionString = "";
}

export function rateLimitTrustMode(env: NodeJS.ProcessEnv = process.env): TrustMode {
  const v = (env.RATE_LIMIT_TRUST ?? "auto").trim().toLowerCase();
  if (v === "cloudflare" || v === "vercel" || v === "test" || v === "local" || v === "auto") return v;
  return "local";
}

function headerGet(headers: Headers | Record<string, string | undefined>, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const lower = name.toLowerCase();
  for (const [k, val] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return val;
  }
  return undefined;
}

/** Validated IPv4/IPv6 only. Bounded length. Rejects lists and junk. */
export function validClientIp(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "string") return undefined;
  if (raw.length > MAX_IP_CHARS) return undefined;
  const s = raw.trim();
  if (!s || s.length > MAX_IP_CHARS) return undefined;
  if (/[,\s\r\n]/.test(s)) return undefined;
  return isIP(s) ? s : undefined;
}

function resolveTrust(mode: TrustMode, env: NodeJS.ProcessEnv = process.env): TrustMode {
  if (mode === "auto") {
    // Presence of CF-RAY / CF-Connecting-IP is spoofable when the process is
    // not actually behind Cloudflare. Auto therefore does not trust CF headers.
    // Vercel sets VERCEL=1 on the real platform — that is not a client header.
    if (isVercelRuntime(env)) return "vercel";
    return "local";
  }
  return mode;
}

/**
 * Trusted client identity for Grok, login, and App Edit mutation.
 *
 * cloudflare: CF-Connecting-IP only (validated). X-Forwarded-For / X-Real-IP ignored.
 * vercel: x-real-ip or x-vercel-forwarded-for. First XFF hop ignored.
 * test: x-mf-test-ip only (isolation tests).
 * local: ignore all client-supplied proxy headers → "local".
 * auto: VERCEL=1 → vercel identity; otherwise local. Never trusts spoofable CF headers.
 * Missing/invalid identity → bounded "unknown" bucket (fail-safe, not attacker-defined).
 */
export function clientIpFromHeaders(
  headers: Headers | Record<string, string | undefined> | undefined,
  mode?: TrustMode,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trust = resolveTrust(mode ?? rateLimitTrustMode(env), env);
  if (!headers) {
    return trust === "local" ? LOCAL_IP : UNKNOWN_IP;
  }
  if (trust === "cloudflare") {
    return validClientIp(headerGet(headers, "cf-connecting-ip")) ?? UNKNOWN_IP;
  }
  if (trust === "vercel") {
    return (
      validClientIp(headerGet(headers, "x-real-ip")) ??
      validClientIp(headerGet(headers, "x-vercel-forwarded-for")) ??
      UNKNOWN_IP
    );
  }
  if (trust === "test") {
    return validClientIp(headerGet(headers, "x-mf-test-ip")) ?? UNKNOWN_IP;
  }
  return LOCAL_IP;
}

export async function clientIpFromRequest(): Promise<string> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    return clientIpFromHeaders(req?.headers);
  } catch {
    return rateLimitTrustMode() === "local" || rateLimitTrustMode() === "auto" ? LOCAL_IP : UNKNOWN_IP;
  }
}
