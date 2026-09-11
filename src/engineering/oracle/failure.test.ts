import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyFailure } from "../../ai/failure.ts";
import { undergroundParkingFarm } from "../../project/factory.ts";
import { defaultCatalogs } from "../catalogs.ts";
import { calculateAll } from "../pipeline.ts";

describe("FAIL-01 fan failure does not mutate canonical project", () => {
  it("clone only", () => {
    const src = undergroundParkingFarm();
    const nFans = src.fans.length;
    const failed = applyFailure(src, "fan-fail");
    assert.equal(failed.fans.length, 0);
    assert.equal(src.fans.length, nFans);
    const a = calculateAll(src, defaultCatalogs());
    const b = calculateAll(failed, defaultCatalogs());
    assert.notEqual(a.fan.pass, b.fan.pass);
  });
});

describe("FAIL-02 power cut reduces electrical SAFE", () => {
  it("30% cut", () => {
    const src = undergroundParkingFarm();
    const cut = applyFailure(src, "power-cut");
    assert.ok(cut.electrical.availablePowerW < src.electrical.availablePowerW);
    const a = calculateAll(src, defaultCatalogs());
    const b = calculateAll(cut, defaultCatalogs());
    assert.ok((b.capacity.slots.find((s) => s.kind === "ELECTRICAL")?.value ?? 99) <= (a.capacity.slots.find((s) => s.kind === "ELECTRICAL")?.value ?? 0));
  });
});
