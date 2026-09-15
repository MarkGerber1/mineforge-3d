import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ASIC_S21_PRO, TEST_ASIC_A } from "../../equipment/asic-catalog.ts";
import {
  emptyRectangularProject,
  officialTestAsicA,
  TEST_RACK_A,
  verifiedAcceptanceProject,
} from "../../project/factory.ts";
import { parseProject } from "../../project/schema.ts";
import { saveScheduler } from "../../project/save-scheduler.ts";
import { useProjectStore } from "../../project/store.ts";
import { asicTrustDecision, deriveImportedAsic, grokImportedAsic, trustedCatalogMatch } from "../asic-trust.ts";
import { HUD_SAFETY_LABEL_RU } from "../capacity.ts";
import { defaultCatalogs } from "../catalogs.ts";
import { aabbOverlap } from "../geometry.ts";
import { calculateAll } from "../pipeline.ts";
import { SERVICE_ENVELOPE_RU, validateRackPlacement } from "../placement.ts";
import { analyzeRacks, frontServiceAabb, rackAsicCapacity, rearServiceAabb } from "../racks.ts";
import { geometryFingerprint } from "../reality.ts";
import type { AsBuiltObject, AsicSpec, Opening, Project, Rack } from "../types.ts";

saveScheduler.setSave(async () => undefined);

const catalogs = defaultCatalogs();

function live() {
  return useProjectStore.getState();
}

function rackAt(x: number, y: number, id = "r1", extra: Partial<Rack> = {}): Rack {
  return {
    id,
    name: id,
    ...TEST_RACK_A,
    x,
    y,
    rotationDeg: 0,
    asicCount: 0,
    airflowToward: "south",
    ...extra,
  };
}

function southDoor(): Opening {
  return {
    id: "door_s",
    type: "DOOR",
    wallId: "south",
    widthM: 1,
    heightM: 2.1,
    bottomElevationM: 0,
    offsetFromWallStartM: 2,
    name: "Door",
  };
}

function column(partial: Partial<AsBuiltObject> & Pick<AsBuiltObject, "id" | "x" | "y">): AsBuiltObject {
  return {
    kind: "column",
    name: partial.id,
    z: 0,
    widthM: 0.3,
    heightM: 2.0,
    depthM: 0.3,
    provenance: "USER_CONFIRMED",
    confidence: "HIGH",
    ...partial,
  };
}

function roomWithRack(rack: Rack, extra: Partial<Project> = {}): Project {
  const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
  p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
  p.racks = [rack];
  p.constraints.frontServiceClearanceM = 0.8;
  p.constraints.rearServiceClearanceM = 0.6;
  p.constraints.minAisleM = 0;
  Object.assign(p, extra);
  if (extra.reality) p.reality = extra.reality;
  return p;
}

function perRack(): number {
  return rackAsicCapacity(
    { id: "t", name: "t", ...TEST_RACK_A, x: 0, y: 0, rotationDeg: 0, asicCount: 0, airflowToward: "south" },
    TEST_ASIC_A,
  );
}

function notVerifiedHud(safety: string): void {
  assert.notEqual(safety, "VERIFIED");
  assert.notEqual(HUD_SAFETY_LABEL_RU[safety as keyof typeof HUD_SAFETY_LABEL_RU], "ПРОВЕРЕНО");
}

function useImported(p: Project, asic: AsicSpec): Project {
  p.fleet = { ...p.fleet, asicId: asic.id, imported: asic };
  return p;
}

describe("SE-01 column only inside FRONT service zone", () => {
  it("rack blocked, usableCapacity 0, CRITICAL, not VERIFIED", () => {
    const rack = rackAt(3, 2, "a");
    const front = frontServiceAabb(rack, 0.8)!;
    const p = roomWithRack(rack, {
      reality: {
        photos: [],
        videos: [],
        findings: [],
        compareMode: "as-built",
        interview: [],
        asBuilt: [
          column({
            id: "col-front",
            x: (front.x1 + front.x2) / 2 - 0.15,
            y: (front.y1 + front.y2) / 2 - 0.15,
          }),
        ],
      },
    });
    const analyzed = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(analyzed.collisions.length, 0);
    assert.equal(analyzed.asBuiltHits.length, 0);
    assert.ok(analyzed.clearanceHits.some((h) => h.id === "a" && h.reason.includes("front service") && h.reason.includes("as-built")));
    assert.equal(analyzed.perRackCapacity[0]!.blocked, true);
    assert.equal(analyzed.usableCapacity, 0);
    const r = calculateAll(p, catalogs);
    assert.ok(r.warnings.some((w) => w.severity === "CRITICAL"));
    assert.equal(r.capacity.verified, false);
    notVerifiedHud(r.capacity.safety);
  });
});

describe("SE-02 AsBuilt only inside REAR service zone", () => {
  it("same blocked consequence", () => {
    const rack = rackAt(3, 2, "a");
    const rear = rearServiceAabb(rack, 0.6)!;
    const p = roomWithRack(rack, {
      reality: {
        photos: [],
        videos: [],
        findings: [],
        compareMode: "as-built",
        interview: [],
        asBuilt: [
          column({
            id: "col-rear",
            x: (rear.x1 + rear.x2) / 2 - 0.15,
            y: (rear.y1 + rear.y2) / 2 - 0.15,
          }),
        ],
      },
    });
    const analyzed = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(analyzed.asBuiltHits.length, 0);
    assert.ok(analyzed.clearanceHits.some((h) => h.id === "a" && h.reason.includes("rear service")));
    assert.equal(analyzed.usableCapacity, 0);
    const r = calculateAll(p, catalogs);
    assert.ok(r.warnings.some((w) => w.severity === "CRITICAL"));
    assert.equal(r.capacity.verified, false);
  });
});

describe("SE-03 door swing crosses FRONT service only", () => {
  it("body clear, service blocked", () => {
    const rack = rackAt(2, 1.05, "a");
    const p = roomWithRack(rack);
    p.openings = [southDoor()];
    assert.equal(aabbOverlap({ x1: 2, y1: 0, x2: 3, y2: 1 }, { x1: rack.x, y1: rack.y, x2: rack.x + rack.widthM, y2: rack.y + rack.depthM }), 0);
    const analyzed = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(analyzed.doorHits.length, 0);
    assert.ok(analyzed.clearanceHits.some((h) => h.reason.includes("front service") && h.reason.includes("door swing")));
    assert.equal(analyzed.usableCapacity, 0);
    const r = calculateAll(p, catalogs);
    assert.ok(r.warnings.some((w) => w.severity === "CRITICAL"));
    assert.notEqual(r.capacity.safety, "VERIFIED");
  });
});

describe("SE-04 door swing crosses REAR service only", () => {
  it("north-facing rear toward south door", () => {
    const rack = rackAt(2, 1.05, "a", { airflowToward: "north" });
    const p = roomWithRack(rack);
    p.openings = [southDoor()];
    const analyzed = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(analyzed.doorHits.length, 0);
    assert.ok(analyzed.clearanceHits.some((h) => h.reason.includes("rear service") && h.reason.includes("door swing")));
    assert.equal(analyzed.usableCapacity, 0);
  });
});

describe("SE-05 AsBuilt fully above vertical service volume", () => {
  it("does not block", () => {
    const rack = rackAt(3, 2, "a");
    const front = frontServiceAabb(rack, 0.8)!;
    const p = roomWithRack(rack, {
      reality: {
        photos: [],
        videos: [],
        findings: [],
        compareMode: "as-built",
        interview: [],
        asBuilt: [
          column({
            id: "above",
            x: (front.x1 + front.x2) / 2 - 0.15,
            y: (front.y1 + front.y2) / 2 - 0.15,
            z: rack.heightM,
            heightM: 0.4,
          }),
        ],
      },
    });
    const analyzed = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(analyzed.clearanceHits.filter((h) => h.reason.includes("as-built")).length, 0);
    assert.equal(analyzed.perRackCapacity[0]!.blocked, false);
    assert.equal(analyzed.usableCapacity, perRack());
  });
});

describe("SE-06 obstacle touches service-zone boundary exactly", () => {
  it("accepted", () => {
    const rack = rackAt(3, 2, "a");
    const front = frontServiceAabb(rack, 0.8)!;
    const p = roomWithRack(rack, {
      reality: {
        photos: [],
        videos: [],
        findings: [],
        compareMode: "as-built",
        interview: [],
        asBuilt: [
          column({
            id: "touch",
            x: (front.x1 + front.x2) / 2 - 0.15,
            y: front.y1 - 0.3,
            widthM: 0.3,
            depthM: 0.3,
          }),
        ],
      },
    });
    const analyzed = analyzeRacks(p, TEST_ASIC_A);
    assert.equal(analyzed.clearanceHits.length, 0);
    assert.equal(analyzed.usableCapacity, perRack());
  });
});

describe("SE-07 obstacle intrudes 1 mm into service zone", () => {
  it("BLOCKED", () => {
    const rack = rackAt(3, 2, "a");
    const front = frontServiceAabb(rack, 0.8)!;
    const p = roomWithRack(rack, {
      reality: {
        photos: [],
        videos: [],
        findings: [],
        compareMode: "as-built",
        interview: [],
        asBuilt: [
          column({
            id: "1mm",
            x: (front.x1 + front.x2) / 2 - 0.15,
            y: front.y1 - 0.3 + 0.001,
            widthM: 0.3,
            depthM: 0.3,
          }),
        ],
      },
    });
    const analyzed = analyzeRacks(p, TEST_ASIC_A);
    assert.ok(analyzed.clearanceHits.some((h) => h.reason.includes("front service")));
    assert.equal(analyzed.usableCapacity, 0);
  });
});

describe("SE-08 direct 3D move into service conflict", () => {
  it("mutation REJECT, canonical and history unchanged", () => {
    const start = rackAt(3, 2.4, "a");
    const p = roomWithRack(start, {
      reality: {
        photos: [],
        videos: [],
        findings: [],
        compareMode: "as-built",
        interview: [],
        asBuilt: [column({ id: "block", x: 3.2, y: 1.25 })],
      },
    });
    live().loadProject(p, false);
    const beforeFp = geometryFingerprint(live().project);
    const past = live().past.length;
    const beforeY = live().project.racks[0]!.y;
    const res = live().moveRack("a", 3, 2.0, false);
    assert.equal(res.ok, false);
    assert.ok(res.errors.includes(SERVICE_ENVELOPE_RU));
    assert.equal(live().project.racks[0]!.y, beforeY);
    assert.equal(geometryFingerprint(live().project), beforeFp);
    assert.equal(live().past.length, past);
  });
});

describe("SE-09 add AsBuilt AFTER an already-valid rack", () => {
  it("canonical AsBuilt stays; Engineering CRITICAL; usableCapacity 0", () => {
    const rack = rackAt(3, 2, "a", { asicCount: 4 });
    const p = roomWithRack(rack);
    live().loadProject(p, false);
    assert.equal(analyzeRacks(live().project, TEST_ASIC_A).usableCapacity, perRack());
    const front = frontServiceAabb(rack, 0.8)!;
    live().addAsBuilt(
      column({
        id: "late",
        x: (front.x1 + front.x2) / 2 - 0.15,
        y: (front.y1 + front.y2) / 2 - 0.15,
      }),
    );
    assert.equal(live().project.reality?.asBuilt.some((o) => o.id === "late"), true);
    const analyzed = analyzeRacks(live().project, TEST_ASIC_A);
    assert.equal(analyzed.usableCapacity, 0);
    assert.ok(live().result.warnings.some((w) => w.severity === "CRITICAL"));
    assert.equal(live().result.capacity.verified, false);
    notVerifiedHud(live().result.capacity.safety);
  });
});

describe("SE-10 remove blocking AsBuilt", () => {
  it("rack usable again", () => {
    const rack = rackAt(3, 2, "a");
    const front = frontServiceAabb(rack, 0.8)!;
    const p = roomWithRack(rack, {
      reality: {
        photos: [],
        videos: [],
        findings: [],
        compareMode: "as-built",
        interview: [],
        asBuilt: [
          column({
            id: "late",
            x: (front.x1 + front.x2) / 2 - 0.15,
            y: (front.y1 + front.y2) / 2 - 0.15,
          }),
        ],
      },
    });
    live().loadProject(p, false);
    assert.equal(analyzeRacks(live().project, TEST_ASIC_A).usableCapacity, 0);
    live().select(["late"]);
    const del = live().deleteSelected();
    assert.equal(del.ok, true);
    assert.equal((live().project.reality?.asBuilt ?? []).length, 0);
    const analyzed = analyzeRacks(live().project, TEST_ASIC_A);
    assert.equal(analyzed.usableCapacity, perRack());
    assert.equal(analyzed.perRackCapacity[0]!.blocked, false);
  });
});

describe("SE-11 existing narrow-aisle tests remain green", () => {
  it("facing gap below minAisleM still blocks", () => {
    const p = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    p.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    p.constraints.frontServiceClearanceM = 0.2;
    p.constraints.rearServiceClearanceM = 0;
    p.constraints.minAisleM = 1.0;
    p.racks = [rackAt(2, 1, "a", { airflowToward: "north" }), rackAt(2, 2.1, "b", { airflowToward: "south" })];
    const r = analyzeRacks(p, TEST_ASIC_A);
    assert.ok(r.clearanceHits.some((h) => h.reason.includes("Aisle")));
    assert.equal(r.usableCapacity, 0);
  });
});

describe("SE-12 existing wall service-envelope tests remain green", () => {
  it("front service flush with wall accepted; service outside room blocked", () => {
    const wall = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    wall.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    wall.constraints.frontServiceClearanceM = 0.8;
    wall.constraints.rearServiceClearanceM = 0;
    wall.constraints.minAisleM = 0;
    wall.racks = [rackAt(3, 0.8, "flush", { airflowToward: "south" })];
    assert.equal(analyzeRacks(wall, TEST_ASIC_A).clearanceHits.length, 0);
    const outside = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    outside.fleet = { asicId: TEST_ASIC_A.id, requestedCount: 24 };
    outside.constraints.frontServiceClearanceM = 0.8;
    outside.constraints.rearServiceClearanceM = 0;
    outside.constraints.minAisleM = 0;
    outside.racks = [rackAt(3, 0.5, "short", { airflowToward: "south" })];
    assert.ok(analyzeRacks(outside, TEST_ASIC_A).clearanceHits.length > 0);
  });
});

describe("TRUST-IMPORT-01 arbitrary JSON OFFICIAL_VERIFIED", () => {
  it("not final-safe", () => {
    const p = verifiedAcceptanceProject();
    const fake: AsicSpec = {
      ...TEST_ASIC_A,
      id: "forged-official",
      manufacturer: "FORGED CO",
      model: "FAKE-1",
      source: { label: "forged json", url: "https://evil.example/spec", trust: "OFFICIAL_VERIFIED" },
    };
    useImported(p, fake);
    const parsed = parseProject(JSON.parse(JSON.stringify(p)));
    assert.equal(parsed.fleet.imported?.source.trust, "OFFICIAL_VERIFIED");
    const r = calculateAll(parsed, catalogs);
    assert.equal(r.asicTrust.finalSafeEligible, false);
    assert.equal(r.capacity.verified, false);
    assert.ok(r.capacity.confidence === "PRELIMINARY" || r.capacity.confidence === "CRITICAL" || r.capacity.confidence === "INCOMPLETE");
  });
});

describe("TRUST-IMPORT-02 VERIFIED_SECONDARY JSON claim", () => {
  it("not final-safe", () => {
    const p = verifiedAcceptanceProject();
    const fake: AsicSpec = {
      ...TEST_ASIC_A,
      id: "forged-secondary",
      manufacturer: "FORGED CO",
      model: "FAKE-2",
      source: { label: "forged json", trust: "VERIFIED_SECONDARY" },
    };
    useImported(p, fake);
    const r = calculateAll(p, catalogs);
    assert.equal(r.asicTrust.finalSafeEligible, false);
    assert.equal(r.capacity.verified, false);
  });
});

describe("TRUST-IMPORT-03 spoof catalog id, change designPowerW", () => {
  it("NOT trusted", () => {
    const p = verifiedAcceptanceProject();
    const spoof: AsicSpec = {
      ...ASIC_S21_PRO,
      designPowerW: ASIC_S21_PRO.designPowerW + 50,
      source: { ...ASIC_S21_PRO.source, trust: "OFFICIAL_VERIFIED" },
    };
    useImported(p, spoof);
    assert.equal(trustedCatalogMatch(spoof, ASIC_S21_PRO), false);
    const r = calculateAll(p, catalogs);
    assert.equal(r.asicTrust.finalSafeEligible, false);
    assert.equal(deriveImportedAsic(spoof).source.trust, "USER_ENTERED");
  });
});

describe("TRUST-IMPORT-04 spoof catalog id, change voltage", () => {
  it("NOT trusted", () => {
    const p = verifiedAcceptanceProject();
    const spoof: AsicSpec = {
      ...ASIC_S21_PRO,
      voltageMin: 100,
      voltageMax: 120,
      source: { ...ASIC_S21_PRO.source, trust: "OFFICIAL_VERIFIED" },
    };
    useImported(p, spoof);
    const r = calculateAll(p, catalogs);
    assert.equal(r.asicTrust.finalSafeEligible, false);
  });
});

describe("TRUST-IMPORT-05 spoof model/manufacturer/url only", () => {
  it("NOT trusted", () => {
    const p = verifiedAcceptanceProject();
    const spoof: AsicSpec = {
      ...ASIC_S21_PRO,
      manufacturer: "Not Bitmain",
      model: "Not S21 Pro",
      source: { label: "mirror", url: "https://evil.example/s21", trust: "OFFICIAL_VERIFIED" },
    };
    useImported(p, spoof);
    const r = calculateAll(p, catalogs);
    assert.equal(r.asicTrust.finalSafeEligible, false);
  });
});

describe("TRUST-IMPORT-06 exact trusted catalog match rebinds", () => {
  it("catalog authority may remain final-safe", () => {
    const p = verifiedAcceptanceProject();
    const clone: AsicSpec = {
      ...ASIC_S21_PRO,
      source: { label: "copied", url: "https://mirror.example", trust: "USER_ENTERED" },
    };
    useImported(p, clone);
    const derived = deriveImportedAsic(clone);
    assert.equal(derived.source.trust, "OFFICIAL_VERIFIED");
    assert.equal(derived.id, ASIC_S21_PRO.id);
    const r = calculateAll(p, catalogs);
    assert.equal(r.asicTrust.finalSafeEligible, true);
    assert.equal(r.asicTrust.level, "OFFICIAL_VERIFIED");
    assert.equal(r.capacity.verified, true);
  });
});

describe("TRUST-IMPORT-07 exact match, JSON claims different trust", () => {
  it("catalog trust wins in Engineering result; stored JSON unchanged", () => {
    const p = verifiedAcceptanceProject();
    const clone: AsicSpec = {
      ...ASIC_S21_PRO,
      source: { ...ASIC_S21_PRO.source, trust: "ESTIMATED", label: "owner json" },
    };
    useImported(p, clone);
    assert.equal(p.fleet.imported?.source.trust, "ESTIMATED");
    const r = calculateAll(p, catalogs);
    assert.equal(r.asicTrust.level, "OFFICIAL_VERIFIED");
    assert.equal(r.asicTrust.finalSafeEligible, true);
    assert.equal(p.fleet.imported?.source.trust, "ESTIMATED");
  });
});

describe("TRUST-IMPORT-08 save/reload USER_ENTERED", () => {
  it("does not become OFFICIAL_VERIFIED", () => {
    const p = verifiedAcceptanceProject();
    const asic = officialTestAsicA({ source: { label: "owner", trust: "USER_ENTERED" } });
    useImported(p, asic);
    const round = parseProject(JSON.parse(JSON.stringify(p)));
    assert.equal(round.fleet.imported?.source.trust, "USER_ENTERED");
    const r = calculateAll(round, catalogs);
    assert.equal(r.asicTrust.finalSafeEligible, false);
    assert.notEqual(r.asicTrust.level, "OFFICIAL_VERIFIED");
  });
});

describe("TRUST-IMPORT-09 loadProject forged imported ASIC", () => {
  it("Engineering result is not VERIFIED from raw trust claim", () => {
    const p = verifiedAcceptanceProject();
    const fake: AsicSpec = {
      ...TEST_ASIC_A,
      id: "load-forged",
      manufacturer: "FORGED CO",
      model: "LOAD-FAKE",
      source: { label: "disk", trust: "OFFICIAL_VERIFIED" },
    };
    useImported(p, fake);
    live().loadProject(verifiedAcceptanceProject(), false);
    const loaded = live().loadProject(p, false);
    assert.equal(loaded.ok, true);
    assert.equal(live().project.fleet.imported?.source.trust, "OFFICIAL_VERIFIED");
    assert.equal(live().result.asicTrust.finalSafeEligible, false);
    assert.equal(live().result.capacity.verified, false);
  });
});

describe("TRUST-IMPORT-10 Grok fake official trust remains downgraded", () => {
  it("AI_FOUND_UNVERIFIED", () => {
    const hostile: AsicSpec = {
      ...TEST_ASIC_A,
      id: "grok-forged",
      manufacturer: "FORGED CO",
      model: "GROK-FAKE",
      source: { label: "spoof", trust: "OFFICIAL_VERIFIED" },
    };
    assert.equal(grokImportedAsic(hostile).source.trust, "AI_FOUND_UNVERIFIED");
    assert.equal(asicTrustDecision(hostile).finalSafeEligible, false);
    live().loadProject(verifiedAcceptanceProject(), false);
    live().propose({
      id: "spoof-asic-r12",
      summary: "official spoof",
      detail: "",
      patch: { fleet: { asicId: hostile.id, imported: hostile } },
      fromGrok: true,
    });
    assert.equal(live().applyProposed().ok, true);
    assert.equal(live().project.fleet.imported?.source.trust, "AI_FOUND_UNVERIFIED");
    assert.equal(live().result.capacity.verified, false);
    assert.equal(live().result.asicTrust.finalSafeEligible, false);
  });
});

describe("SAFE-E2E-01 front service AsBuilt on otherwise VERIFIED fixture", () => {
  it("verified false, CRITICAL, HUD != ПРОВЕРЕНО", () => {
    const p = verifiedAcceptanceProject();
    const baseline = calculateAll(p, catalogs);
    assert.equal(baseline.capacity.verified, true);
    const rack = p.racks[0]!;
    const front = frontServiceAabb(rack, p.constraints.frontServiceClearanceM)!;
    p.reality = {
      ...(p.reality ?? { photos: [], videos: [], findings: [], compareMode: "as-built", interview: [], asBuilt: [] }),
      asBuilt: [
        ...(p.reality?.asBuilt ?? []),
        column({
          id: "e2e-front",
          x: (front.x1 + front.x2) / 2 - 0.1,
          y: (front.y1 + front.y2) / 2 - 0.1,
          widthM: 0.2,
          depthM: 0.2,
          heightM: 1.2,
        }),
      ],
    };
    const r = calculateAll(p, catalogs);
    assert.equal(r.capacity.verified, false);
    assert.equal(r.capacity.safety, "CRITICAL");
    notVerifiedHud(r.capacity.safety);
  });
});

describe("SAFE-E2E-02 door swing service conflict on otherwise VERIFIED fixture", () => {
  it("verified false, CRITICAL", () => {
    const p = verifiedAcceptanceProject();
    const rack = p.racks.find((r) => r.airflowToward === "south") ?? p.racks[0]!;
    const front = frontServiceAabb(rack, p.constraints.frontServiceClearanceM)!;
    const swing = Math.min(front.y1 + 0.05, rack.y - 0.05);
    assert.ok(swing > 0 && swing < rack.y, "door swing must miss rack body");
    const door: Opening = {
      id: "e2e-door",
      type: "DOOR",
      wallId: "south",
      widthM: swing,
      heightM: 2.1,
      bottomElevationM: 0,
      offsetFromWallStartM: Math.max(0, Math.min(front.x1 + 0.05, p.room.widthM - swing)),
      name: "E2E door",
    };
    p.openings = [...p.openings, door];
    const r = calculateAll(p, catalogs);
    assert.equal(r.capacity.verified, false);
    assert.ok(r.warnings.some((w) => w.severity === "CRITICAL"));
    notVerifiedHud(r.capacity.safety);
  });
});

describe("SAFE-E2E-03 fake imported OFFICIAL_VERIFIED ASIC only", () => {
  it("PRELIMINARY, verified false, HUD != ПРОВЕРЕНО", () => {
    const p = verifiedAcceptanceProject();
    const fake: AsicSpec = {
      ...TEST_ASIC_A,
      id: "e2e-fake",
      manufacturer: "FORGED CO",
      model: "E2E-FAKE",
      source: { label: "json", trust: "OFFICIAL_VERIFIED" },
    };
    useImported(p, fake);
    const r = calculateAll(p, catalogs);
    assert.equal(r.asicTrust.finalSafeEligible, false);
    assert.ok(r.capacity.confidence === "PRELIMINARY" || r.capacity.confidence === "INCOMPLETE");
    assert.equal(r.capacity.verified, false);
    notVerifiedHud(r.capacity.safety);
  });
});

describe("SAFE-E2E-04 remove hostile condition restores VERIFIED", () => {
  it("only if all other constraints remain valid", () => {
    const p = verifiedAcceptanceProject();
    assert.equal(calculateAll(p, catalogs).capacity.verified, true);
    const rack = p.racks[0]!;
    const front = frontServiceAabb(rack, p.constraints.frontServiceClearanceM)!;
    const blocked = structuredClone(p);
    blocked.reality = {
      ...(blocked.reality ?? { photos: [], videos: [], findings: [], compareMode: "as-built", interview: [], asBuilt: [] }),
      asBuilt: [
        column({
          id: "tmp",
          x: (front.x1 + front.x2) / 2 - 0.1,
          y: (front.y1 + front.y2) / 2 - 0.1,
          widthM: 0.2,
          depthM: 0.2,
        }),
      ],
    };
    assert.equal(calculateAll(blocked, catalogs).capacity.verified, false);
    blocked.reality.asBuilt = [];
    const restored = calculateAll(blocked, catalogs);
    assert.equal(restored.capacity.verified, true);
    assert.equal(restored.capacity.safety, "VERIFIED");
    assert.equal(HUD_SAFETY_LABEL_RU.VERIFIED, "ПРОВЕРЕНО");
  });
});
