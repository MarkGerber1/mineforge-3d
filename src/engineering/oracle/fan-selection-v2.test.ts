import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectFanCandidates } from "../fans.ts";
import { FAN_STRONG, FAN_WEAK } from "../../equipment/fan-catalog.ts";
import { emptyRectangularProject, verifiedAcceptanceProject } from "../../project/factory.ts";
import { calculateAll } from "../pipeline.ts";
import { defaultCatalogs } from "../catalogs.ts";

describe("FAN V2 selection trust boundary", () => {
  it("FAN-01 free-air alone cannot produce a verified candidate", () => {
    const p = emptyRectangularProject();
    const result = selectFanCandidates(p, { [FAN_WEAK.id]: FAN_WEAK }, [], 40_000);
    assert.ok(result.some((x) => x.status !== "PASS"));
  });

  it("FAN-02 untrusted curve remains preliminary even when duty passes", () => {
    const p = emptyRectangularProject();
    const result = selectFanCandidates(p, { [FAN_STRONG.id]: FAN_STRONG }, [], 10_000);
    assert.ok(result.some((x) => x.pass && x.status === "PRELIMINARY"));
  });

  it("FAN-03 parallel and series configurations are enumerated", () => {
    const p = emptyRectangularProject();
    const result = selectFanCandidates(p, { [FAN_STRONG.id]: FAN_STRONG }, [], 10_000, 3);
    assert.ok(result.some((x) => x.arrangement === "parallel" && x.count === 2));
    assert.ok(result.some((x) => x.arrangement === "series" && x.count === 2));
  });

  it("FAN-04 untrusted project fan cannot produce VERIFIED SAFE", () => {
    const p = verifiedAcceptanceProject(24);
    const r = calculateAll(p, defaultCatalogs());
    assert.equal(defaultCatalogs().fans[p.fans[0]!.specId]!.source.trust, "TEST_FIXTURE");
    assert.equal(r.fan.finalSafeEligible, false);
    assert.equal(r.capacity.verified, false);
    assert.equal(r.capacity.confidence, "PRELIMINARY");
  });
});
