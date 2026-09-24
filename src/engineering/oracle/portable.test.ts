import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { officialTestAsicA, emptyRectangularProject, verifiedAcceptanceProject } from "../../project/factory.ts";
import {
  MAX_BUNDLE_CHARS,
  PROJECT_IMPORT_ACCEPT,
  applyImportedRecords,
  attemptImport,
  buildPortableBundle,
  emptyPortableStore,
  isSupportedImageDataUrl,
  parsePortableBundle,
  prepareImport,
  reloadActiveProject,
  safeProjectFilename,
  stringifyPortableBundle,
} from "../../project/portable.ts";
import { asicTrustDecision, deriveImportedAsic } from "../asic-trust.ts";
import { defaultCatalogs } from "../catalogs.ts";
import { calculateAll } from "../pipeline.ts";
import { emptyReality, type Project, type RealityPhotoMeta } from "../types.ts";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const JPEG = `data:image/jpeg;base64,${Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]).toString("base64")}`;

function photo(extra: Partial<RealityPhotoMeta> = {}): RealityPhotoMeta {
  return {
    id: "PHOTO-01",
    name: "PHOTO-01.jpg",
    mime: "image/jpeg",
    createdAt: 1,
    notes: "scale only",
    wallHint: "north",
    widthPx: 960,
    heightPx: 1280,
    markers: [
      { id: "a", nx: 0.49, ny: 0.477, kind: "opening", label: "A", pairId: "b", provenance: "FIELD_MEASUREMENT" },
      { id: "b", nx: 0.55, ny: 0.477, kind: "opening", label: "B", pairId: "a", lengthM: 0.5, provenance: "FIELD_MEASUREMENT" },
    ],
    calibration: {
      scaleMPerPx: 0.008138020833333334,
      lengthM: 0.5,
      aId: "a",
      bId: "b",
      provenance: "FIELD_MEASUREMENT",
    },
    ...extra,
  };
}

function farmReal01(): Project {
  const project = emptyRectangularProject({ name: "FARM-REAL-01", widthM: 2.67, depthM: 4.6, heightM: 3.87 });
  project.id = "proj_farm_real_01";
  project.openings = [];
  project.racks = [];
  project.fans = [];
  project.fleet = { ...project.fleet, requestedCount: 0 };
  project.reality = {
    ...emptyReality(),
    photos: [photo()],
    findings: [
      {
        id: "N-OPEN-LOW-01",
        kind: "opening",
        summary: "offset missing",
        confidence: "HIGH",
        status: "PENDING",
        incomplete: true,
        missing: ["horizontal offset from WEST wall"],
        photoId: "PHOTO-01",
      },
    ],
  };
  return project;
}

function bundleText(project: Project, media: Record<string, string | null> = { "PHOTO-01": PNG }): string {
  return stringifyPortableBundle(buildPortableBundle(project, media, "2026-09-25T00:00:00.000Z"));
}

describe("PORT-A canonical project round-trip", () => {
  it("preserves room, empty canonical equipment, and does not add a wall registration", () => {
    const project = farmReal01();
    const parsed = parsePortableBundle(bundleText(project));
    assert.equal(parsed.project.id, "proj_farm_real_01");
    assert.equal(parsed.project.name, "FARM-REAL-01");
    assert.equal(parsed.project.room.widthM, 2.67);
    assert.equal(parsed.project.room.depthM, 4.6);
    assert.equal(parsed.project.room.heightM, 3.87);
    assert.equal(parsed.project.openings.length, 0);
    assert.equal(parsed.project.racks.length, 0);
    assert.equal(parsed.project.fans.length, 0);
    assert.equal(parsed.project.reality?.photos[0]?.wallRegistration, undefined);
    assert.equal(parsed.project.reality?.findings[0]?.status, "PENDING");
    assert.equal(parsed.project.reality?.findings[0]?.incomplete, true);
    assert.deepEqual(Object.keys(parsed).sort(), ["exportedAt", "formatVersion", "kind", "media", "missingMedia", "project"]);
  });
});

describe("PORT-B photo media round-trip", () => {
  it("keeps PHOTO-01 bytes, markers, and calibration", () => {
    assert.equal(isSupportedImageDataUrl(PNG), true);
    assert.equal(isSupportedImageDataUrl(JPEG), true);
    const parsed = parsePortableBundle(bundleText(farmReal01(), { "PHOTO-01": JPEG }));
    const shot = parsed.project.reality?.photos[0];
    assert.equal(parsed.media["PHOTO-01"], JPEG);
    assert.equal(parsed.missingMedia.length, 0);
    assert.equal(shot?.id, "PHOTO-01");
    assert.equal(shot?.wallHint, "north");
    assert.equal(shot?.calibration?.lengthM, 0.5);
    assert.equal(shot?.calibration?.provenance, "FIELD_MEASUREMENT");
    assert.equal(shot?.markers[1]?.lengthM, 0.5);
    assert.equal(shot?.wallRegistration, undefined);
  });

  it("preserves an existing wall registration and does not invent one", () => {
    const project = farmReal01();
    project.reality!.photos[0]!.wallRegistration = {
      wallId: "north",
      anchorNx: 0.5,
      wallOffsetM: 1.25,
      hDirection: 1,
      anchorNy: 0.4,
      elevationM: 1.85,
      vDirection: -1,
      provenance: "FIELD_MEASUREMENT",
    };
    const parsed = parsePortableBundle(bundleText(project));
    assert.equal(parsed.project.reality?.photos[0]?.wallRegistration?.wallOffsetM, 1.25);
    assert.equal(parsed.project.reality?.photos[0]?.wallRegistration?.provenance, "FIELD_MEASUREMENT");
  });

  it("lists a photo with no local bytes as missing and does not invent pixels", () => {
    const bundle = buildPortableBundle(farmReal01(), { "PHOTO-01": null });
    assert.deepEqual(bundle.missingMedia, ["PHOTO-01"]);
    assert.deepEqual(bundle.media, {});
  });
});

describe("PORT-C invalid JSON does not mutate the current project", () => {
  it("returns the same project object", () => {
    const current = emptyRectangularProject({ name: "keep", widthM: 8, depthM: 5, heightM: 2.8 });
    const snapshot = structuredClone(current);
    const attempt = attemptImport(current, "{", new Set());
    assert.equal(attempt.ok, false);
    assert.equal(attempt.collision, false);
    assert.equal(attempt.project, current);
    assert.deepEqual(current, snapshot);
    if (!attempt.ok && !attempt.collision) assert.match(attempt.error, /JSON/);
  });
});

describe("PORT-D invalid project schema is rejected", () => {
  it("does not accept a bundle whose project fails schema", () => {
    const current = emptyRectangularProject({ name: "keep" });
    const text = JSON.stringify({
      kind: "mineforge-project",
      formatVersion: 1,
      exportedAt: "2026-09-25T00:00:00.000Z",
      project: { schemaVersion: 1, id: "x", name: "bad" },
      media: {},
      missingMedia: [],
    });
    const attempt = attemptImport(current, text, new Set());
    assert.equal(attempt.ok, false);
    assert.equal(attempt.collision, false);
    assert.equal(attempt.project, current);
  });
});

describe("PORT-E unsupported bundle version is rejected", () => {
  it("rejects formatVersion 2", () => {
    const text = bundleText(farmReal01()).replace('"formatVersion":1', '"formatVersion":2');
    const attempt = attemptImport(emptyRectangularProject({ name: "keep" }), text, new Set());
    assert.equal(attempt.ok, false);
    if (!attempt.ok && !attempt.collision) assert.match(attempt.error, /версия/);
  });
});

describe("PORT-F media that is not a project photo is rejected", () => {
  it("rejects a foreign media id and an unsafe data URL", () => {
    const base = JSON.parse(bundleText(farmReal01())) as { media: Record<string, string> };
    base.media["not-in-project"] = PNG;
    const foreign = attemptImport(emptyRectangularProject({ name: "keep" }), JSON.stringify(base), new Set());
    assert.equal(foreign.ok, false);
    if (!foreign.ok && !foreign.collision) assert.match(foreign.error, /фото/);

    const svg = JSON.parse(bundleText(farmReal01())) as { media: Record<string, string> };
    svg.media["PHOTO-01"] = "data:image/svg+xml;base64,PHN2Zy8+";
    const unsafe = attemptImport(emptyRectangularProject({ name: "keep" }), JSON.stringify(svg), new Set());
    assert.equal(unsafe.ok, false);
    assert.equal(isSupportedImageDataUrl("data:text/html;base64,PGh0bWw+"), false);
  });
});

describe("PORT-G forged ASIC trust is not authority", () => {
  it("keeps OFFICIAL_VERIFIED as a claim and derives USER_ENTERED", () => {
    const project = emptyRectangularProject({ name: "forged", widthM: 8, depthM: 5, heightM: 2.8 });
    const imported = officialTestAsicA();
    project.fleet = { asicId: imported.id, requestedCount: 0, imported };
    const parsed = parsePortableBundle(bundleText(project, {}));
    assert.equal(parsed.project.fleet.imported?.source.trust, "OFFICIAL_VERIFIED");
    const derived = deriveImportedAsic(parsed.project.fleet.imported!);
    const decision = asicTrustDecision(derived);
    assert.equal(decision.level, "USER_ENTERED");
    assert.equal(decision.finalSafeEligible, false);
    assert.equal(calculateAll(parsed.project, defaultCatalogs()).capacity.verified, false);
  });
});

describe("PORT-H TEST_FIXTURE fan cannot become final-safe via import", () => {
  it("round-trips FAN_STRONG and stays ineligible", () => {
    const project = verifiedAcceptanceProject(24);
    const parsed = parsePortableBundle(stringifyPortableBundle(buildPortableBundle(project, {}, "2026-09-25T00:00:00.000Z")));
    const result = calculateAll(parsed.project, defaultCatalogs());
    assert.equal(result.fan.trust, "TEST_FIXTURE");
    assert.equal(result.fan.finalSafeEligible, false);
    assert.equal(result.capacity.verified, false);
  });
});

describe("PORT-I import then reload returns the same project", () => {
  it("writes lastId and reloads FARM-REAL-01 with PHOTO-01", () => {
    const parsed = parsePortableBundle(bundleText(farmReal01(), { "PHOTO-01": PNG }));
    const stored = applyImportedRecords(emptyPortableStore(), parsed.project, parsed.media);
    assert.equal(stored.lastId, "proj_farm_real_01");
    const reloaded = reloadActiveProject(stored);
    assert.ok(reloaded);
    assert.equal(reloaded?.name, "FARM-REAL-01");
    assert.equal(reloaded?.room.widthM, 2.67);
    assert.equal(reloaded?.room.depthM, 4.6);
    assert.equal(reloaded?.room.heightM, 3.87);
    assert.equal(reloaded?.racks.length, 0);
    assert.equal(stored.media["PHOTO-01"], PNG);
    assert.equal(reloaded?.reality?.photos[0]?.calibration?.lengthM, 0.5);
    assert.equal(reloaded?.reality?.photos[0]?.wallRegistration, undefined);
  });
});

describe("PORT-J existing project id is not silently overwritten", () => {
  it("requires replace or copy", () => {
    const current = farmReal01();
    current.name = "LOCAL";
    const incoming = bundleText(farmReal01());
    const ids = new Set(["proj_farm_real_01"]);
    const blocked = attemptImport(current, incoming, ids);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.collision, true);
    assert.equal(blocked.project, current);
    assert.equal(current.name, "LOCAL");

    const bundle = parsePortableBundle(incoming);
    const replaced = prepareImport(bundle, ids, "replace");
    assert.equal(replaced.project.id, "proj_farm_real_01");
    assert.equal(replaced.project.name, "FARM-REAL-01");

    const copied = prepareImport(bundle, ids, "copy");
    assert.notEqual(copied.project.id, "proj_farm_real_01");
    assert.match(copied.project.name, /\(импорт\)/);
    assert.equal(copied.project.room.widthM, 2.67);
    assert.equal(copied.project.room.depthM, 4.6);
    assert.equal(copied.project.room.heightM, 3.87);
    assert.notEqual(copied.project.reality?.photos[0]?.id, "PHOTO-01");
    assert.equal(copied.project.reality?.photos[0]?.calibration?.lengthM, 0.5);
    assert.equal(copied.media[copied.project.reality!.photos[0]!.id], PNG);
    assert.equal(current.name, "LOCAL");
  });
});

describe("PORT-K mobile file input contract", () => {
  it("exposes a 44px file input that accepts a portable bundle", () => {
    assert.equal(PROJECT_IMPORT_ACCEPT, ".mineforge.json,application/json");
    assert.equal(safeProjectFilename("FARM-REAL-01"), "FARM-REAL-01.mineforge.json");
    const ui = readFileSync(new URL("../../components/app/ProjectPortability.tsx", import.meta.url), "utf8");
    const mobile = readFileSync(new URL("../../components/app/MobileToolbar.tsx", import.meta.url), "utf8");
    assert.match(ui, /data-mf-id="project-import-file"/);
    assert.match(ui, /data-mf-id="project-export"/);
    assert.match(ui, /absolute inset-0/);
    assert.match(ui, /h-11/);
    assert.match(ui, /PROJECT_IMPORT_ACCEPT/);
    assert.match(mobile, /ProjectPortability/);
    assert.ok(MAX_BUNDLE_CHARS > 1_000_000);
  });

  it("rejects an oversized payload before parse", () => {
    const current = emptyRectangularProject({ name: "keep" });
    const attempt = attemptImport(current, "x".repeat(MAX_BUNDLE_CHARS + 1), new Set());
    assert.equal(attempt.ok, false);
    assert.equal(attempt.project, current);
    if (!attempt.ok && !attempt.collision) assert.match(attempt.error, /большой/);
  });
});
