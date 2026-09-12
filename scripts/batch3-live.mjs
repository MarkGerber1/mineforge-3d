#!/usr/bin/env node
/**
 * Repair Batch 3 live acceptance against the running preview.
 * Scenarios A (beam XYZ), B (opening → vent/SAFE/undo), C (AI Reality).
 */
import { chromium } from "playwright";

const BASE = process.env.MF_LIVE_URL || "http://127.0.0.1:8080";

const results = [];
function rec(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector("[data-mf-id=workspace]", { timeout: 20000 });
  const continueBtn = page.getByRole("button", { name: "Продолжить текущий проект" });
  if (await continueBtn.isVisible().catch(() => false)) {
    await continueBtn.click();
  }

  await page.waitForFunction(() => Boolean(window.__MF_STORE__), { timeout: 15000 });

  await page.evaluate(() => {
    const store = window.__MF_STORE__;
    store.getState().dismissFirstRun();
    store.getState().setView("3d");
    store.getState().setMode("twin");
  });
  await page.waitForSelector("[data-mf-id=twin]", { timeout: 20000 });
  await page.waitForSelector("[data-mf-id=ceiling-toggle]", { timeout: 20000 });

  const ceiling = await page.evaluate(async () => {
    const store = window.__MF_STORE__;
    const el = document.querySelector("[data-mf-id=ceiling-toggle]");
    const h0 = el?.getAttribute("data-mf-ceiling");
    const vis0 = el?.getAttribute("data-mf-ceiling-visible");
    const src = store.getState().project;
    store.getState().commit({ ...src, room: { ...src.room, heightM: 2.45 } }, "Live ceiling 2.45");
    await new Promise((r) => setTimeout(r, 300));
    const el1 = document.querySelector("[data-mf-id=ceiling-toggle]");
    const h1 = el1?.getAttribute("data-mf-ceiling");
    if (el1) el1.click();
    await new Promise((r) => setTimeout(r, 150));
    const vis1 = document.querySelector("[data-mf-id=ceiling-toggle]")?.getAttribute("data-mf-ceiling-visible");
    return {
      h0,
      h1,
      vis0,
      vis1,
      heightM: store.getState().project.room.heightM,
      envelopeZ: store.getState().project.room.heightM,
    };
  });
  rec(
    "CEILING visual plane follows room.heightM; hide is visual-only",
    ceiling.h1 === "2.450" && ceiling.heightM === 2.45 && ceiling.vis0 === "1" && ceiling.vis1 === "0",
    JSON.stringify(ceiling),
  );


  const scenarioA = await page.evaluate(() => {
    const store = window.__MF_STORE__;
    const tmpl = {
      id: "r1",
      name: "R1",
      x: 1,
      y: 1,
      widthM: 1.6,
      depthM: 0.6,
      heightM: 2.0,
      rotationDeg: 0,
      shelves: 4,
      usableShelfWidthM: 1.5,
      usableShelfDepthM: 0.55,
      asicCount: 0,
      airflowToward: "south",
    };
    const empty = structuredClone(store.getState().project);
    empty.racks = [tmpl];
    empty.fleet = { ...empty.fleet, asicId: "TEST_ASIC_A", requestedCount: 24 };
    empty.electrical = { ...empty.electrical, availablePowerW: 500000, known: true };
    empty.reality = { photos: [], findings: [], asBuilt: [], compareMode: "as-built", interview: [] };
    empty.openings = empty.openings.filter((o) => o.type === "EXHAUST" || o.type === "DOOR");
    store.getState().loadProject(empty, false);
    const mkBeam = (z, heightM, id) => ({
      id,
      kind: "beam",
      name: "Beam",
      x: 1,
      y: 1,
      z,
      widthM: 1.6,
      depthM: 0.6,
      heightM,
      provenance: "USER_CONFIRMED",
      confidence: "HIGH",
    });
    store.getState().addAsBuilt(mkBeam(2.2, 0.3, "beam_above"));
    const above = store.getState().result;
    store.getState().undo();
    store.getState().addAsBuilt(mkBeam(1.7, 0.4, "beam_hit"));
    const hit = store.getState().result;
    return {
      aboveHits: above.racks.asBuiltHits.length,
      aboveBlocked: above.racks.perRackCapacity[0]?.blocked ?? null,
      hitHits: hit.racks.asBuiltHits.length,
      hitBlocked: hit.racks.perRackCapacity[0]?.blocked ?? null,
      usableAbove: above.racks.usableCapacity,
      usableHit: hit.racks.usableCapacity,
      safeAbove: above.capacity.safe,
      safeHit: hit.capacity.safe,
    };
  });
  rec(
    "SCENARIO A beam above no collide; lowered beam XYZ collide + SAFE",
    scenarioA.aboveHits === 0 &&
      scenarioA.hitHits >= 1 &&
      scenarioA.hitBlocked === true &&
      scenarioA.usableHit < scenarioA.usableAbove,
    JSON.stringify(scenarioA),
  );

  const scenarioB = await page.evaluate(() => {
    const store = window.__MF_STORE__;
    const p = structuredClone(store.getState().project);
    p.racks = [];
    p.electrical = { ...p.electrical, availablePowerW: 500000, known: true };
    p.fleet = { ...p.fleet, requestedCount: 30 };
    p.openings = p.openings.map((o) =>
      o.type === "EXHAUST" || o.type === "SHAFT_CONNECTION" ? { ...o, widthM: 0.6, heightM: 0.6 } : o,
    );
    p.reality = { photos: [], findings: [], asBuilt: [], compareMode: "as-designed", interview: [] };
    store.getState().loadProject(p, false);
    const before = store.getState().result;
    const ex = store.getState().project.openings.find((o) => o.type === "EXHAUST");
    store.getState().addFinding({
      id: "find_live_ex",
      kind: "shaft",
      summary: "Exhaust 1.20 × 1.00",
      confidence: "HIGH",
      status: "PENDING",
      opening: {
        id: "op_live_ex",
        type: "EXHAUST",
        wallId: ex.wallId,
        widthM: 1.2,
        heightM: 1.0,
        bottomElevationM: ex.bottomElevationM,
        offsetFromWallStartM: ex.offsetFromWallStartM,
        provenance: "PHOTO_ESTIMATE",
        sourceFindingId: "find_live_ex",
      },
    });
    const pendingOpenings = store.getState().project.openings.find((o) => o.type === "EXHAUST");
    store.getState().resolveFinding("find_live_ex", "ADDED");
    const after = store.getState().result;
    const afterOpen = store.getState().project.openings.find((o) => o.type === "EXHAUST");
    store.getState().undo();
    const undone = store.getState().result;
    const undoneOpen = store.getState().project.openings.find((o) => o.type === "EXHAUST");
    store.getState().redo();
    const redone = store.getState().result;
    return {
      pendingW: pendingOpenings.widthM,
      afterW: afterOpen.widthM,
      afterH: afterOpen.heightM,
      afterId: afterOpen.id,
      beforeId: ex.id,
      safe0: before.capacity.safe,
      safe1: after.capacity.safe,
      safeUndo: undone.capacity.safe,
      safeRedo: redone.capacity.safe,
      pa0: before.pressure.totalPa,
      pa1: after.pressure.totalPa,
      undoneW: undoneOpen.widthM,
    };
  });
  rec(
    "SCENARIO B opening 0.60×0.60 → 1.20×1.00 vent/SAFE; undo restores",
    scenarioB.pendingW === 0.6 &&
      scenarioB.afterW === 1.2 &&
      scenarioB.afterH === 1.0 &&
      scenarioB.afterId === scenarioB.beforeId &&
      scenarioB.safe1 > scenarioB.safe0 &&
      scenarioB.safeUndo === scenarioB.safe0 &&
      scenarioB.safeRedo === scenarioB.safe1 &&
      scenarioB.undoneW === 0.6,
    JSON.stringify(scenarioB),
  );

  const scenarioC = await page.evaluate(() => {
    const store = window.__MF_STORE__;
    const p = structuredClone(store.getState().project);
    p.openings = [];
    p.reality = { photos: [], findings: [], asBuilt: [], compareMode: "as-designed", interview: [] };
    store.getState().loadProject(p, false);
    store.getState().addFinding({
      id: "find_live_door",
      kind: "door",
      summary: "AI door",
      confidence: "HIGH",
      status: "PENDING",
      opening: {
        id: "op_live_door",
        type: "DOOR",
        wallId: "south",
        widthM: 1,
        heightM: 2.1,
        bottomElevationM: 0,
        offsetFromWallStartM: 0.4,
        provenance: "PHOTO_ESTIMATE",
        sourceFindingId: "find_live_door",
      },
    });
    const pendingN = store.getState().project.openings.length;
    const pendingKind = store.getState().project.reality.findings[0].kind;
    store.getState().resolveFinding("find_live_door", "ADDED");
    const added = store.getState().project.openings[0];
    store.getState().addFinding({
      id: "find_inc",
      kind: "beam",
      summary: "incomplete",
      confidence: "LOW",
      status: "PENDING",
      incomplete: true,
      missing: ["x", "y", "z"],
    });
    const asBuiltBefore = store.getState().project.reality.asBuilt.length;
    store.getState().resolveFinding("find_inc", "ADDED");
    const asBuiltAfter = store.getState().project.reality.asBuilt.length;
    const incStatus = store.getState().project.reality.findings.find((f) => f.id === "find_inc")?.status;
    return {
      pendingN,
      pendingKind,
      addedType: added?.type,
      addedW: added?.widthM,
      asBuiltBefore,
      asBuiltAfter,
      incStatus,
    };
  });
  rec(
    "SCENARIO C AI door PENDING then ADD as DOOR; incomplete fail-closed",
    scenarioC.pendingN === 0 &&
      scenarioC.pendingKind === "door" &&
      scenarioC.addedType === "DOOR" &&
      scenarioC.addedW === 1 &&
      scenarioC.asBuiltBefore === 0 &&
      scenarioC.asBuiltAfter === 0 &&
      scenarioC.incStatus === "PENDING",
    JSON.stringify(scenarioC),
  );
} catch (err) {
  rec("LIVE runner", false, err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
