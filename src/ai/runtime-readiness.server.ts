import { probeSharedRateLimitOperational } from "./ratelimit.server.ts";
import { runtimeSnapshot } from "./privilege.server.ts";

/**
 * Runtime capability snapshot with an explicit durable-limiter readiness probe.
 * runtimeSnapshot remains synchronous and fail-closed; callers that advertise
 * server capability must go through this bootstrap path first.
 */
export async function runtimeSnapshotWithReadiness(
  input: { cookieHeader?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const env = input.env ?? process.env;
  await probeSharedRateLimitOperational(env);
  return runtimeSnapshot({ ...input, env });
}
