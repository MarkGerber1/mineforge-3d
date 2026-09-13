import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  isServerlessProduction,
  publicAiAvailable,
  rateLimitProtectionKind,
} from "./runtime-policy.server.ts";
import {
  authorizeMutation,
  isAppEditEnabled,
  loginWithPassphrase,
  runtimeSnapshot,
  signSession,
  sessionSecret,
} from "./privilege.server.ts";
import { executeGrokEngineer, getGrokProviderCalls, resetGrokProviderCalls } from "./grok-engine.server.ts";
import { calculateAll } from "../engineering/pipeline.ts";
import { defaultCatalogs } from "../engineering/catalogs.ts";
import { emptyRectangularProject } from "../project/factory.ts";

const OWNER = {
  APP_EDIT_ENABLED: "true",
  APP_EDIT_OWNER_SECRET: "owner-secret-test",
  APP_EDIT_USER_SECRET: "user-secret-test",
  APP_EDIT_SESSION_SECRET: "session-secret-test",
};

const GROK_INPUT = {
  message: "hi",
  projectJson: "{}",
  selectedObjectId: null,
  resultSummary: "{}",
  pickedUi: null,
  realitySummary: "",
};

describe("APPEDIT-SERVERLESS fail-closed", () => {
  it("APPEDIT-SERVERLESS-01 GROK_PROJECT_ID only → App Edit OFF", () => {
    const env = { GROK_PROJECT_ID: "proj-only" };
    assert.equal(isServerlessProduction(env), true);
    assert.equal(isAppEditEnabled(env), false);
    assert.equal(runtimeSnapshot({ env }).appEditEnabled, false);
  });

  it("APPEDIT-SERVERLESS-02 VERCEL=1 only → App Edit OFF", () => {
    const env = { VERCEL: "1", APP_EDIT_ENABLED: "true" };
    assert.equal(isServerlessProduction(env), true);
    assert.equal(isAppEditEnabled(env), false);
    assert.equal(runtimeSnapshot({ env }).appEditEnabled, false);
  });

  it("APPEDIT-SERVERLESS-03 VERCEL=true only → App Edit OFF", () => {
    const env = { VERCEL: "true", APP_EDIT_ENABLED: "true" };
    assert.equal(isServerlessProduction(env), true);
    assert.equal(isAppEditEnabled(env), false);
  });

  it("APPEDIT-SERVERLESS-04 VERCEL=1 + APP_EDIT_ENABLED=true → still OFF", () => {
    const env = { ...OWNER, VERCEL: "1", APP_EDIT_ENABLED: "true", GROK_PROJECT_ID: "" };
    assert.equal(isAppEditEnabled(env), false);
    const secret = sessionSecret(env)!;
    const cookie = signSession({ sub: "owner", role: "owner" }, secret);
    const g = authorizeMutation("write_source", { cookie, env });
    assert.equal(g.ok, false);
    if (!g.ok) {
      assert.equal(g.status, 403);
      assert.equal(g.code, "APP_EDIT_DISABLED");
    }
    const login = loginWithPassphrase("owner-secret-test", env);
    assert.equal(login.ok, false);
    if (!login.ok) {
      assert.equal(login.status, 403);
      assert.equal(login.code, "APP_EDIT_DISABLED");
    }
  });

  it("APPEDIT-SERVERLESS-05 GROK_PROJECT_ID + APP_EDIT_ENABLED=true → still OFF", () => {
    const env = { ...OWNER, GROK_PROJECT_ID: "published", APP_EDIT_ENABLED: "true" };
    assert.equal(isAppEditEnabled(env), false);
    const secret = sessionSecret(env)!;
    const cookie = signSession({ sub: "owner", role: "owner" }, secret);
    const g = authorizeMutation("commit", { cookie, env });
    assert.equal(g.ok, false);
    if (!g.ok) assert.equal(g.code, "APP_EDIT_DISABLED");
  });

  it("APPEDIT-SERVERLESS-06 workspace no serverless marker + flag true → App Edit ON", () => {
    const env = { ...OWNER, APP_EDIT_ENABLED: "true" };
    assert.equal(isServerlessProduction(env), false);
    assert.equal(isAppEditEnabled(env), true);
    const secret = sessionSecret(env)!;
    const cookie = signSession({ sub: "owner", role: "owner" }, secret);
    const g = authorizeMutation("commit", { cookie, env });
    assert.equal(g.ok, true);
  });
});

describe("AI-PROD fail-closed public Grok (OPTION B)", () => {
  beforeEach(() => {
    resetGrokProviderCalls();
  });

  it("AI-PROD-01 single-instance + XAI key → AI available", () => {
    const env = { XAI_API_KEY: "test-not-a-real-key" };
    assert.equal(isServerlessProduction(env), false);
    assert.equal(rateLimitProtectionKind(env), "local-process");
    assert.equal(publicAiAvailable(env), true);
    const snap = runtimeSnapshot({ env });
    assert.equal(snap.ai, true);
    assert.equal(snap.available, true);
    assert.equal(snap.instanceModel, "single-instance");
    assert.equal(snap.rateLimitProtection, "local-process");
  });

  it("AI-PROD-02 multi-instance/Vercel + XAI key + no shared limiter → AI unavailable", () => {
    const env = { VERCEL: "1", XAI_API_KEY: "test-not-a-real-key" };
    assert.equal(isServerlessProduction(env), true);
    assert.equal(rateLimitProtectionKind(env), "none");
    assert.equal(publicAiAvailable(env), false);
    const snap = runtimeSnapshot({ env });
    assert.equal(snap.ai, false);
    assert.equal(snap.available, false);
    assert.equal(snap.appEditEnabled, false);
    assert.equal(snap.rateLimitProtection, "none");
    assert.notEqual(snap.rateLimitProtection, "shared");
  });

  it("AI-PROD-03/04 same environment, Grok request never calls xAI; counter stays 0", async () => {
    let fetchCalls = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 200 });
    };
    const env = { VERCEL: "1", XAI_API_KEY: "test-not-a-real-key" };
    const r = await executeGrokEngineer(GROK_INPUT, { fetchImpl, env, ip: "198.51.100.20" });
    assert.equal(r.ok, false);
    assert.equal("offline" in r && r.offline, true);
    assert.match(r.error ?? "", /AI OFFLINE/);
    assert.equal(fetchCalls, 0);
    assert.equal(getGrokProviderCalls(), 0);
  });

  it("AI-PROD-05 multi-instance without XAI key → AI OFFLINE", () => {
    const env = { VERCEL: "true", XAI_API_KEY: "" };
    assert.equal(publicAiAvailable(env), false);
    const snap = runtimeSnapshot({ env });
    assert.equal(snap.ai, false);
    assert.equal(snap.available, false);
  });

  it("AI-PROD-06 CAD / Engineering remains available when AI is disabled", () => {
    const env = { VERCEL: "1", XAI_API_KEY: "test-not-a-real-key" };
    assert.equal(publicAiAvailable(env), false);
    const project = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    const result = calculateAll(project, defaultCatalogs());
    assert.ok(result);
    assert.ok("safe" in result.capacity);
    assert.ok(result.capacity.slots.length > 0);
  });

  it("AI-PROD-07 process-local limiter is not advertised as shared/global protection", () => {
    assert.equal(rateLimitProtectionKind({}), "local-process");
    assert.equal(rateLimitProtectionKind({ VERCEL: "1" }), "none");
    assert.equal(rateLimitProtectionKind({ GROK_PROJECT_ID: "x" }), "none");
    assert.equal(rateLimitProtectionKind({ PRODUCTION_INSTANCE_MODEL: "multi-instance" }), "none");
    const serverless = runtimeSnapshot({ env: { VERCEL: "1", XAI_API_KEY: "k" } });
    assert.equal(serverless.rateLimitProtection, "none");
    assert.notEqual(serverless.rateLimitProtection, "shared");
    const local = runtimeSnapshot({ env: { XAI_API_KEY: "k" } });
    assert.equal(local.rateLimitProtection, "local-process");
    assert.notEqual(local.rateLimitProtection, "shared");
  });

  it("GROK_PROJECT_ID + key also fail-closes AI before provider", async () => {
    let fetchCalls = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 200 });
    };
    const r = await executeGrokEngineer(GROK_INPUT, {
      fetchImpl,
      env: { GROK_PROJECT_ID: "published", XAI_API_KEY: "test-not-a-real-key" },
      ip: "local",
    });
    assert.equal(r.ok, false);
    assert.equal("offline" in r && r.offline, true);
    assert.equal(fetchCalls, 0);
    assert.equal(getGrokProviderCalls(), 0);
  });
});
