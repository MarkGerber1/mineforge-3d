import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRuntime, STATIC_RUNTIME } from "./runtime-client.ts";
import { resolveBasepath } from "./basepath.ts";

describe("runtime client static vs server", () => {
  it("rejects HTML/static fallbacks", () => {
    assert.equal(parseRuntime("<!DOCTYPE html>"), null);
    assert.equal(parseRuntime({ ok: true }), null);
    assert.equal(STATIC_RUNTIME.mode, "static");
    assert.equal(STATIC_RUNTIME.ai, false);
    assert.equal(STATIC_RUNTIME.appEditEnabled, false);
  });
  it("accepts server snapshot", () => {
    const s = parseRuntime({
      mode: "server",
      ai: false,
      available: false,
      appEditEnabled: false,
      role: "anonymous",
      rateLimitProtection: "none",
    });
    assert.ok(s);
    assert.equal(s!.mode, "server");
    assert.equal(s!.ai, false);
    assert.equal(s!.appEditEnabled, false);
    assert.equal(s!.rateLimitProtection, "none");
  });
  it("does not invent shared limiter from junk", () => {
    const s = parseRuntime({ mode: "server", ai: true, available: true, rateLimitProtection: "global-map" });
    assert.ok(s);
    assert.equal(s!.rateLimitProtection, undefined);
  });
});

describe("GitHub Pages basepath", () => {
  it("preview stays /", () => {
    assert.equal(resolveBasepath("/", "/"), "/");
  });
  it("Pages subpath is /mineforge-3d", () => {
    assert.equal(resolveBasepath("/mineforge-3d/", "/"), "/mineforge-3d");
    assert.equal(resolveBasepath("/mineforge-3d", "/"), "/mineforge-3d");
  });
});
