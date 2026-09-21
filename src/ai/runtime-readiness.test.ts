import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  resetSharedRateLimit,
  setSharedRateLimitPoolFactoryForTests,
  sharedRateLimitOperational,
} from "./ratelimit.server.ts";
import { runtimeSnapshotWithReadiness } from "./runtime-readiness.server.ts";

const SHARED_ENV = {
  VERCEL: "1",
  XAI_API_KEY: "test-not-a-real-key",
  RATE_LIMIT_BACKEND: "postgres",
  RATE_LIMIT_DATABASE_URL: "postgres://test.invalid/mineforge",
};

function installFakeSharedStore(opts: { failProbe?: boolean } = {}) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  setSharedRateLimitPoolFactoryForTests(async () => ({
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      if (opts.failProbe && /SELECT 1|CREATE TABLE/i.test(text)) throw new Error("db unavailable");
      return { rows: [] };
    },
    async end() {},
  }));
  return queries;
}

describe("AI shared-limiter runtime bootstrap", () => {
  beforeEach(async () => {
    await resetSharedRateLimit();
  });

  afterEach(async () => {
    await resetSharedRateLimit();
    setSharedRateLimitPoolFactoryForTests();
  });

  it("AI-BOOT-01 cold shared runtime probes DB before advertising the snapshot", async () => {
    const queries = installFakeSharedStore();
    assert.equal(sharedRateLimitOperational(SHARED_ENV), false);
    const snap = await runtimeSnapshotWithReadiness({ env: SHARED_ENV });
    assert.equal(queries.some((q) => /CREATE TABLE IF NOT EXISTS mf_rate_limit_buckets/i.test(q.text)), true);
    assert.equal(queries.some((q) => /SELECT 1/i.test(q.text)), true);
    assert.equal(sharedRateLimitOperational(SHARED_ENV), true);
    assert.equal(snap.rateLimitProtection, "shared");
  });

  it("AI-BOOT-02 successful readiness probe advertises shared AI available", async () => {
    installFakeSharedStore();
    const snap = await runtimeSnapshotWithReadiness({ env: SHARED_ENV });
    assert.equal(snap.rateLimitProtection, "shared");
    assert.equal(snap.ai, true);
    assert.equal(snap.available, true);
  });

  it("AI-BOOT-03 failed DB probe remains fail-closed", async () => {
    installFakeSharedStore({ failProbe: true });
    const snap = await runtimeSnapshotWithReadiness({ env: SHARED_ENV });
    assert.equal(snap.rateLimitProtection, "none");
    assert.equal(snap.ai, false);
    assert.equal(snap.available, false);
    assert.equal(sharedRateLimitOperational(SHARED_ENV), false);
  });

  it("AI-BOOT-04 readiness probe does not consume a quota bucket", async () => {
    const queries = installFakeSharedStore();
    const snap = await runtimeSnapshotWithReadiness({ env: SHARED_ENV });
    assert.equal(snap.ai, true);
    assert.equal(queries.some((q) => /INSERT INTO mf_rate_limit_buckets/i.test(q.text)), false);
  });

  it("AI-BOOT-07 multi-instance without shared DB configuration remains AI offline", async () => {
    const snap = await runtimeSnapshotWithReadiness({ env: { VERCEL: "1", XAI_API_KEY: "k" } });
    assert.equal(snap.rateLimitProtection, "none");
    assert.equal(snap.ai, false);
    assert.equal(snap.available, false);
  });
});
