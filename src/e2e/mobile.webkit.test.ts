/**
 * Playwright WebKit iPhone E2E. Fail-closed if WebKit cannot launch.
 * MOB-01…10 and video ingest through the DOM.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { webkit, devices, type Browser, type BrowserContext, type Page } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8080";
const PHOTO = join(ROOT, "tests/fixtures/photo/south.jpg");
const VIDEO_MP4 = join(ROOT, "tests/fixtures/video/frames-rgb.mp4");
const VIDEO_WEBM = join(ROOT, "tests/fixtures/video/frames-rgb.webm");
const CORRUPT = join(ROOT, "tests/fixtures/video/corrupt.mp4");
const PORTRAIT = join(ROOT, "tests/fixtures/photo/portrait.jpg");
const LANDSCAPE = join(ROOT, "tests/fixtures/photo/landscape.jpg");

const IPHONES = [
  { id: "375x812", device: { ...devices["iPhone X"], viewport: { width: 375, height: 812 } } },
  { id: "390x844", device: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
  { id: "430x932", device: { ...devices["iPhone 14 Pro Max"], viewport: { width: 430, height: 932 } } },
] as const;

let browser: Browser;
let spawned: ChildProcess | null = null;
const errors: string[] = [];

function mf(page: Page, id: string) {
  return page.locator(`[data-mf-id="${id}"]`).first();
}

async function waitHealthy(url: string, ms = 20000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("preview did not become healthy");
}

before(async () => {
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(1500) });
  } catch {
    spawned = spawn("npm", ["run", "dev"], {
      cwd: ROOT,
      stdio: "ignore",
      env: process.env,
    });
  }
  await waitHealthy(BASE, 40000);
  try {
    browser = await webkit.launch({ headless: true });
  } catch (e) {
    throw new Error(`WebKit failed to launch (CI must FAIL). ${e instanceof Error ? e.message : e}`);
  }
});

after(async () => {
  await browser?.close();
  if (spawned?.pid) spawned.kill("SIGTERM");
});

async function openPhone(id: (typeof IPHONES)[number]["id"]): Promise<{ ctx: BrowserContext; page: Page }> {
  const spec = IPHONES.find((p) => p.id === id)!;
  const ctx = await browser.newContext({
    ...spec.device,
    locale: "ru-RU",
  });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => errors.push(`${id}: ${err.message}`));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => Boolean((window as unknown as { __MF_STORE__?: unknown }).__MF_STORE__), null, {
    timeout: 20000,
  });
  await page.evaluate(() => {
    const w = window as unknown as { __MF_STORE__: { getState: () => { dismissFirstRun: () => void } } };
    w.__MF_STORE__.getState().dismissFirstRun();
  });
  const cont = page.getByText("Продолжить текущий проект");
  if (await cont.count()) await cont.first().click();
  return { ctx, page };
}

async function noPageOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function storeEval<T>(page: Page, fn: () => T): Promise<T> {
  return page.evaluate(fn);
}

describe("MOB-01 375×812 no page horizontal overflow", () => {
  it("main workspace fits", async () => {
    const { ctx, page } = await openPhone("375x812");
    try {
      await mf(page, "workspace").waitFor({ timeout: 15000 });
      assert.equal(await noPageOverflow(page), true);
      assert.ok(await mf(page, "hud").count());
      assert.ok(await mf(page, "toolbar").count());
      assert.ok(await mf(page, "cad").count());
    } finally {
      await ctx.close();
    }
  });
});

describe("MOB-02 390×844 bottom sheet navigation", () => {
  it("open Reality, close, open Grok", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await mf(page, "toolbar-reality").tap();
      await mf(page, "sheet").waitFor();
      assert.equal(await mf(page, "sheet").getAttribute("data-mf-tab"), "reality");
      await mf(page, "sheet-dismiss").tap();
      await page.waitForTimeout(200);
      assert.equal(await page.locator("[data-mf-id=sheet]").count(), 0);
      await mf(page, "mobile-ai").tap();
      await mf(page, "sheet").waitFor();
      assert.equal(await mf(page, "sheet").getAttribute("data-mf-tab"), "grok");
      assert.equal(await noPageOverflow(page), true);
    } finally {
      await ctx.close();
    }
  });
});

describe("MOB-03 touch 2D selection/edit/Undo works", () => {
  it("dimension edit then undo", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await mf(page, "cad").waitFor();
      await mf(page, "dim-south").tap();
      await mf(page, "dim-input").waitFor({ timeout: 8000 });
      await mf(page, "dim-input").fill("7.51");
      await mf(page, "dim-ok").tap();
      const w1 = await storeEval(
        page,
        () => (window as unknown as { __MF_STORE__: { getState: () => { project: { room: { widthM: number } } } } }).__MF_STORE__.getState().project.room.widthM,
      );
      assert.equal(w1, 7.51);
      await mf(page, "undo").tap();
      const w0 = await storeEval(
        page,
        () => (window as unknown as { __MF_STORE__: { getState: () => { project: { room: { widthM: number } } } } }).__MF_STORE__.getState().project.room.widthM,
      );
      assert.notEqual(w0, 7.51);
    } finally {
      await ctx.close();
    }
  });
});

describe("MOB-04 3D loads and touch interaction does not crash", () => {
  it("430×932 twin + ceiling toggle", async () => {
    const { ctx, page } = await openPhone("430x932");
    try {
      await mf(page, "toolbar-3d").tap();
      await mf(page, "twin").waitFor({ timeout: 20000 });
      await mf(page, "ceiling-toggle").waitFor({ timeout: 10000 });
      await mf(page, "ceiling-toggle").tap();
      assert.equal(await mf(page, "ceiling-toggle").getAttribute("data-mf-ceiling-visible"), "0");
      await mf(page, "toolbar-3d").tap();
      await mf(page, "cad").waitFor();
    } finally {
      await ctx.close();
    }
  });
});

describe("MOB-05 Reality photo calibration works through mobile UI", () => {
  it("import + wall + A–B", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await mf(page, "toolbar-reality").tap();
      await mf(page, "reality-file").setInputFiles(PHOTO);
      const img = mf(page, "annotator-img");
      await img.waitFor({ timeout: 15000 });
      await mf(page, "wall-south").tap();
      await mf(page, "kind-point").tap();
      await mf(page, "cal-length").fill("2");
      const box = await img.boundingBox();
      assert.ok(box);
      await img.tap({ position: { x: box.width * 0.08, y: box.height * 0.5 } });
      await page.waitForTimeout(80);
      await img.tap({ position: { x: box.width * 0.33, y: box.height * 0.5 } });
      await page.waitForFunction(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { project: { reality?: { photos: Array<{ calibration?: { lengthM: number } }> } } } } }).__MF_STORE__.getState();
        return (s.project.reality?.photos[0]?.calibration?.lengthM ?? null) === 2;
      }, null, { timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });
});

describe("MOB-06 PENDING → ADD → canonical state through mobile UI", () => {
  it("door annotation ADD writes opening", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await mf(page, "toolbar-reality").tap();
      await mf(page, "reality-file").setInputFiles(PHOTO);
      const img = mf(page, "annotator-img");
      await img.waitFor({ timeout: 15000 });
      await mf(page, "wall-south").tap();
      await mf(page, "cal-length").fill("2");
      const box = await img.boundingBox();
      assert.ok(box);
      await img.tap({ position: { x: box.width * 0.08, y: box.height * 0.5 } });
      await page.waitForTimeout(80);
      await img.tap({ position: { x: box.width * 0.33, y: box.height * 0.5 } });
      await page.waitForTimeout(200);
      await mf(page, "kind-door").tap();
      await img.tap({ position: { x: box.width * 0.4, y: box.height * 0.8 } });
      await page.waitForTimeout(80);
      await img.tap({ position: { x: box.width * 0.55, y: box.height * 0.8 } });
      await page.waitForFunction(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { project: { reality?: { findings: Array<{ status: string }> } } } } }).__MF_STORE__.getState();
        return (s.project.reality?.findings.filter((f) => f.status === "PENDING").length ?? 0) >= 1;
      }, null, { timeout: 8000 });
      const beforeOpenings = await storeEval(
        page,
        () => (window as unknown as { __MF_STORE__: { getState: () => { project: { openings: unknown[] } } } }).__MF_STORE__.getState().project.openings.length,
      );
      await mf(page, "add-to-model").tap();
      await page.waitForFunction((n) => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { project: { openings: Array<{ type: string }> } } } }).__MF_STORE__.getState();
        return s.project.openings.length > n && s.project.openings.some((o) => o.type === "DOOR");
      }, beforeOpenings, { timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });
});

describe("MOB-07 Undo/Redo restores Engineering result", () => {
  it("redo after undo restores width", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await mf(page, "dim-south").tap();
      await mf(page, "dim-input").waitFor({ timeout: 8000 });
      await mf(page, "dim-input").fill("7.51");
      await mf(page, "dim-ok").tap();
      await mf(page, "undo").tap();
      await mf(page, "redo").tap();
      const w = await storeEval(
        page,
        () => (window as unknown as { __MF_STORE__: { getState: () => { project: { room: { widthM: number } } } } }).__MF_STORE__.getState().project.room.widthM,
      );
      assert.equal(w, 7.51);
    } finally {
      await ctx.close();
    }
  });
});

describe("MOB-08 AI OFFLINE leaves local product functional", () => {
  it("CAD and Reality still work", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await page.evaluate(() => {
        (window as unknown as { __MF_STORE__: { getState: () => { setGrokOffline: (v: boolean) => void } } }).__MF_STORE__.getState().setGrokOffline(true);
      });
      await mf(page, "ai-offline").waitFor({ timeout: 8000 });
      await mf(page, "cad").waitFor();
      await mf(page, "toolbar-reality").tap();
      await mf(page, "reality").waitFor();
      await mf(page, "mobile-ai").tap();
      await mf(page, "grok-input").fill("почему SAFE");
      await mf(page, "grok-send").tap();
      await page.waitForTimeout(400);
      const txt = await mf(page, "grok").innerText();
      assert.match(txt, /AI OFFLINE/);
    } finally {
      await ctx.close();
    }
  });
});

describe("MOB-09 Keyboard/input workflow remains usable", () => {
  it("Grok input is visible and in viewport", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await mf(page, "mobile-ai").tap();
      const input = mf(page, "grok-input");
      await input.tap();
      const box = await input.boundingBox();
      assert.ok(box);
      assert.ok(box.y + box.height <= 844 + 40);
      assert.equal(await noPageOverflow(page), true);
    } finally {
      await ctx.close();
    }
  });
});

describe("MOB-10 Safe-area/mobile controls remain accessible", () => {
  it("toolbar and undo are hittable", async () => {
    const { ctx, page } = await openPhone("375x812");
    try {
      const tb = await mf(page, "toolbar").boundingBox();
      const undo = await mf(page, "undo").boundingBox();
      assert.ok(tb && undo);
      assert.ok(tb.height >= 40);
      assert.ok(undo.height >= 40);
      assert.ok(tb.y + tb.height <= 812 + 2);
    } finally {
      await ctx.close();
    }
  });
});

describe("VIDEO mobile ingest", () => {
  it("real fixture decodes or fails closed; corrupt is explicit", async () => {
    const { ctx, page } = await openPhone("430x932");
    try {
      await mf(page, "toolbar-reality").tap();
      await mf(page, "reality-file").setInputFiles(CORRUPT);
      await page.waitForFunction(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { videoJob: { status: string; error?: string } } } }).__MF_STORE__.getState();
        return s.videoJob.status === "failed";
      }, null, { timeout: 10000 });
      const corruptState = await storeEval(page, () => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { videoJob: { status: string; error?: string }; project: { openings: unknown[]; reality?: { photos: unknown[]; videos?: unknown[] } } } } }).__MF_STORE__.getState();
        return {
          job: s.videoJob,
          photos: s.project.reality?.photos.length ?? 0,
          openings: s.project.openings.length,
        };
      });
      assert.equal(corruptState.job.status, "failed");
      assert.ok(corruptState.job.error === "VIDEO_UNSUPPORTED" || corruptState.job.error === "VIDEO_DECODE_FAILED");

      const beforeOpenings = corruptState.openings;
      await mf(page, "reality-file").setInputFiles(VIDEO_MP4);
      await page.waitForFunction(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { videoJob: { status: string } } } }).__MF_STORE__.getState();
        return s.videoJob.status !== "processing";
      }, null, { timeout: 20000 });
      let after = await storeEval(page, () => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { videoJob: { status: string; error?: string }; project: { openings: unknown[]; reality?: { photos: Array<{ timestampMs?: number; sourceVideoId?: string }>; videos?: Array<{ durationMs: number; persistRaw: boolean; frameIds: string[] }> } } } } }).__MF_STORE__.getState();
        const photos = s.project.reality?.photos ?? [];
        const videos = s.project.reality?.videos ?? [];
        return {
          job: s.videoJob,
          openings: s.project.openings.length,
          photos: photos.length,
          videos: videos.map((v) => ({ durationMs: v.durationMs, persistRaw: v.persistRaw, n: v.frameIds.length })),
          stamps: photos.map((p) => p.timestampMs).filter((t) => t != null),
          urls: (window as unknown as { __MF_VIDEO__?: { liveObjectUrlCount: () => number } }).__MF_VIDEO__?.liveObjectUrlCount() ?? -1,
        };
      });
      assert.equal(after.openings, beforeOpenings);
      if (!after.videos.length) {
        await mf(page, "reality-file").setInputFiles(VIDEO_WEBM);
        await page.waitForFunction(() => {
          const s = (window as unknown as { __MF_STORE__: { getState: () => { videoJob: { status: string } } } }).__MF_STORE__.getState();
          return s.videoJob.status !== "processing";
        }, null, { timeout: 20000 });
        after = await storeEval(page, () => {
          const s = (window as unknown as { __MF_STORE__: { getState: () => { videoJob: { status: string; error?: string }; project: { openings: unknown[]; reality?: { photos: Array<{ timestampMs?: number }>; videos?: Array<{ durationMs: number; persistRaw: boolean; frameIds: string[] }> } } } } }).__MF_STORE__.getState();
          const photos = s.project.reality?.photos ?? [];
          const videos = s.project.reality?.videos ?? [];
          return {
            job: s.videoJob,
            openings: s.project.openings.length,
            photos: photos.length,
            videos: videos.map((v) => ({ durationMs: v.durationMs, persistRaw: v.persistRaw, n: v.frameIds.length })),
            stamps: photos.map((p) => p.timestampMs).filter((t) => t != null),
            urls: (window as unknown as { __MF_VIDEO__?: { liveObjectUrlCount: () => number } }).__MF_VIDEO__?.liveObjectUrlCount() ?? -1,
          };
        });
      }
      if (after.videos.length) {
        assert.equal(after.videos[0].persistRaw, false);
        assert.ok(after.videos[0].n >= 2);
        assert.ok(after.videos[0].n <= 6);
        const uniq = new Set(after.stamps);
        assert.ok(uniq.size >= 2);
        assert.equal(after.urls, 0);
      } else {
        assert.equal(after.job.status, "failed");
        assert.ok(after.job.error === "VIDEO_UNSUPPORTED" || after.job.error === "VIDEO_DECODE_FAILED");
        assert.equal(after.openings, beforeOpenings);
      }
    } finally {
      await ctx.close();
    }
  });
});

describe("MOB overflow 430×932", () => {
  it("no page horizontal overflow", async () => {
    const { ctx, page } = await openPhone("430x932");
    try {
      assert.equal(await noPageOverflow(page), true);
    } finally {
      await ctx.close();
    }
  });
});

describe("PHOTO orientation files keep distinct sizes", () => {
  it("portrait vs landscape decode to matching aspect via UI", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await mf(page, "toolbar-reality").tap();
      await mf(page, "reality-file").setInputFiles(PORTRAIT);
      await page.waitForFunction(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { project: { reality?: { photos: unknown[] } } } } }).__MF_STORE__.getState();
        return (s.project.reality?.photos.length ?? 0) >= 1;
      }, null, { timeout: 10000 });
      await mf(page, "reality-file").setInputFiles(LANDSCAPE);
      await page.waitForFunction(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { project: { reality?: { photos: unknown[] } } } } }).__MF_STORE__.getState();
        return (s.project.reality?.photos.length ?? 0) >= 2;
      }, null, { timeout: 10000 });
      const dims = await storeEval(page, () => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { project: { reality?: { photos: Array<{ widthPx?: number; heightPx?: number }> } } } } }).__MF_STORE__.getState();
        return (s.project.reality?.photos ?? []).map((p) => ({ w: p.widthPx, h: p.heightPx }));
      });
      assert.ok(dims.length >= 2);
      const p = dims[0];
      const l = dims[1];
      assert.ok((p.h ?? 0) > (p.w ?? 0));
      assert.ok((l.w ?? 0) > (l.h ?? 0));
    } finally {
      await ctx.close();
    }
  });
});

describe("console cleanliness", () => {
  it("no unexplained page errors", () => {
    const severe = errors.filter((e) => !/ResizeObserver|hydration|webkit fake|Importing a module script failed/i.test(e));
    assert.deepEqual(severe, []);
  });
});
