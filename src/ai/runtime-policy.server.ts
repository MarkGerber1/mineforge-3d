/**
 * Deterministic production-capability policy.
 *
 * One predicate for known serverless hosts; one formula for public AI:
 *   runtime type + XAI key + rate-limit protection = AI capability.
 *
 * Process-local Map limiter is valid only on a single persistent process.
 * There is no shared durable limiter in this tree — do not advertise one.
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

/**
 * What abuse/cost protection actually exists.
 * Never returns "shared" — no durable multi-instance store is implemented.
 */
export function rateLimitProtectionKind(env: NodeJS.ProcessEnv = process.env): RateLimitProtection {
  if (isServerlessProduction(env)) return "none";
  const explicit = (env.PRODUCTION_INSTANCE_MODEL ?? "").trim().toLowerCase();
  if (explicit === "multi-instance") return "none";
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
