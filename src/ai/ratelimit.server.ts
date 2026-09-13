/**
 * Process-local rate limiter. Fail-closed: any internal error denies the request.
 *
 * Valid ONLY on a single persistent process (workspace preview).
 * This Map is NOT production-wide protection across serverless instances.
 * Public Grok AI on multi-instance hosts is fail-closed unless a shared limiter exists
 * (none is implemented — see runtime-policy.server.ts).
 *
 * Client identity is taken only from a trusted source for the deployment
 * architecture. Attacker-controlled X-Forwarded-For first hops are never keys.
 */

import { isIP } from "node:net";
import { isVercelRuntime } from "./runtime-policy.server.ts";

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
