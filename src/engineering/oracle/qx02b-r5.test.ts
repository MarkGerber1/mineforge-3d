import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TEST_ASIC_A } from "../../equipment/asic-catalog.ts";
import { FAN_STRONG } from "../../equipment/fan-catalog.ts";
import { emptyRectangularProject, undergroundParkingFarm, withKnownFloor } from "../../project/factory.ts";
import { parseProject } from "../../project/schema.ts";
import { importProjectJson } from "../../project/persistence.ts";
import { saveScheduler } from "../../project/save-scheduler.ts";
import { useProjectStore } from "../../project/store.ts";
import { defaultCatalogs } from "../catalogs.ts";
import { validateCanonicalProjectDomains } from "../canonical.ts";
import {
  MAX_AVAILABLE_POWER_W,
  MAX_DELTA_T_K,
  MAX_FAN_GROUP_COUNT,
  MAX_RACK_SHELVES,
  MIN_DELTA_T_K,
} from "../constants.ts";
import {
  SAFETY_NUMERIC_INVENTORY,
  applyInventoryInvalid,
  collectNumericPaths,
  inventoryClassForPath,
  inventoryCompletenessFixture,
  normalizeNumericPath,
} from "../numeric-inventory.ts";
import { calculateAll } from "../pipeline.ts";
import { applyPatchValidated, generateUpgradeOptions, solveForTarget } from "../upgrade.ts";
import type { Project } from "../types.ts";

saveScheduler.setSave(async () => undefined);

const catalogs = defaultCatalogs();

function live() {
  return useProjectStore.getState();
}

function verifiedBase(): Project {
  const p = undergroundParkingFarm();
  withKnownFloor(p);
  p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
  return p;
}

function fp(p: Project): string {
  return JSON.stringify({
    room: p.room,
    openings: p.openings,
    electrical: p.electrical,
    thermal: p.thermal,
    ventilation: p.ventilation,
    constraints: p.constraints,
    fleet: p.fleet,
    racks: p.racks,
    fans: p.fans,
    asBuilt: p.reality?.asBuilt ?? [],
  });
}

function assertRejected(res: { ok: boolean }, pBefore: Project, pAfter: Project, label: string): void {
  assert.equal(res.ok, false, `${label} must reject`);
  assert.equal(fp(pAfter), fp(pBefore), `${label} must leave canonical unchanged`);
}

describe("DOMAIN-INV-01 complete numeric inventory", () => {
  it("classifies every numeric path on a fully populated Project", () => {
    const fixture = inventoryCompletenessFixture();
    const paths = collectNumericPaths(fixture);
    assert.ok(paths.length > 20, "fixture must expose many numeric fields");
    const unclassified = paths.filter((p) => inventoryClassForPath(p) == null);
    assert.deepEqual(
      unclassified.map(normalizeNumericPath).sort(),
      [],
      `unclassified numeric paths: ${unclassified.join(", ")}`,
    );
    const driving = SAFETY_NUMERIC_INVENTORY.filter((e) => e.class === "SAFETY_DRIVING");
    assert.ok(driving.length >= 30, "SAFETY_DRIVING inventory must be complete, not a sample");
    const required = [
      "electrical.auxiliaryW",
      "electrical.reservePct",
      "electrical.voltageV",
      "thermal.deltaTK",
      "ventilation.dirtyFilterExtraPa",
      "ventilation.components[].frictionFactor",
      "fans[].count",
      "constraints.minAisleM",
      "racks[].usableShelfWidthM",
      "fleet.imported.typicalPowerW",
    ];
    for (const path of required) {
      assert.ok(
        SAFETY_NUMERIC_INVENTORY.some((e) => e.path === path && e.class === "SAFETY_DRIVING"),
        `missing SAFETY_DRIVING ${path}`,
      );
    }
  });

  it("every SAFETY_DRIVING and SAFETY_GEOMETRY invalid sample is rejected", () => {
    const fixture = inventoryCompletenessFixture();
    const baseline = validateCanonicalProjectDomains(fixture, catalogs);
    assert.equal(baseline.ok, true, baseline.ok ? "" : baseline.errors.join("; "));
    const rows = SAFETY_NUMERIC_INVENTORY.filter((e) => e.class !== "NON_SAFETY_METADATA");
    const failures: string[] = [];
    for (const row of rows) {
      const hostile = applyInventoryInvalid(fixture, row.path, row.invalid);
      const res = validateCanonicalProjectDomains(hostile, catalogs);
      if (res.ok) failures.push(`${row.path} invalid=${row.invalid} accepted`);
    }
    assert.deepEqual(failures, []);
  });
});

describe("DOMAIN field table (blank/NaN/Infinity/sign/bounds)", () => {
  const samples: Array<{ path: string; values: Array<{ v: number; ok: boolean; name: string }> }> = [
    {
      path: "thermal.deltaTK",
      values: [
        { v: Number.NaN, ok: false, name: "NaN" },
        { v: Number.POSITIVE_INFINITY, ok: false, name: "Infinity" },
        { v: Number.NEGATIVE_INFINITY, ok: false, name: "-Infinity" },
        { v: 4.99, ok: false, name: "below-min" },
        { v: MIN_DELTA_T_K, ok: true, name: "min" },
        { v: 10, ok: true, name: "normal" },
        { v: MAX_DELTA_T_K, ok: true, name: "max" },
        { v: 15.01, ok: false, name: "above-max" },
        { v: 100, ok: false, name: "huge" },
        { v: 0, ok: false, name: "zero" },
        { v: -1, ok: false, name: "negative" },
      ],
    },
    {
      path: "electrical.auxiliaryW",
      values: [
        { v: Number.NaN, ok: false, name: "NaN" },
        { v: Number.POSITIVE_INFINITY, ok: false, name: "Infinity" },
        { v: -1_000_000, ok: false, name: "negative" },
        { v: 0, ok: true, name: "zero" },
        { v: 2500, ok: true, name: "normal" },
      ],
    },
    {
      path: "electrical.reservePct",
      values: [
        { v: Number.NaN, ok: false, name: "NaN" },
        { v: -1, ok: false, name: "negative" },
        { v: 0, ok: true, name: "min" },
        { v: 20, ok: true, name: "normal" },
        { v: 90, ok: true, name: "max" },
        { v: 91, ok: false, name: "above-max" },
      ],
    },
    {
      path: "electrical.voltageV",
      values: [
        { v: 0, ok: false, name: "zero" },
        { v: -230, ok: false, name: "negative" },
        { v: 230, ok: true, name: "normal" },
        { v: Number.NaN, ok: false, name: "NaN" },
      ],
    },
    {
      path: "fans[].count",
      values: [
        { v: Number.NaN, ok: false, name: "NaN" },
        { v: Number.POSITIVE_INFINITY, ok: false, name: "Infinity" },
        { v: -1, ok: false, name: "negative" },
        { v: 0, ok: false, name: "zero" },
        { v: 1, ok: true, name: "min" },
        { v: 2, ok: true, name: "normal" },
        { v: 1.5, ok: false, name: "fraction" },
        { v: MAX_FAN_GROUP_COUNT, ok: true, name: "max" },
        { v: MAX_FAN_GROUP_COUNT + 1, ok: false, name: "above-max" },
        { v: 1_000_000, ok: false, name: "huge" },
      ],
    },
    {
      path: "racks[].shelves",
      values: [
        { v: -1, ok: false, name: "negative" },
        { v: 0, ok: false, name: "zero" },
        { v: 3.7, ok: false, name: "fraction" },
        { v: 1, ok: true, name: "min" },
        { v: 4, ok: true, name: "normal" },
        { v: MAX_RACK_SHELVES, ok: true, name: "max" },
        { v: MAX_RACK_SHELVES + 1, ok: false, name: "above-max" },
        { v: 1e9, ok: false, name: "huge" },
      ],
    },
    {
      path: "constraints.frontServiceClearanceM",
      values: [
        { v: Number.NaN, ok: false, name: "NaN" },
        { v: -1, ok: false, name: "negative" },
        { v: 0, ok: true, name: "zero" },
        { v: 0.8, ok: true, name: "normal" },
      ],
    },
    {
      path: "ventilation.dirtyFilterExtraPa",
      values: [
        { v: -200, ok: false, name: "negative" },
        { v: 0, ok: true, name: "zero" },
        { v: 200, ok: true, name: "normal" },
        { v: Number.NaN, ok: false, name: "NaN" },
      ],
    },
  ];

  for (const row of samples) {
    describe(`DOMAIN ${row.path}`, () => {
      for (const s of row.values) {
        it(`${s.name} = ${s.v} → ${s.ok ? "ACCEPT" : "REJECT"}`, () => {
          const fixture = inventoryCompletenessFixture();
          const next = applyInventoryInvalid(fixture, row.path, s.v);
          const res = validateCanonicalProjectDomains(next, catalogs);
          assert.equal(res.ok, s.ok, res.ok ? "accepted" : res.errors.join("; "));
        });
      }
    });
  }
});

describe("QX02B-R5-A negative auxiliary / reserve", () => {
  it("auxiliaryW = -1_000_000 rejected on every ingress; cannot restore VERIFIED", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const before = fp(live().project);
    const beforeSafe = live().result.capacity.safe;
    const beforeVerified = live().result.capacity.verified;
    const pastLen = live().past.length;

    const patch = applyPatchValidated(p, { electrical: { auxiliaryW: -1_000_000 } }, catalogs);
    assert.equal(patch.ok, false);
    assert.equal(patch.project.electrical.auxiliaryW, p.electrical.auxiliaryW);

    live().propose({
      id: "aux-neg",
      summary: "negative aux",
      detail: "attack",
      patch: { electrical: { auxiliaryW: -1_000_000 } },
      fromGrok: true,
    });
    const proposed = live().applyProposed();
    assert.equal(proposed.ok, false);
    assert.equal(fp(live().project), before);

    const committed = live().commit({ ...live().project, electrical: { ...live().project.electrical, auxiliaryW: -1_000_000 } }, "aux");
    assert.equal(committed, false);
    assert.equal(fp(live().project), before);
    assert.equal(live().past.length, pastLen);

    const hostile = structuredClone(p);
    hostile.electrical.auxiliaryW = -1_000_000;
    assert.equal(live().loadProject(hostile, false).ok, false);
    assert.equal(fp(live().project), before);
    assert.throws(() => parseProject(JSON.parse(JSON.stringify(hostile))));

    assert.equal(live().result.capacity.safe, beforeSafe);
    assert.equal(live().result.capacity.verified, beforeVerified);
  });

  it("reservePct 91 / -1 / NaN rejected; 0 and 90 accepted", () => {
    const p = verifiedBase();
    for (const bad of [91, -1, Number.NaN, 100]) {
      const res = applyPatchValidated(p, { electrical: { reservePct: bad } }, catalogs);
      assert.equal(res.ok, false, `reservePct=${bad}`);
    }
    assert.equal(applyPatchValidated(p, { electrical: { reservePct: 0 } }, catalogs).ok, true);
    assert.equal(applyPatchValidated(p, { electrical: { reservePct: 90 } }, catalogs).ok, true);
  });
});

describe("QX02B-R5-B thermal deltaTK", () => {
  it("setDeltaT / patch / import / commit only accept 5…15", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const before = live().project.thermal.deltaTK;

    for (const bad of [4.99, 15.01, 100, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -5]) {
      const r = live().setDeltaT(bad);
      assert.equal(r.ok, false, `setDeltaT ${bad}`);
      assert.equal(live().project.thermal.deltaTK, before);
      const patched = applyPatchValidated(p, { thermal: { deltaTK: bad } }, catalogs);
      assert.equal(patched.ok, false, `patch ΔT ${bad}`);
      const hostile = structuredClone(p);
      hostile.thermal.deltaTK = bad;
      assert.equal(live().commit(hostile, "dT"), false);
      assert.equal(live().project.thermal.deltaTK, before);
      live().loadProject(p, false);
    }
    assert.equal(live().setDeltaT(5).ok, true);
    assert.equal(live().project.thermal.deltaTK, 5);
    assert.equal(live().setDeltaT(10).ok, true);
    assert.equal(live().setDeltaT(15).ok, true);
    assert.equal(live().project.thermal.deltaTK, 15);
  });

  it("deltaTK=100 cannot reduce ventilation requirement via APPLY", () => {
    const p = verifiedBase();
    const before = calculateAll(p, catalogs);
    const res = applyPatchValidated(p, { thermal: { deltaTK: 100 } }, catalogs);
    assert.equal(res.ok, false);
    const after = calculateAll(res.project, catalogs);
    assert.equal(after.thermal.designAirflowM3h, before.thermal.designAirflowM3h);
  });
});

describe("QX02B-R5-C ventilation pressure/loss", () => {
  it("negative friction / K / extraPa / length / dirty filter rejected", () => {
    const p = verifiedBase();
    const shaft = p.ventilation.components.find((c) => c.kind === "duct")!;
    const attacks: Array<{ name: string; patch: Parameters<typeof applyPatchValidated>[1] }> = [
      {
        name: "friction",
        patch: {
          ventilation: {
            components: p.ventilation.components.map((c) => (c.id === shaft.id ? { ...c, frictionFactor: -1 } : c)),
          },
        },
      },
      {
        name: "kLocal",
        patch: {
          ventilation: {
            components: p.ventilation.components.map((c) => (c.id === shaft.id ? { ...c, kLocal: -1 } : c)),
          },
        },
      },
      {
        name: "extraPa",
        patch: {
          ventilation: {
            components: p.ventilation.components.map((c) => (c.id === shaft.id ? { ...c, extraPressurePa: -500 } : c)),
          },
        },
      },
      {
        name: "length",
        patch: {
          ventilation: {
            components: p.ventilation.components.map((c) => (c.id === shaft.id ? { ...c, lengthM: -10 } : c)),
          },
        },
      },
      { name: "dirty", patch: { ventilation: { dirtyFilterExtraPa: -200 } } },
      {
        name: "rect-zero",
        patch: {
          ventilation: {
            components: p.ventilation.components.map((c) => (c.id === shaft.id ? { ...c, widthM: 0, heightM: 0 } : c)),
          },
        },
      },
    ];
    live().loadProject(p, false);
    const before = fp(live().project);
    for (const a of attacks) {
      const res = applyPatchValidated(p, a.patch, catalogs);
      assert.equal(res.ok, false, a.name);
      assert.equal(fp(res.project), fp(p), a.name);
    }
    const round = structuredClone(p);
    round.ventilation.components = round.ventilation.components.map((c, i) =>
      i === 0 ? { ...c, shape: "round" as const, diameterM: 0, widthM: undefined, heightM: undefined } : c,
    );
    assert.equal(validateCanonicalProjectDomains(round, catalogs).ok, false);
    assert.equal(fp(live().project), before);
  });
});

describe("QX02B-R5-D fan count", () => {
  it("setFan rejects invalid counts; max is closed", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const before = live().project.fans[0]!.count;
    for (const bad of [-1, 0, 0.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_FAN_GROUP_COUNT + 1, 1e6]) {
      const r = live().setFan(FAN_STRONG.id, bad, "parallel");
      assert.equal(r.ok, false, `count=${bad}`);
      assert.equal(live().project.fans[0]!.count, before);
    }
    assert.equal(live().setFan(FAN_STRONG.id, 1, "single").ok, true);
    assert.equal(live().project.fans[0]!.count, 1);
    assert.equal(live().setFan(FAN_STRONG.id, MAX_FAN_GROUP_COUNT, "parallel").ok, true);
    assert.equal(live().project.fans[0]!.count, MAX_FAN_GROUP_COUNT);
  });
});

describe("QX02B-R5-E service constraints", () => {
  it("negative front/rear/aisle rejected on load/import/commit/APPLY", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const before = fp(live().project);
    for (const key of ["frontServiceClearanceM", "rearServiceClearanceM", "minAisleM"] as const) {
      const res = applyPatchValidated(p, { constraints: { [key]: -1 } }, catalogs);
      assert.equal(res.ok, false, key);
      const hostile = structuredClone(p);
      hostile.constraints[key] = -1;
      assert.equal(live().commit(hostile, key), false);
      assert.equal(live().loadProject(hostile, false).ok, false);
      assert.throws(() => parseProject(JSON.parse(JSON.stringify(hostile))));
    }
    assert.equal(fp(live().project), before);
  });
});

describe("QX02B-R5-F rack capacity geometry", () => {
  it("invalid shelves / usable shelf / body rejected", () => {
    const p = verifiedBase();
    assert.ok(p.racks[0]);
    const body = p.racks[0]!;
    const attacks: RackAttack[] = [
      { shelves: -1 },
      { shelves: 3.7 },
      { shelves: 10_000 },
      { usableShelfWidthM: 0 },
      { usableShelfDepthM: 0 },
      { usableShelfWidthM: body.widthM + 1 },
      { usableShelfDepthM: body.depthM + 1 },
      { widthM: 0 },
      { depthM: -1 },
      { heightM: 0 },
      { rotationDeg: 45 },
      { x: Number.NaN },
    ];
    for (const extra of attacks) {
      const racks = p.racks.map((r, i) => (i === 0 ? { ...r, ...extra } : r));
      const res = applyPatchValidated(p, { racks }, catalogs);
      assert.equal(res.ok, false, JSON.stringify(extra));
    }
  });
});

type RackAttack = Record<string, number>;

describe("QX02B-R5-G imported ASIC primitives", () => {
  it("invalid imported spec cannot become Engineering source", () => {
    const p = verifiedBase();
    const imported = structuredClone(TEST_ASIC_A);
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24, imported };
    assert.equal(validateCanonicalProjectDomains(p, catalogs).ok, true);
    const attacks: Array<(a: typeof imported) => void> = [
      (a) => {
        a.hashrateThs = -1;
      },
      (a) => {
        a.typicalPowerW = 0;
      },
      (a) => {
        a.designPowerW = -10;
      },
      (a) => {
        a.voltageMin = 400;
        a.voltageMax = 200;
      },
      (a) => {
        a.widthM = 0;
      },
      (a) => {
        a.weightKg = -1;
      },
      (a) => {
        a.manufacturerAirflowM3h = -5;
      },
    ];
    for (const attack of attacks) {
      const next = structuredClone(p);
      next.fleet.imported = structuredClone(TEST_ASIC_A);
      attack(next.fleet.imported!);
      assert.equal(validateCanonicalProjectDomains(next, catalogs).ok, false);
      assert.throws(() => parseProject(JSON.parse(JSON.stringify(next))));
    }
  });
});

describe("QX02B-R5-H all canonical ingress paths", () => {
  it("INGRESS-01 commit rejects invalid auxiliary", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const before = fp(live().project);
    const past = live().past.length;
    const ok = live().commit({ ...p, electrical: { ...p.electrical, auxiliaryW: -1 } }, "bad");
    assert.equal(ok, false);
    assert.equal(fp(live().project), before);
    assert.equal(live().past.length, past);
    assert.ok(live().lastMutationError);
  });

  it("INGRESS-02 loadProject rejects invalid ΔT", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const before = live().project.thermal.deltaTK;
    const hostile = structuredClone(p);
    hostile.thermal.deltaTK = 100;
    assert.equal(live().loadProject(hostile, false).ok, false);
    assert.equal(live().project.thermal.deltaTK, before);
  });

  it("INGRESS-03 parseProject / import JSON reject invalid friction", () => {
    const p = verifiedBase();
    const hostile = structuredClone(p);
    hostile.ventilation.components = hostile.ventilation.components.map((c, i) =>
      i === 0 ? { ...c, frictionFactor: -1 } : c,
    );
    assert.throws(() => parseProject(JSON.parse(JSON.stringify(hostile))));
    assert.throws(() => importProjectJson(JSON.stringify(hostile)));
  });

  it("INGRESS-04 applyPatchValidated rejects invalid fan count", () => {
    const p = verifiedBase();
    const fans = p.fans.map((f, i) => (i === 0 ? { ...f, count: 0 } : f));
    const res = applyPatchValidated(p, { fans }, catalogs);
    assertRejected(res, p, res.project, "fan count 0");
  });

  it("INGRESS-05 applyProposed rejects invalid aisle", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const before = live().project.constraints.minAisleM;
    live().propose({
      id: "aisle",
      summary: "neg aisle",
      detail: "",
      patch: { constraints: { minAisleM: -1 } },
      fromGrok: true,
    });
    assert.equal(live().applyProposed().ok, false);
    assert.equal(live().project.constraints.minAisleM, before);
  });

  it("INGRESS-06 solveForTarget never emits invalid ΔT or power", () => {
    const p = verifiedBase();
    const solved = solveForTarget(p, catalogs, 10_000);
    assert.equal(validateCanonicalProjectDomains(solved.project, catalogs).ok, true);
    assert.ok(solved.project.thermal.deltaTK >= MIN_DELTA_T_K);
    assert.ok(solved.project.thermal.deltaTK <= MAX_DELTA_T_K);
    if (solved.project.electrical.known) {
      assert.ok(solved.project.electrical.availablePowerW <= MAX_AVAILABLE_POWER_W);
    }
    for (const step of solved.steps) {
      const applied = applyPatchValidated(p, step.patch, catalogs);
      assert.equal(applied.ok, true, step.id);
    }
  });

  it("INGRESS-07 setPower rejects invalid reserve", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const before = live().project.electrical.reservePct;
    const r = live().setPower(p.electrical.availablePowerW, 95);
    assert.equal(r.ok, false);
    assert.equal(live().project.electrical.reservePct, before);
  });

  it("INGRESS-08 setRoomHeight still fail-closed and domain-complete", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const h = live().project.room.heightM;
    assert.equal(live().setRoomHeight(0.2).ok, false);
    assert.equal(live().project.room.heightM, h);
    assert.equal(live().setRoomHeight(2.8).ok, true);
  });

  it("INGRESS extra: setFleet / setRackAsicCount / persisted restore", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    assert.equal(live().setFleet(TEST_ASIC_A.id, -1).ok, false);
    assert.equal(live().project.fleet.requestedCount, 24);
    if (live().project.racks[0]) {
      assert.equal(live().setRackAsicCount(live().project.racks[0].id, 3.7).ok, false);
    }
    const json = JSON.stringify(p);
    const restored = parseProject(JSON.parse(json));
    assert.equal(validateCanonicalProjectDomains(restored, catalogs).ok, true);
    assert.equal(live().loadProject(restored, false).ok, true);
  });
});

describe("UPGRADE-01 no invalid ΔT / power proposals", () => {
  it("every generated option is domain-valid", () => {
    const p = verifiedBase();
    const opts = generateUpgradeOptions(p, catalogs);
    assert.ok(opts.length > 0);
    for (const o of opts) {
      const applied = applyPatchValidated(p, o.patch, catalogs);
      assert.equal(applied.ok, true, o.id);
      if (o.patch.thermal?.deltaTK != null) {
        assert.ok(o.patch.thermal.deltaTK >= MIN_DELTA_T_K);
        assert.ok(o.patch.thermal.deltaTK <= MAX_DELTA_T_K);
      }
      if (o.patch.electrical?.availablePowerW != null) {
        assert.ok(o.patch.electrical.availablePowerW <= MAX_AVAILABLE_POWER_W);
      }
      if (o.patch.fans) {
        for (const f of o.patch.fans) {
          assert.ok(f.count >= 1 && f.count <= MAX_FAN_GROUP_COUNT);
        }
      }
    }
  });
});

describe("AUX-01 auxiliary fields do not reject valid projects", () => {
  it("demo / empty / outdoorTempC extremes that are finite still load", () => {
    const empty = emptyRectangularProject();
    assert.equal(empty.electrical.known, false);
    assert.equal(parseProject(JSON.parse(JSON.stringify(empty))).electrical.known, false);
    const farm = undergroundParkingFarm();
    const parsed = parseProject(JSON.parse(JSON.stringify(farm)));
    assert.equal(validateCanonicalProjectDomains(parsed, catalogs).ok, true);
    const warm = structuredClone(farm);
    warm.thermal.outdoorTempC = 45;
    warm.thermal.intakeTempC = 40;
    warm.ventilation.outdoorTempC = 45;
    assert.equal(validateCanonicalProjectDomains(warm, catalogs).ok, true);
    assert.equal(parseProject(JSON.parse(JSON.stringify(warm))).thermal.outdoorTempC, 45);
    const fixture = inventoryCompletenessFixture();
    assert.equal(validateCanonicalProjectDomains(fixture, catalogs).ok, true);
  });
});

describe("METAMORPHIC invalid numeric never raises SAFE", () => {
  it("inject one invalid SAFETY_DRIVING field at a time", () => {
    const p = verifiedBase();
    live().loadProject(p, false);
    const baseFp = fp(live().project);
    const baseSafe = live().result.capacity.safe ?? 0;
    const baseVerified = live().result.capacity.verified;
    const driving = SAFETY_NUMERIC_INVENTORY.filter((e) => e.class === "SAFETY_DRIVING");
    const fixture = inventoryCompletenessFixture();
    for (const row of driving) {
      let hostile: Project;
      try {
        hostile = applyInventoryInvalid(fixture, row.path, row.invalid);
      } catch {
        continue;
      }
      const domains = validateCanonicalProjectDomains(hostile, catalogs);
      assert.equal(domains.ok, false, row.path);
      live().loadProject(p, false);
      const loaded = live().loadProject(hostile, false);
      assert.equal(loaded.ok, false, row.path);
      assert.equal(fp(live().project), baseFp, row.path);
      assert.equal(live().result.capacity.safe ?? 0, baseSafe, row.path);
      assert.equal(live().result.capacity.verified, baseVerified, row.path);
    }
  });
});

describe("REG-01 previous QX-02B-R factory still canonical", () => {
  it("verifiedBase and unknown-electrical empty project still parse", () => {
    const p = verifiedBase();
    assert.equal(validateCanonicalProjectDomains(p, catalogs).ok, true);
    const empty = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    assert.equal(empty.electrical.availablePowerW, 0);
    assert.equal(validateCanonicalProjectDomains(empty, catalogs).ok, true);
  });

  it("exhaust widthM=0 still loads (Engineering INCOMPLETE, not domain reject)", () => {
    const p = verifiedBase();
    const exhaust = p.openings.find((o) => o.type === "EXHAUST");
    assert.ok(exhaust);
    exhaust!.widthM = 0;
    assert.equal(validateCanonicalProjectDomains(p, catalogs).ok, true);
    live().loadProject(verifiedBase(), false);
    assert.equal(live().loadProject(p, false).ok, true);
    assert.equal(live().project.openings.find((o) => o.type === "EXHAUST")?.widthM, 0);
    assert.notEqual(live().result.capacity.safety, "VERIFIED");
    assert.equal(live().result.capacity.verified, false);
  });
});
