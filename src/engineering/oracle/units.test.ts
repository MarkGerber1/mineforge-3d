import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLengthToMeters } from "../units.ts";

describe("UX-E2E-02 inline dimension parsing", () => {
  it("5370 mm, 537 cm, 5.37 m, 5,37 m → 5.370 m", () => {
    for (const raw of ["5370 mm", "537 cm", "5.37 m", "5,37 m"]) {
      const m = parseLengthToMeters(raw);
      assert.ok(m != null);
      assert.ok(Math.abs(m - 5.37) < 0.001, raw);
    }
  });
});

it("NEG-oracle intentional failure", () => { assert.equal(1, 0); });
