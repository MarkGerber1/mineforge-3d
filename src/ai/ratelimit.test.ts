import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  allow,
  resetRateLimits,
  setRateLimitNow,
  LIMITS,
  clientIpFromHeaders,
  validClientIp,
  UNKNOWN_IP,
  LOCAL_IP,
} from "./ratelimit.server.ts";
import { handleAppEditHttp } from "./http.server.ts";
import { executeGrokEngineer, getGrokProviderCalls, resetGrokProviderCalls } from "./grok-engine.server.ts";

const CF_A = "203.0.113.10";
const CF_B = "203.0.113.11";

function cfHeaders(ip: string, extra: Record<string, string> = {}): Headers {
  return new Headers({ "cf-connecting-ip": ip, ...extra });
}

describe("rate limiter", () => {
  beforeEach(() => {
    resetRateLimits();
    setRateLimitNow(() => Date.now());
  });

  it("AC-1 allows up to max requests", () => {
    for (let i = 0; i < LIMITS.grok.max; i++) {
      const r = allow("grok:t", LIMITS.grok);
      assert.equal(r.ok, true, `request ${i + 1}`);
    }
  });

  it("AC-2 excess is denied", () => {
    for (let i = 0; i < LIMITS.grok.max; i++) allow("grok:t2", LIMITS.grok);
    const r = allow("grok:t2", LIMITS.grok);
    assert.equal(r.ok, false);
    assert.ok(r.retryAfter >= 1);
  });

  it("AC-9 window expiry allows again", () => {
    let now = 1_000_000;
    setRateLimitNow(() => now);
    for (let i = 0; i < LIMITS.login.max; i++) allow("login:w", LIMITS.login);
    assert.equal(allow("login:w", LIMITS.login).ok, false);
    now += LIMITS.login.windowMs + 1;
    assert.equal(allow("login:w", LIMITS.login).ok, true);
  });

  it("fail-closed on empty key", () => {
    assert.equal(allow("", LIMITS.grok).ok, false);
  });

  it("fail-closed on oversized key (no unbounded Map growth)", () => {
    const huge = "x".repeat(500);
    assert.equal(allow(huge, LIMITS.grok).ok, false);
    assert.equal(validClientIp("x".repeat(500)), undefined);
  });
});

describe("trusted client identity (Cloudflare)", () => {
  const prevTrust = process.env.RATE_LIMIT_TRUST;

  beforeEach(() => {
    resetRateLimits();
    setRateLimitNow(() => Date.now());
    process.env.RATE_LIMIT_TRUST = "cloudflare";
  });

  afterEach(() => {
    if (prevTrust === undefined) delete process.env.RATE_LIMIT_TRUST;
    else process.env.RATE_LIMIT_TRUST = prevTrust;
  });

  it("AC-1 Cloudflare identity beats X-Forwarded-For", () => {
    const ip = clientIpFromHeaders(
      cfHeaders(CF_A, { "x-forwarded-for": "1.1.1.1, 10.0.0.1" }),
      "cloudflare",
    );
    assert.equal(ip, CF_A);
  });

  it("AC-2 XFF rotation stays in one bucket then 429", () => {
    for (let i = 0; i < LIMITS.grok.max; i++) {
      const ip = clientIpFromHeaders(
        cfHeaders(CF_A, { "x-forwarded-for": `${i}.1.1.1` }),
        "cloudflare",
      );
      assert.equal(ip, CF_A);
      const r = allow(`grok:${ip}`, LIMITS.grok);
      assert.equal(r.ok, true, `allowed ${i + 1}`);
    }
    const ip = clientIpFromHeaders(
      cfHeaders(CF_A, { "x-forwarded-for": "198.51.100.1" }),
      "cloudflare",
    );
    const denied = allow(`grok:${ip}`, LIMITS.grok);
    assert.equal(denied.ok, false);
    assert.ok(denied.retryAfter >= 1);
  });

  it("AC-3 two real CF-Connecting-IP values are isolated buckets", () => {
    for (let i = 0; i < LIMITS.grok.max; i++) allow(`grok:${CF_A}`, LIMITS.grok);
    assert.equal(allow(`grok:${CF_A}`, LIMITS.grok).ok, false);
    assert.equal(allow(`grok:${CF_B}`, LIMITS.grok).ok, true);
    assert.equal(clientIpFromHeaders(cfHeaders(CF_A), "cloudflare"), CF_A);
    assert.equal(clientIpFromHeaders(cfHeaders(CF_B), "cloudflare"), CF_B);
  });

  it("AC-4 spoofed X-Real-IP does not change CF identity", () => {
    const a = clientIpFromHeaders(cfHeaders(CF_A, { "x-real-ip": "8.8.8.8" }), "cloudflare");
    const b = clientIpFromHeaders(cfHeaders(CF_A, { "x-real-ip": "9.9.9.9" }), "cloudflare");
    assert.equal(a, CF_A);
    assert.equal(b, CF_A);
  });

  it("AC-5 invalid CF-Connecting-IP uses bounded unknown, not attacker string", () => {
    const junk = "arbitrary-attacker-string";
    const ip = clientIpFromHeaders(cfHeaders(junk, { "x-forwarded-for": "1.2.3.4" }), "cloudflare");
    assert.equal(ip, UNKNOWN_IP);
    assert.notEqual(ip, junk);
    const huge = "9".repeat(2048);
    const ip2 = clientIpFromHeaders(new Headers({ "cf-connecting-ip": huge }), "cloudflare");
    assert.equal(ip2, UNKNOWN_IP);
  });

  it("missing CF identity is unknown, not first XFF", () => {
    const ip = clientIpFromHeaders(
      new Headers({ "x-forwarded-for": "198.51.100.20", "x-real-ip": "198.51.100.21" }),
      "cloudflare",
    );
    assert.equal(ip, UNKNOWN_IP);
  });

  it("local mode ignores proxy headers", () => {
    const ip = clientIpFromHeaders(
      new Headers({ "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": CF_A }),
      "local",
    );
    assert.equal(ip, LOCAL_IP);
  });

  it("auto does not trust spoofable CF headers", () => {
    const ip = clientIpFromHeaders(
      new Headers({ "cf-connecting-ip": CF_A, "cf-ray": "spoofed", "x-forwarded-for": "1.1.1.1" }),
      "auto",
    );
    assert.equal(ip, LOCAL_IP);
  });
});

describe("trusted client identity (Vercel)", () => {
  const VERCEL_A = "198.51.100.20";
  const VERCEL_B = "198.51.100.21";

  it("vercel uses x-real-ip and ignores first XFF", () => {
    const ip = clientIpFromHeaders(
      new Headers({
        "x-real-ip": VERCEL_A,
        "x-forwarded-for": "1.1.1.1, 10.0.0.1",
        "cf-connecting-ip": CF_A,
      }),
      "vercel",
    );
    assert.equal(ip, VERCEL_A);
  });

  it("vercel falls back to x-vercel-forwarded-for", () => {
    const ip = clientIpFromHeaders(
      new Headers({
        "x-vercel-forwarded-for": VERCEL_B,
        "x-forwarded-for": "8.8.8.8",
      }),
      "vercel",
    );
    assert.equal(ip, VERCEL_B);
  });

  it("vercel missing identity is unknown, not XFF", () => {
    const ip = clientIpFromHeaders(
      new Headers({ "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": CF_A }),
      "vercel",
    );
    assert.equal(ip, UNKNOWN_IP);
  });

  it("auto + VERCEL=1 uses vercel identity (not CF, not XFF)", () => {
    const env = { ...process.env, VERCEL: "1", RATE_LIMIT_TRUST: "auto" };
    const ip = clientIpFromHeaders(
      new Headers({
        "x-real-ip": VERCEL_A,
        "x-forwarded-for": "9.9.9.9",
        "cf-connecting-ip": CF_A,
      }),
      "auto",
      env,
    );
    assert.equal(ip, VERCEL_A);
  });

  it("auto without VERCEL still ignores proxy headers", () => {
    const env = { ...process.env };
    delete env.VERCEL;
    const ip = clientIpFromHeaders(
      new Headers({ "x-real-ip": VERCEL_A, "cf-connecting-ip": CF_A }),
      "auto",
      env,
    );
    assert.equal(ip, LOCAL_IP);
  });
});

describe("HTTP rate limits", () => {
  const prevTrust = process.env.RATE_LIMIT_TRUST;

  beforeEach(() => {
    resetRateLimits();
    process.env.RATE_LIMIT_TRUST = "cloudflare";
  });

  afterEach(() => {
    if (prevTrust === undefined) delete process.env.RATE_LIMIT_TRUST;
    else process.env.RATE_LIMIT_TRUST = prevTrust;
  });

  it("AC-7 rotating XFF does not reset login threshold; then 429", async () => {
    let last = 200;
    for (let i = 0; i < LIMITS.login.max + 2; i++) {
      const res = await handleAppEditHttp(
        new Request("http://app.test/api/app-edit/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": CF_A,
            "x-forwarded-for": `${i}.8.8.8`,
          },
          body: JSON.stringify({ passphrase: "wrong" }),
        }),
      );
      last = res!.status;
    }
    assert.equal(last, 429);
    const body = (await (
      await handleAppEditHttp(
        new Request("http://app.test/api/app-edit/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": CF_A,
            "x-forwarded-for": "77.77.77.77",
          },
          body: JSON.stringify({ passphrase: "wrong" }),
        }),
      )
    )!.json()) as { error: string; retryAfter?: number };
    assert.match(body.error, /Too Many Requests|RATE/i);
    assert.ok((body.retryAfter ?? 1) >= 1);
  });

  it("AC-8 mutation spam with rotating XFF is 429", async () => {
    let last = 200;
    for (let i = 0; i < LIMITS.mutate.max + 1; i++) {
      const res = await handleAppEditHttp(
        new Request("http://app.test/api/app-edit/create-branch", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": CF_B,
            "x-forwarded-for": `${i}.9.9.9`,
            "x-real-ip": `${i}.4.4.4`,
          },
          body: JSON.stringify({ name: "spam" }),
        }),
      );
      last = res!.status;
    }
    assert.equal(last, 429);
  });

  it("two CF identities do not share the login bucket", async () => {
    for (let i = 0; i < LIMITS.login.max + 1; i++) {
      await handleAppEditHttp(
        new Request("http://app.test/api/app-edit/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": CF_A,
          },
          body: JSON.stringify({ passphrase: "wrong" }),
        }),
      );
    }
    const other = await handleAppEditHttp(
      new Request("http://app.test/api/app-edit/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": CF_B,
        },
        body: JSON.stringify({ passphrase: "wrong" }),
      }),
    );
    assert.notEqual(other!.status, 429, "second CF identity must not share the login bucket");
    assert.ok(other!.status === 401 || other!.status === 403);
  });
});

describe("Grok rate limit", () => {
  beforeEach(() => {
    resetRateLimits();
    resetGrokProviderCalls();
  });

  it("AC-6 rejected Grok request does not call xAI", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    };
    const prev = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = "test-not-a-real-key";
    try {
      const ip = clientIpFromHeaders(
        cfHeaders(CF_A, { "x-forwarded-for": "1.1.1.1" }),
        "cloudflare",
      );
      assert.equal(ip, CF_A);
      for (let i = 0; i < LIMITS.grok.max; i++) allow(`grok:${ip}`, LIMITS.grok);
      const r = await executeGrokEngineer(
        {
          message: "hi",
          projectJson: "{}",
          selectedObjectId: null,
          resultSummary: "{}",
          pickedUi: null,
          realitySummary: "",
        },
        { ip, fetchImpl },
      );
      assert.equal(r.ok, false);
      assert.equal("rateLimited" in r && r.rateLimited, true);
      assert.equal(calls, 0);
      assert.equal(getGrokProviderCalls(), 0);
    } finally {
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
    }
  });

  it("AC-6 rotating XFF still does not call xAI after threshold", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    };
    const prev = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = "test-not-a-real-key";
    try {
      for (let i = 0; i < LIMITS.grok.max; i++) {
        const ip = clientIpFromHeaders(cfHeaders(CF_A, { "x-forwarded-for": `${i}.0.0.1` }), "cloudflare");
        allow(`grok:${ip}`, LIMITS.grok);
      }
      const ip = clientIpFromHeaders(cfHeaders(CF_A, { "x-forwarded-for": "9.9.9.9" }), "cloudflare");
      const r = await executeGrokEngineer(
        {
          message: "hi",
          projectJson: "{}",
          selectedObjectId: null,
          resultSummary: "{}",
          pickedUi: null,
          realitySummary: "",
        },
        { ip, fetchImpl },
      );
      assert.equal(r.ok, false);
      assert.equal("rateLimited" in r && r.rateLimited, true);
      assert.equal(calls, 0);
      assert.equal(getGrokProviderCalls(), 0);
    } finally {
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
    }
  });
});
