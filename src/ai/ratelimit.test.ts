import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { allow, resetRateLimits, setRateLimitNow, LIMITS, clientIpFromHeaders } from "./ratelimit.server.ts";
import { handleAppEditHttp } from "./http.server.ts";
import { executeGrokEngineer, getGrokProviderCalls, resetGrokProviderCalls } from "./grok.ts";

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

  it("AC-6 window expiry allows again", () => {
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

  it("clientIpFromHeaders uses forwarded-for first hop", () => {
    assert.equal(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })), "1.2.3.4");
    assert.equal(clientIpFromHeaders(undefined), "local");
  });
});

describe("HTTP rate limits", () => {
  beforeEach(() => resetRateLimits());

  it("AC-4 repeated failed login is 429", async () => {
    let last = 200;
    for (let i = 0; i < LIMITS.login.max + 2; i++) {
      const res = await handleAppEditHttp(
        new Request("http://app.test/api/app-edit/login", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
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
          headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
          body: JSON.stringify({ passphrase: "wrong" }),
        }),
      )
    )!.json()) as { error: string };
    assert.match(body.error, /Too Many Requests|RATE/i);
  });

  it("AC-5 mutation spam is 429", async () => {
    let last = 200;
    for (let i = 0; i < LIMITS.mutate.max + 1; i++) {
      const res = await handleAppEditHttp(
        new Request("http://app.test/api/app-edit/create-branch", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "8.8.8.8" },
          body: JSON.stringify({ name: "spam" }),
        }),
      );
      last = res!.status;
    }
    assert.equal(last, 429);
  });
});

describe("Grok rate limit", () => {
  beforeEach(() => {
    resetRateLimits();
    resetGrokProviderCalls();
  });

  it("AC-3 rejected Grok request does not call xAI", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    };
    const prev = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = "test-not-a-real-key";
    try {
      for (let i = 0; i < LIMITS.grok.max; i++) allow("grok:ac3", LIMITS.grok);
      const r = await executeGrokEngineer(
        {
          message: "hi",
          projectJson: "{}",
          selectedObjectId: null,
          resultSummary: "{}",
          pickedUi: null,
          realitySummary: "",
        },
        { ip: "ac3", fetchImpl },
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
