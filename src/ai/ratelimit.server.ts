/**
 * Process-local rate limiter. Fail-closed: any internal error denies the request.
 * Single-instance preview: in-memory buckets. Multi-instance production needs a shared store.
 */

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
    if (!key || cfg.max < 1 || cfg.windowMs < 1) {
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

export function clientIpFromHeaders(headers: Headers | Record<string, string | undefined> | undefined): string {
  if (!headers) return "local";
  const get = (name: string) => {
    if (headers instanceof Headers) return headers.get(name) ?? undefined;
    return headers[name] ?? headers[name.toLowerCase()];
  };
  const fwd = get("x-forwarded-for") ?? get("X-Forwarded-For");
  if (fwd) return fwd.split(",")[0]!.trim() || "local";
  return get("x-real-ip") ?? get("X-Real-Ip") ?? "local";
}

export async function clientIpFromRequest(): Promise<string> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    return clientIpFromHeaders(req?.headers);
  } catch {
    return "local";
  }
}
