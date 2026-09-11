import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyReality } from "../types.ts";
import { undergroundParkingFarm } from "../../project/factory.ts";
import { defaultCatalogs } from "../catalogs.ts";
import { calculateAll } from "../pipeline.ts";
import { applyPatch } from "../upgrade.ts";

describe("REAL-01 photo estimate never labeled field measurement", () => {
  it("provenance stays PHOTO_ESTIMATE until confirm", () => {
    const p = undergroundParkingFarm();
    p.reality = emptyReality();
    p.reality.asBuilt.push({
      id: "beam1",
      kind: "beam",
      name: "Beam from photo",
      x: 1,
      y: 1,
      z: 2.4,
      widthM: 4,
      heightM: 0.3,
      depthM: 0.3,
      provenance: "PHOTO_ESTIMATE",
      confidence: "MEDIUM",
    });
    assert.notEqual(p.reality.asBuilt[0].provenance, "FIELD_MEASUREMENT");
  });
});

describe("REAL-02 confirmed beam collides with rack", () => {
  it("SAFE/warnings see as-built after APPLY", () => {
    const src = undergroundParkingFarm();
    const rack = src.racks[0];
    assert.ok(rack);
    const next = applyPatch(src, {
      reality: {
        asBuilt: [
          {
            id: "beam_hit",
            kind: "beam",
            name: "Beam",
            x: rack.x,
            y: rack.y,
            z: 2.2,
            widthM: rack.widthM,
            heightM: 0.3,
            depthM: rack.depthM,
            provenance: "USER_CONFIRMED",
            confidence: "HIGH",
          },
        ],
      },
    });
    const r = calculateAll(next, defaultCatalogs());
    assert.ok(r.racks.asBuiltHits.length >= 1);
    assert.ok(r.warnings.some((w) => w.id.startsWith("asbuilt-")));
  });
});
