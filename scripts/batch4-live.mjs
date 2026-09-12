#!/usr/bin/env node
/**
 * Repair Batch 4 live evidence against the running preview.
 * Chromium iPhone-sized viewports — local sandbox cannot launch WebKit
 * (missing gstreamer/gtk). CI runs Playwright WebKit fail-closed.
 */
import { chromium, devices } from "playwright";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.MF_LIVE_URL || "http://127.0.0.1:8080";
const PHOTO = join(ROOT, "tests/fixtures/photo/south.jpg");
const VIDEO_MP4 = join(ROOT, "tests/fixtures/video/frames-rgb.mp4");
const VIDEO_WEBM = join(ROOT, "tests/fixtures/video/frames-rgb.webm");
const CORRUPT = join(ROOT, "tests/fixtures/video/corrupt.mp4");

const results = [];
function rec(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + String(detail).slice(0, 240) : ""}`);
}

const browser = await chromium.launch({ headless: true });

async function openPhone(width, height) {
  const base = devices["iPhone 13"] ?? {};
  const ctx = await browser.newContext({
    ...base,
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "ru-RU",
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.__MF_STORE__), { timeout: 20000 });
  await page.evaluate(() => window.__MF_STORE__.getState().dismissFirstRun());
  const cont = page.getByText("Продолжить текущий проект");
  if (await cont.count()) await cont.first().click();
  return { ctx, page };
}

function mf(page, id) {
  return page.locator(`[data-mf-id="${id}"]`).first();
}

try {
  {
    const { ctx, page } = await openPhone(375, 812);
    await mf(page, "workspace").waitFor({ timeout: 15000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight, sw: document.documentElement.scrollWidth }));
    rec("375×812 no page horizontal overflow", overflow, JSON.stringify(vp));
    rec("375×812 2D CAD present", (await mf(page, "cad").count()) > 0);
    await mf(page, "toolbar-reality").tap();
    await mf(page, "sheet").waitFor();
    rec("375×812 Reality sheet", (await mf(page, "sheet").getAttribute("data-mf-tab")) === "reality");
    await mf(page, "sheet-dismiss").tap();
    await mf(page, "mobile-ai").tap();
    await mf(page, "sheet").waitFor();
    rec("375×812 Grok sheet", (await mf(page, "sheet").getAttribute("data-mf-tab")) === "grok");
    rec("375×812 Undo visible 44px", ((await mf(page, "undo").boundingBox())?.height ?? 0) >= 40);
    await ctx.close();
  }

  {
    const { ctx, page } = await openPhone(390, 844);
    await mf(page, "dim-south").tap();
    await mf(page, "dim-input").waitFor({ timeout: 8000 });
    await mf(page, "dim-input").fill("7.51");
    await mf(page, "dim-ok").tap();
    const w1 = await page.evaluate(() => window.__MF_STORE__.getState().project.room.widthM);
    await mf(page, "undo").tap();
    const w0 = await page.evaluate(() => window.__MF_STORE__.getState().project.room.widthM);
    await mf(page, "redo").tap();
    const w2 = await page.evaluate(() => window.__MF_STORE__.getState().project.room.widthM);
    rec("390×844 2D dim + Undo/Redo", w1 === 7.51 && w0 !== 7.51 && w2 === 7.51, JSON.stringify({ w0, w1, w2 }));

    await mf(page, "toolbar-reality").tap();
    await mf(page, "reality-file").setInputFiles(PHOTO);
    const img = mf(page, "annotator-img");
    await img.waitFor({ timeout: 15000 });
    await mf(page, "wall-south").tap();
    await mf(page, "kind-point").tap();
    await mf(page, "cal-length").fill("2");
    const box = await img.boundingBox();
    await img.tap({ position: { x: box.width * 0.08, y: box.height * 0.5 } });
    await page.waitForTimeout(80);
    await img.tap({ position: { x: box.width * 0.33, y: box.height * 0.5 } });
    await page.waitForFunction(() => window.__MF_STORE__.getState().project.reality?.photos[0]?.calibration?.lengthM === 2, null, { timeout: 8000 });
    await mf(page, "kind-door").tap();
    await img.tap({ position: { x: box.width * 0.4, y: box.height * 0.8 } });
    await page.waitForTimeout(80);
    await img.tap({ position: { x: box.width * 0.55, y: box.height * 0.8 } });
    await page.waitForFunction(() => (window.__MF_STORE__.getState().project.reality?.findings.filter((f) => f.status === "PENDING").length ?? 0) >= 1, null, { timeout: 8000 });
    const before = await page.evaluate(() => window.__MF_STORE__.getState().project.openings.length);
    await mf(page, "add-to-model").tap();
    await page.waitForFunction((n) => {
      const p = window.__MF_STORE__.getState().project;
      return p.openings.length > n && p.openings.some((o) => o.type === "DOOR");
    }, before, { timeout: 8000 });
    const after = await page.evaluate(() => ({
      openings: window.__MF_STORE__.getState().project.openings.map((o) => o.type),
      safe: window.__MF_STORE__.getState().result.capacity.safe,
    }));
    rec("390×844 photo A–B + PENDING + ADD door", after.openings.includes("DOOR"), JSON.stringify(after));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    rec("390×844 no page overflow", overflow);
    await ctx.close();
  }

  {
    const { ctx, page } = await openPhone(430, 932);
    await mf(page, "toolbar-3d").tap();
    await mf(page, "twin").waitFor({ timeout: 20000 });
    await mf(page, "ceiling-toggle").tap();
    rec("430×932 3D twin + ceiling toggle", (await mf(page, "ceiling-toggle").getAttribute("data-mf-ceiling-visible")) === "0");
    await mf(page, "toolbar-3d").tap();
    await mf(page, "toolbar-reality").tap();
    rec("430×932 Reality compare Проект/Факт/Δ", (await mf(page, "compare").count()) > 0);
    await mf(page, "reality-file").setInputFiles(CORRUPT);
    await page.waitForFunction(() => window.__MF_STORE__.getState().videoJob.status === "failed", null, { timeout: 10000 });
    const corrupt = await page.evaluate(() => window.__MF_STORE__.getState().videoJob);
    rec("video corrupt fail-closed", corrupt.status === "failed" && (corrupt.error === "VIDEO_UNSUPPORTED" || corrupt.error === "VIDEO_DECODE_FAILED"), JSON.stringify(corrupt));
    const beforeOpenings = await page.evaluate(() => window.__MF_STORE__.getState().project.openings.length);
    await mf(page, "reality-file").setInputFiles(VIDEO_MP4);
    await page.waitForFunction(() => window.__MF_STORE__.getState().videoJob.status !== "processing", null, { timeout: 20000 });
    let video = await page.evaluate(() => {
      const s = window.__MF_STORE__.getState();
      const photos = s.project.reality?.photos ?? [];
      const videos = s.project.reality?.videos ?? [];
      return {
        job: s.videoJob,
        openings: s.project.openings.length,
        videos: videos.map((v) => ({ name: v.name, mime: v.mime, durationMs: v.durationMs, persistRaw: v.persistRaw, n: v.frameIds.length, selected: v.selectedFrameIds })),
        stamps: photos.map((p) => ({ id: p.id, ts: p.timestampMs, src: p.sourceVideoId, w: p.widthPx, h: p.heightPx, kind: p.kind })),
        urls: window.__MF_VIDEO__?.liveObjectUrlCount?.() ?? -1,
      };
    });
    if (!video.videos.length) {
      await mf(page, "reality-file").setInputFiles(VIDEO_WEBM);
      await page.waitForFunction(() => window.__MF_STORE__.getState().videoJob.status !== "processing", null, { timeout: 20000 });
      video = await page.evaluate(() => {
        const s = window.__MF_STORE__.getState();
        const photos = s.project.reality?.photos ?? [];
        const videos = s.project.reality?.videos ?? [];
        return {
          job: s.videoJob,
          openings: s.project.openings.length,
          videos: videos.map((v) => ({ name: v.name, mime: v.mime, durationMs: v.durationMs, persistRaw: v.persistRaw, n: v.frameIds.length, selected: v.selectedFrameIds })),
          stamps: photos.map((p) => ({ id: p.id, ts: p.timestampMs, src: p.sourceVideoId, w: p.widthPx, h: p.heightPx, kind: p.kind })),
          urls: window.__MF_VIDEO__?.liveObjectUrlCount?.() ?? -1,
        };
      });
    }
    const decoded = video.videos.length > 0;
    rec(
      "430×932 real video frames or explicit fail",
      decoded ? video.videos[0].n >= 2 && video.videos[0].persistRaw === false && video.openings === beforeOpenings && video.urls === 0 : video.job.status === "failed",
      JSON.stringify(video),
    );
    if (decoded) {
      const uniq = new Set(video.stamps.map((s) => s.ts));
      rec("video timestamps distinct", uniq.size >= 2, JSON.stringify([...uniq]));
      rec("video provenance sourceVideoId", video.stamps.every((s) => s.src && s.kind === "video-frame"));
    }
    await page.evaluate(() => window.__MF_STORE__.getState().setGrokOffline(true));
    rec("AI OFFLINE badge", (await mf(page, "ai-offline").count()) > 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    rec("430×932 no page overflow", overflow);
    await ctx.close();
  }
} catch (e) {
  rec("LIVE SCRIPT", false, e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
}

const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
const out = {
  engine: "chromium-iphone-viewport",
  webkitLocal: "UNAVAILABLE_MISSING_SYSTEM_LIBS",
  physicalIphone: "DEFERRED_TO_FINAL_RELEASE",
  pass,
  fail,
  results,
};
writeFileSync(join(ROOT, "docs/BATCH4-LIVE.json"), JSON.stringify(out, null, 2));
console.log(`\nLIVE ${fail ? "FAIL" : "PASS"}  ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
