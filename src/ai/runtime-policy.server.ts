/**
 * Deterministic production-capability policy.
 *
 * One predicate for known serverless hosts; one formula for public AI:
 *   runtime type + XAI key + rate-limit protection = AI capability.
 *
 * Process-local Map limiter is valid only on a single persistent process.
 * Multi-instance production requires an explicitly configured durable store.
 */

export type RateLimitProtection = "local-process" | "shared" | "none";

export function isVercelRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.VERCEL ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** grok.me / Vercel / Grok Build publish. Isolated git worktrees are not available. */
export function isServerlessProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.GROK_PROJECT_ID ?? "").trim()) return true;
  return isVercelRuntime(env);
}

/** Shared limiter is opt-in only when the deployment names a Postgres store. */
export function sharedRateLimitConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const backend = (env.RATE_LIMIT_BACKEND ?? "").trim().toLowerCase();
  const url = (env.RATE_LIMIT_DATABASE_URL ?? env.DATABASE_URL ?? "").trim();
  return backend === "postgres" && url.length > 0;
}

export function rateLimitProtectionKind(env: NodeJS.ProcessEnv = process.env): RateLimitProtection {
  if (isServerlessProduction(env)) return sharedRateLimitConfigured(env) ? "shared" : "none";
  const explicit = (env.PRODUCTION_INSTANCE_MODEL ?? "").trim().toLowerCase();
  if (explicit === "multi-instance") return sharedRateLimitConfigured(env) ? "shared" : "none";
  return "local-process";
}

/**
 * Public Grok AI may run only when a real key is present AND the limiter
 * architecture matches the runtime. Multi-instance + local Map ⇒ unavailable.
 */
export function publicAiAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!(env.XAI_API_KEY ?? "").trim()) return false;
  const protection = rateLimitProtectionKind(env);
  return protection === "local-process" || protection === "shared";
}
