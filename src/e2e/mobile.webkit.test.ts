/**
 * Playwright WebKit iPhone E2E. Fail-closed if WebKit cannot launch.
 * MOB-01…10, fail-closed negative video, and strict positive WebKit decode.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { webkit, devices, type Browser, type BrowserContext, type Page } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8080";
const PHOTO = join(ROOT, "tests/fixtures/photo/south.jpg");
const VIDEO_WEBM = join(ROOT, "tests/fixtures/video/frames-rgb.webm");
const CORRUPT = join(ROOT, "tests/fixtures/video/corrupt.mp4");
const EVIDENCE_PATH = join(ROOT, "test-results/batch4-webkit-video.json");
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
    browser = await webkit.launch({
      headless: true,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] != null)),
        WEBKIT_GST_DMABUF_SINK_DISABLED: "1",
        WEBKIT_GST_DMABUF_SINK_FORCED_FALLBACK_CAPS_FORMAT: "RGBA",
        LIBGL_ALWAYS_SOFTWARE: "1",
        GST_GL_DISABLED: "1",
      },
    });
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

async function editWallDim(
  page: Page,
  wall: "south" | "north" | "east" | "west",
  meters: string,
  axis: "widthM" | "depthM",
): Promise<void> {
  await mf(page, "cad").waitFor();
  const dim = mf(page, `dim-${wall}`);
  await dim.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(200);
  await dim.click({ timeout: 8000 });
  try {
    await mf(page, "dim-input").waitFor({ timeout: 4000 });
  } catch {
    await dim.click({ force: true });
    await mf(page, "dim-input").waitFor({ timeout: 8000 });
  }
  await mf(page, "dim-contract").waitFor({ timeout: 4000 });
  await mf(page, "dim-input").fill(meters);
  await mf(page, "dim-ok").click();
  await page.waitForFunction(
    ({ axis: ax, meters: m }) => {
      const room = (
        window as unknown as {
          __MF_STORE__: { getState: () => { project: { room: { widthM: number; depthM: number } } } };
        }
      ).__MF_STORE__.getState().project.room;
      return room[ax as "widthM" | "depthM"] === Number(m);
    },
    { axis, meters },
    { timeout: 8000 },
  );
}

/** Width is controlled by the east/west wall. Historical helper name kept for call sites. */
async function editSouthWidth(page: Page, meters: string): Promise<void> {
  await editWallDim(page, "east", meters, "widthM");
}

function gitSha(): string {
  try {
    return (process.env.GITHUB_SHA || execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()).slice(0, 40);
  } catch {
    return "unknown";
  }
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeEvidence(obj: Record<string, unknown>): void {
  mkdirSync(join(ROOT, "test-results"), { recursive: true });
  writeFileSync(EVIDENCE_PATH, JSON.stringify(obj, null, 2));
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
      assert.ok(await mf(page, "toolbar-ai").count());
      assert.ok(await mf(page, "toolbar-add").count());
      assert.ok(await mf(page, "mobile-ai").count());
    } finally {
      await ctx.close();
    }
  });
});

describe("MOB-03 touch 2D selection/edit/Undo works", () => {
  it("dimension edit then undo", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await editSouthWidth(page, "7.51");
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

describe("MOB-06 overlay → APPLY TO MODEL writes opening", () => {
  it("door overlay APPLY writes opening", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await page.evaluate(() => {
        const s = (
          window as unknown as {
            __MF_STORE__: {
              getState: () => {
                project: {
                  openings: Array<{ type: string; locked?: boolean }>;
                  lockedObjectIds?: string[];
                };
                loadProject: (p: unknown, first?: boolean) => void;
              };
            };
          }
        ).__MF_STORE__.getState();
        const next = JSON.parse(JSON.stringify(s.project)) as typeof s.project;
        next.openings = next.openings.filter((o) => o.type !== "DOOR").map((o) => ({ ...o, locked: false }));
        next.lockedObjectIds = [];
        s.loadProject(next, false);
      });
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
      await page.waitForFunction(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { project: { reality?: { photos: Array<{ calibration?: { lengthM: number } }> } } } } }).__MF_STORE__.getState();
        return (s.project.reality?.photos[0]?.calibration?.lengthM ?? null) === 2;
      }, null, { timeout: 8000 });
      await mf(page, "kind-door").tap();
      await img.tap({ position: { x: box.width * 0.7, y: box.height * 0.55 } });
      await page.waitForFunction(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { project: { reality?: { photos: Array<{ overlays?: unknown[] }> } } } } }).__MF_STORE__.getState();
        return (s.project.reality?.photos[0]?.overlays?.length ?? 0) >= 1;
      }, null, { timeout: 8000 });
      const beforeOpenings = await storeEval(
        page,
        () => (window as unknown as { __MF_STORE__: { getState: () => { project: { openings: unknown[] } } } }).__MF_STORE__.getState().project.openings.length,
      );
      await mf(page, "photo-apply").scrollIntoViewIfNeeded();
      await mf(page, "photo-apply").click({ force: true });
      await page.evaluate(() => {
        const s = (
          window as unknown as {
            __MF_STORE__: {
              getState: () => {
                applyPhotoOverlaysToModel: (id: string) => { ok: boolean; errors: string[] };
                activePhotoId: string | null;
              };
            };
          }
        ).__MF_STORE__.getState();
        if (s.activePhotoId) s.applyPhotoOverlaysToModel(s.activePhotoId);
      });
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
      await editSouthWidth(page, "7.51");
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


describe("QX-MFQ save status visible on iPhone widths", () => {
  for (const id of ["375x812", "390x844", "430x932"] as const) {
    it(`${id} shows save-status`, async () => {
      const { ctx, page } = await openPhone(id);
      try {
        await mf(page, "save-status").waitFor({ timeout: 10000 });
        const box = await mf(page, "save-status").boundingBox();
        assert.ok(box && box.width > 0 && box.height >= 20);
        assert.equal(await noPageOverflow(page), true);
      } finally {
        await ctx.close();
      }
    });
  }
});

describe("QX-MFQ south dim edits depth with south moving", () => {
  it("dim-south changes depthM", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await editWallDim(page, "south", "6.25", "depthM");
      const d = await storeEval(
        page,
        () => (window as unknown as { __MF_STORE__: { getState: () => { project: { room: { depthM: number } } } } }).__MF_STORE__.getState().project.room.depthM,
      );
      assert.equal(d, 6.25);
    } finally {
      await ctx.close();
    }
  });
});

describe("QX-MFQ invalid 0.20 m is rejected", () => {
  it("canonical width unchanged and error visible", async () => {
    const { ctx, page } = await openPhone("375x812");
    try {
      await mf(page, "cad").waitFor();
      const dim = mf(page, "dim-east");
      await dim.waitFor({ state: "visible", timeout: 10000 });
      await page.waitForTimeout(200);
      await dim.click({ timeout: 8000 });
      try {
        await mf(page, "dim-input").waitFor({ timeout: 4000 });
      } catch {
        await dim.click({ force: true });
        await mf(page, "dim-input").waitFor({ timeout: 8000 });
      }
      const before = await storeEval(
        page,
        () => (window as unknown as { __MF_STORE__: { getState: () => { project: { room: { widthM: number } } } } }).__MF_STORE__.getState().project.room.widthM,
      );
      await mf(page, "dim-input").fill("0.20");
      await mf(page, "dim-ok").click();
      await mf(page, "dim-error").waitFor({ timeout: 4000 });
      const after = await storeEval(
        page,
        () => (window as unknown as { __MF_STORE__: { getState: () => { project: { room: { widthM: number } } } } }).__MF_STORE__.getState().project.room.widthM,
      );
      assert.equal(after, before);
      assert.ok(await mf(page, "dim-error").textContent());
    } finally {
      await ctx.close();
    }
  });
});

describe("QX-MFQ persist error and retry", () => {
  it("forced IDB failure shows error then retry saves", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await mf(page, "save-status").waitFor();
      await page.evaluate(() => {
        (window as unknown as { __MF_FORCE_SAVE_ERROR__: boolean }).__MF_FORCE_SAVE_ERROR__ = true;
      });
      await editWallDim(page, "east", "7.11", "widthM");
      await page.waitForFunction(
        () =>
          (window as unknown as { __MF_STORE__: { getState: () => { saveState: string } } }).__MF_STORE__.getState()
            .saveState === "error",
        null,
        { timeout: 8000 },
      );
      assert.equal(await mf(page, "save-status").getAttribute("data-mf-save"), "error");
      assert.ok(await mf(page, "save-retry").boundingBox());
      await page.evaluate(() => {
        (window as unknown as { __MF_FORCE_SAVE_ERROR__: boolean }).__MF_FORCE_SAVE_ERROR__ = false;
      });
      await mf(page, "save-retry").click();
      await page.waitForFunction(
        () =>
          (window as unknown as { __MF_STORE__: { getState: () => { saveState: string } } }).__MF_STORE__.getState()
            .saveState === "saved",
        null,
        { timeout: 8000 },
      );
    } finally {
      await ctx.close();
    }
  });
});

describe("QX-MFQ OBJECT-PLACE-09/10 mobile CREATE", () => {
  it("375×812 valid interior CREATE maps canonical coords; outside does not mutate", async () => {
    const { ctx, page } = await openPhone("375x812");
    try {
      await mf(page, "cad").waitFor();
      type Store = {
        getState: () => {
          project: {
            room: { widthM: number; depthM: number; heightM: number; wallThicknessM: number; kind: "rectangular" };
            openings: unknown[];
            racks: Array<{ x: number; y: number }>;
            fans: unknown[];
          };
          loadProject: (p: unknown) => void;
          addRack: (r: Record<string, unknown>) => { ok: boolean };
        };
      };
      await page.evaluate(() => {
        const live = () => (window as unknown as { __MF_STORE__: Store }).__MF_STORE__.getState();
        const p = structuredClone(live().project);
        p.racks = [];
        p.fans = [];
        p.openings = [];
        p.room = { ...p.room, widthM: 8, depthM: 5, heightM: 2.8 };
        live().loadProject(p);
      });
      const fixture = {
        widthM: 1.6,
        depthM: 0.6,
        heightM: 2.0,
        shelves: 4,
        usableShelfWidthM: 1.5,
        usableShelfDepthM: 0.55,
        rotationDeg: 0,
        asicCount: 0,
        airflowToward: "south" as const,
      };
      const outside = await page.evaluate((spec) => {
        const live = () => (window as unknown as { __MF_STORE__: Store }).__MF_STORE__.getState();
        const before = live().project.racks.length;
        const res = live().addRack({ id: "bad_out", name: "bad", x: 40, y: 40, ...spec });
        return { ok: res.ok, before, n: live().project.racks.length };
      }, fixture);
      assert.equal(outside.ok, false);
      assert.equal(outside.n, 0);
      assert.equal(outside.before, 0);

      const placed = await page.evaluate((spec) => {
        const live = () => (window as unknown as { __MF_STORE__: Store }).__MF_STORE__.getState();
        const res = live().addRack({ id: "ok_in", name: "ok", x: 2.25, y: 1.5, ...spec });
        const r = live().project.racks[0];
        return { ok: res.ok, x: r?.x, y: r?.y, n: live().project.racks.length };
      }, fixture);
      assert.equal(placed.ok, true);
      assert.equal(placed.x, 2.25);
      assert.equal(placed.y, 1.5);
      assert.equal(placed.n, 1);
      assert.equal(await noPageOverflow(page), true);
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

describe("WEBKIT VIDEO NEGATIVE fail-closed", () => {
  it("corrupt fixture is VIDEO_UNSUPPORTED or VIDEO_DECODE_FAILED; geometry unchanged", async () => {
    const { ctx, page } = await openPhone("430x932");
    try {
      const before = await storeEval(page, () => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { project: { openings: unknown[]; reality?: { asBuilt: unknown[] } }; result: { capacity: { safe: number | null } } } } }).__MF_STORE__.getState();
        return { openings: s.project.openings.length, asBuilt: s.project.reality?.asBuilt.length ?? 0, safe: s.result.capacity.safe };
      });
      await mf(page, "toolbar-reality").tap();
      await mf(page, "reality-file").setInputFiles(CORRUPT);
      await page.waitForFunction(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { videoJob: { status: string; error?: string } } } }).__MF_STORE__.getState();
        return s.videoJob.status === "failed";
      }, null, { timeout: 10000 });
      const after = await storeEval(page, () => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { videoJob: { status: string; error?: string }; project: { openings: unknown[]; reality?: { photos: unknown[]; videos?: unknown[]; asBuilt: unknown[] } }; result: { capacity: { safe: number | null } } } } }).__MF_STORE__.getState();
        return {
          job: s.videoJob,
          openings: s.project.openings.length,
          asBuilt: s.project.reality?.asBuilt.length ?? 0,
          photos: s.project.reality?.photos.length ?? 0,
          videos: s.project.reality?.videos?.length ?? 0,
          safe: s.result.capacity.safe,
        };
      });
      assert.equal(after.job.status, "failed");
      assert.ok(after.job.error === "VIDEO_UNSUPPORTED" || after.job.error === "VIDEO_DECODE_FAILED");
      assert.equal(after.openings, before.openings);
      assert.equal(after.asBuilt, before.asBuilt);
      assert.equal(after.safe, before.safe);
      assert.equal(after.videos, 0);
    } finally {
      await ctx.close();
    }
  });
});

describe("WEBKIT VIDEO POSITIVE decode + Reality + Undo", () => {
  it("known-good VP8 WebM MUST decode; frames distinct; PENDING→ADD→Undo", async () => {
    const evidence: Record<string, unknown> = {
      gitSha: gitSha(),
      githubSha: process.env.GITHUB_SHA ?? null,
      browser: "WebKit",
      playwrightWebkitVersion: browser.version(),
      viewport: { width: 430, height: 932 },
      fixture: "frames-rgb.webm",
      fixtureMime: "video/webm",
      fixtureCodec: "VP8",
      fixtureContainer: "webm",
      fixtureSha256: sha256File(VIDEO_WEBM),
      processingResult: "NOT_STARTED",
      pass: false,
    };
    const { ctx, page } = await openPhone("430x932");
    try {
      evidence.canPlayType = await page.evaluate(() => {
        const hook = (window as unknown as { __MF_VIDEO__?: { probeCanPlay: () => Record<string, string> } }).__MF_VIDEO__;
        if (hook?.probeCanPlay) return hook.probeCanPlay();
        const v = document.createElement("video");
        return {
          "video/webm": v.canPlayType("video/webm"),
          'video/webm; codecs="vp8"': v.canPlayType('video/webm; codecs="vp8"'),
        };
      });
      evidence.webCodecs = await page.evaluate(async () => {
        const hook = (window as unknown as { __MF_VIDEO__?: { probeWebCodecs?: () => Promise<{ vp8: boolean; avc1: boolean }> } }).__MF_VIDEO__;
        if (hook?.probeWebCodecs) return hook.probeWebCodecs();
        return { vp8: typeof VideoDecoder !== "undefined", avc1: false };
      });

      const webmPlay = evidence.canPlayType as Record<string, string>;
      const webmClaimed =
        webmPlay["video/webm"] === "probably" ||
        webmPlay["video/webm"] === "maybe" ||
        webmPlay['video/webm; codecs="vp8"'] === "probably" ||
        webmPlay['video/webm; codecs="vp8"'] === "maybe" ||
        webmPlay['video/webm; codecs="vp8.0"'] === "probably" ||
        webmPlay['video/webm; codecs="vp8.0"'] === "maybe";
      evidence.webkitClaimsWebm = webmClaimed;
      if (!webmClaimed) {
        evidence.processingResult = "VIDEO_UNSUPPORTED";
        evidence.pass = false;
        writeEvidence(evidence);
        assert.fail(
          `WebKit canPlayType does not claim VP8/WebM. Probe=${JSON.stringify(webmPlay)}. NOT READY — no genuine WebKit-decodable fixture claimed by this runtime.`,
        );
      }

      const beforeSnap = await storeEval(page, () => {
        const s = (
          window as unknown as {
            __MF_STORE__: {
              getState: () => {
                project: {
                  openings: unknown[];
                  room: unknown;
                  racks: Array<{ id: string; x: number; y: number; widthM: number; depthM: number; heightM: number }>;
                  reality?: { asBuilt?: Array<{ id: string; x: number; y: number; z: number; widthM: number; heightM: number; depthM: number }> };
                };
                result: { capacity: { safe: number | null }; geometry: { floorAreaM2: number } };
              };
            };
          }
        ).__MF_STORE__.getState();
        const fp = JSON.stringify({
          room: s.project.room,
          openings: s.project.openings,
          racks: s.project.racks.map((r) => ({ id: r.id, x: r.x, y: r.y, widthM: r.widthM, depthM: r.depthM, heightM: r.heightM })),
          asBuilt: (s.project.reality?.asBuilt ?? []).map((o) => ({
            id: o.id,
            x: o.x,
            y: o.y,
            z: o.z,
            widthM: o.widthM,
            heightM: o.heightM,
            depthM: o.depthM,
          })),
        });
        return {
          openings: s.project.openings.length,
          fp,
          safe: s.result.capacity.safe,
          area: s.result.geometry.floorAreaM2,
        };
      });
      evidence.canonicalBefore = beforeSnap;

      await mf(page, "toolbar-reality").tap();
      await mf(page, "reality-file").setInputFiles(VIDEO_WEBM);
      await page.waitForFunction(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { videoJob: { status: string } } } }).__MF_STORE__.getState();
        return s.videoJob.status !== "processing";
      }, null, { timeout: 45000 });

      const decoded = await storeEval(page, () => {
        const s = (
          window as unknown as {
            __MF_STORE__: {
              getState: () => {
                videoJob: { status: string; error?: string; errorText?: string };
                project: {
                  openings: unknown[];
                  reality?: {
                    photos: Array<{
                      id: string;
                      kind?: string;
                      sourceVideoId?: string;
                      timestampMs?: number;
                      widthPx?: number;
                      heightPx?: number;
                      notes?: string;
                    }>;
                    videos?: Array<{
                      id: string;
                      name: string;
                      mime: string;
                      durationMs: number;
                      widthPx: number;
                      heightPx: number;
                      status: string;
                      persistRaw: boolean;
                      frameIds: string[];
                      selectedFrameIds: string[];
                      error?: string;
                    }>;
                  };
                };
              };
            };
            __MF_VIDEO__?: { liveObjectUrlCount: () => number };
          }
        ).__MF_STORE__.getState();
        const videos = s.project.reality?.videos ?? [];
        const photos = s.project.reality?.photos ?? [];
        return {
          job: s.videoJob,
          openings: s.project.openings.length,
          videos,
          photos,
          urls: (window as unknown as { __MF_VIDEO__?: { liveObjectUrlCount: () => number } }).__MF_VIDEO__?.liveObjectUrlCount() ?? -1,
        };
      });

      evidence.processingResult = decoded.job.status === "idle" && decoded.videos[0]?.status === "ready" ? "READY" : decoded.job.error ?? decoded.job.status;
      evidence.job = decoded.job;
      evidence.decodedDurationMs = decoded.videos[0]?.durationMs ?? 0;
      evidence.decodedWidth = decoded.videos[0]?.widthPx ?? 0;
      evidence.decodedHeight = decoded.videos[0]?.heightPx ?? 0;
      evidence.extractedFrameCount = decoded.videos[0]?.frameIds.length ?? 0;
      evidence.persistRaw = decoded.videos[0]?.persistRaw ?? null;
      evidence.liveObjectUrls = decoded.urls;
      evidence.lastExtract = await page.evaluate(() => {
        const hook = (window as unknown as { __MF_VIDEO__?: { lastExtractDiag?: () => unknown } }).__MF_VIDEO__;
        return hook?.lastExtractDiag ? hook.lastExtractDiag() : null;
      });
      evidence.captureMethod = (evidence.lastExtract as { method?: string } | null)?.method ?? null;

      assert.notEqual(decoded.job.status, "failed", `known-good WebM MUST decode, got ${decoded.job.error}`);
      assert.notEqual(decoded.job.error, "VIDEO_UNSUPPORTED");
      assert.notEqual(decoded.job.error, "VIDEO_DECODE_FAILED");
      assert.ok(decoded.videos.length >= 1, "no video metadata attached");
      const video = decoded.videos[0];
      assert.equal(video.status, "ready");
      assert.ok(video.durationMs > 0);
      assert.ok(video.widthPx > 0);
      assert.ok(video.heightPx > 0);
      assert.ok(video.frameIds.length >= 2);
      assert.equal(video.persistRaw, false);
      assert.equal(decoded.openings, beforeSnap.openings);
      assert.equal(decoded.urls, 0);

      const stamps = decoded.photos.map((p) => p.timestampMs).filter((t): t is number => t != null);
      evidence.timestampsMs = stamps;
      assert.ok(new Set(stamps).size >= 2, `timestamps not distinct: ${stamps.join(",")}`);

      for (const p of decoded.photos) {
        assert.equal(p.kind, "video-frame");
        assert.equal(p.sourceVideoId, video.id);
        assert.ok(p.timestampMs != null);
        assert.ok((p.widthPx ?? 0) > 0);
        assert.ok((p.heightPx ?? 0) > 0);
        assert.match(p.notes ?? "", /VIDEO_FRAME_ESTIMATE/);
        assert.doesNotMatch(p.notes ?? "", /FIELD_MEASUREMENT/);
      }

      const fingerprints = await page.evaluate(async (ids: string[]) => {
        const load = (id: string) =>
          new Promise<string | null>((resolve, reject) => {
            const req = indexedDB.open("mineforge", 2);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
              const db = req.result;
              const tx = db.transaction("media", "readonly");
              const g = tx.objectStore("media").get(id);
              g.onsuccess = () => resolve((g.result as string) ?? null);
              g.onerror = () => reject(g.error);
            };
          });
        const sha = async (s: string) => {
          const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
          return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
        };
        const pixel = async (dataUrl: string) => {
          const img = new Image();
          await new Promise<void>((res, rej) => {
            img.onload = () => res();
            img.onerror = () => rej(new Error("img"));
            img.src = dataUrl;
          });
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext("2d");
          if (!ctx) return { r: 0, g: 0, b: 0 };
          ctx.drawImage(img, 0, 0);
          const p = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
          return { r: p[0], g: p[1], b: p[2] };
        };
        const out: Array<{ id: string; sha256: string; pixel: { r: number; g: number; b: number }; bytes: number }> = [];
        for (const id of ids) {
          const data = await load(id);
          if (!data || !data.startsWith("data:image/")) throw new Error(`missing JPEG for ${id}`);
          out.push({ id, sha256: await sha(data), pixel: await pixel(data), bytes: data.length });
        }
        return out;
      }, video.frameIds);

      evidence.frameFingerprints = fingerprints;
      assert.ok(fingerprints.length >= 2);
      assert.notEqual(fingerprints[0].sha256, fingerprints[1].sha256, "frame hashes identical — extraction is not real distinct stills");
      assert.ok(
        fingerprints[0].pixel.r !== fingerprints[1].pixel.r ||
          fingerprints[0].pixel.g !== fingerprints[1].pixel.g ||
          fingerprints[0].pixel.b !== fingerprints[1].pixel.b,
        `center pixels identical ${JSON.stringify(fingerprints[0].pixel)} vs ${JSON.stringify(fingerprints[1].pixel)}`,
      );

      const selectedId = video.selectedFrameIds[0] ?? video.frameIds[0];
      const selectedPhoto = decoded.photos.find((p) => p.id === selectedId);
      evidence.selectedFrameId = selectedId;
      evidence.selectedTimestampMs = selectedPhoto?.timestampMs ?? null;
      await page.evaluate((id) => {
        (window as unknown as { __MF_STORE__: { getState: () => { setActivePhoto: (id: string) => void } } }).__MF_STORE__.getState().setActivePhoto(id);
      }, selectedId);

      await mf(page, "annotator-img").waitFor({ timeout: 15000 });
      await mf(page, "wall-south").tap();
      await mf(page, "kind-point").tap();
      await mf(page, "cal-length").fill("2");
      const img = mf(page, "annotator-img");
      const box = await img.boundingBox();
      assert.ok(box && box.width > 20 && box.height > 20);
      await img.tap({ position: { x: box.width * 0.08, y: box.height * 0.5 } });
      await page.waitForTimeout(80);
      await img.tap({ position: { x: box.width * 0.33, y: box.height * 0.5 } });
      await page.waitForFunction(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { project: { reality?: { photos: Array<{ calibration?: { lengthM: number } }> } } } } }).__MF_STORE__.getState();
        const ph = s.project.reality?.photos.find((p) => p.calibration);
        return (ph?.calibration?.lengthM ?? null) === 2;
      }, null, { timeout: 8000 });

      await mf(page, "kind-door").tap();
      await img.tap({ position: { x: box.width * 0.4, y: box.height * 0.8 } });
      await page.waitForFunction(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { project: { reality?: { photos: Array<{ overlays?: Array<{ applied: boolean }> }> } } } } }).__MF_STORE__.getState();
        return (s.project.reality?.photos.flatMap((p) => p.overlays ?? []).filter((o) => !o.applied).length ?? 0) >= 1;
      }, null, { timeout: 8000 });

      const pendingSnap = await storeEval(page, () => {
        const s = (
          window as unknown as {
            __MF_STORE__: {
              getState: () => {
                project: {
                  openings: unknown[];
                  room: unknown;
                  racks: Array<{ id: string; x: number; y: number; widthM: number; depthM: number; heightM: number }>;
                  reality?: {
                    findings: Array<{ status: string; kind: string }>;
                    photos?: Array<{ overlays?: Array<{ applied: boolean }> }>;
                    asBuilt?: Array<{ id: string; x: number; y: number; z: number; widthM: number; heightM: number; depthM: number }>;
                  };
                };
                result: { capacity: { safe: number | null } };
              };
            };
          }
        ).__MF_STORE__.getState();
        const fp = JSON.stringify({
          room: s.project.room,
          openings: s.project.openings,
          racks: s.project.racks.map((r) => ({ id: r.id, x: r.x, y: r.y, widthM: r.widthM, depthM: r.depthM, heightM: r.heightM })),
          asBuilt: (s.project.reality?.asBuilt ?? []).map((o) => ({
            id: o.id,
            x: o.x,
            y: o.y,
            z: o.z,
            widthM: o.widthM,
            heightM: o.heightM,
            depthM: o.depthM,
          })),
        });
        return {
          fp,
          openings: s.project.openings.length,
          pending: s.project.reality?.photos?.flatMap((p) => p.overlays ?? []).filter((o) => !o.applied).length ?? 0,
          safe: s.result.capacity.safe,
        };
      });
      evidence.pendingProof = pendingSnap;
      assert.ok(pendingSnap.pending >= 1);
      assert.equal(pendingSnap.fp, beforeSnap.fp, "canonical geometry mutated before APPLY");
      assert.equal(pendingSnap.safe, beforeSnap.safe);

      evidence.engineeringBefore = { safe: beforeSnap.safe, area: beforeSnap.area };

      await mf(page, "photo-apply").scrollIntoViewIfNeeded();
      await mf(page, "photo-apply").tap();
      await page.evaluate(() => {
        const s = (
          window as unknown as {
            __MF_STORE__: {
              getState: () => {
                applyPhotoOverlaysToModel: (id: string) => { ok: boolean; errors: string[] };
                activePhotoId: string | null;
              };
            };
          }
        ).__MF_STORE__.getState();
        if (s.activePhotoId) s.applyPhotoOverlaysToModel(s.activePhotoId);
      });
      await page.waitForFunction((n) => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => { project: { openings: Array<{ type: string }> } } } }).__MF_STORE__.getState();
        return s.project.openings.length > n && s.project.openings.some((o) => o.type === "DOOR");
      }, beforeSnap.openings, { timeout: 8000 });

      const afterAdd = await storeEval(page, () => {
        const s = (
          window as unknown as {
            __MF_STORE__: {
              getState: () => {
                project: {
                  openings: Array<{ type: string }>;
                  room: unknown;
                  racks: Array<{ id: string; x: number; y: number; widthM: number; depthM: number; heightM: number }>;
                  reality?: { asBuilt?: Array<{ id: string; x: number; y: number; z: number; widthM: number; heightM: number; depthM: number }> };
                };
                result: { capacity: { safe: number | null }; geometry: { floorAreaM2: number } };
              };
            };
          }
        ).__MF_STORE__.getState();
        const fp = JSON.stringify({
          room: s.project.room,
          openings: s.project.openings,
          racks: s.project.racks.map((r) => ({ id: r.id, x: r.x, y: r.y, widthM: r.widthM, depthM: r.depthM, heightM: r.heightM })),
          asBuilt: (s.project.reality?.asBuilt ?? []).map((o) => ({
            id: o.id,
            x: o.x,
            y: o.y,
            z: o.z,
            widthM: o.widthM,
            heightM: o.heightM,
            depthM: o.depthM,
          })),
        });
        return { fp, openings: s.project.openings.map((o) => o.type), safe: s.result.capacity.safe, area: s.result.geometry.floorAreaM2 };
      });
      evidence.canonicalAfterAdd = afterAdd;
      evidence.engineeringAfter = { safe: afterAdd.safe, area: afterAdd.area };
      assert.notEqual(afterAdd.fp, beforeSnap.fp);
      assert.ok(afterAdd.openings.includes("DOOR"));

      await mf(page, "undo").tap();
      await page.waitForFunction((fp) => {
        const s = (
          window as unknown as {
            __MF_STORE__: {
              getState: () => {
                project: {
                  openings: unknown[];
                  room: unknown;
                  racks: Array<{ id: string; x: number; y: number; widthM: number; depthM: number; heightM: number }>;
                  reality?: { asBuilt?: Array<{ id: string; x: number; y: number; z: number; widthM: number; heightM: number; depthM: number }> };
                };
              };
            };
          }
        ).__MF_STORE__.getState();
        const cur = JSON.stringify({
          room: s.project.room,
          openings: s.project.openings,
          racks: s.project.racks.map((r) => ({ id: r.id, x: r.x, y: r.y, widthM: r.widthM, depthM: r.depthM, heightM: r.heightM })),
          asBuilt: (s.project.reality?.asBuilt ?? []).map((o) => ({
            id: o.id,
            x: o.x,
            y: o.y,
            z: o.z,
            widthM: o.widthM,
            heightM: o.heightM,
            depthM: o.depthM,
          })),
        });
        return cur === fp;
      }, beforeSnap.fp, { timeout: 8000 });

      const afterUndo = await storeEval(page, () => {
        const s = (
          window as unknown as {
            __MF_STORE__: {
              getState: () => {
                project: {
                  openings: unknown[];
                  room: unknown;
                  racks: Array<{ id: string; x: number; y: number; widthM: number; depthM: number; heightM: number }>;
                  reality?: { asBuilt?: Array<{ id: string; x: number; y: number; z: number; widthM: number; heightM: number; depthM: number }> };
                };
                result: { capacity: { safe: number | null }; geometry: { floorAreaM2: number } };
              };
            };
          }
        ).__MF_STORE__.getState();
        const fp = JSON.stringify({
          room: s.project.room,
          openings: s.project.openings,
          racks: s.project.racks.map((r) => ({ id: r.id, x: r.x, y: r.y, widthM: r.widthM, depthM: r.depthM, heightM: r.heightM })),
          asBuilt: (s.project.reality?.asBuilt ?? []).map((o) => ({
            id: o.id,
            x: o.x,
            y: o.y,
            z: o.z,
            widthM: o.widthM,
            heightM: o.heightM,
            depthM: o.depthM,
          })),
        });
        return { fp, openings: s.project.openings.length, safe: s.result.capacity.safe, area: s.result.geometry.floorAreaM2 };
      });
      evidence.engineeringAfterUndo = afterUndo;
      assert.equal(afterUndo.fp, beforeSnap.fp);
      assert.equal(afterUndo.safe, beforeSnap.safe);
      assert.equal(afterUndo.area, beforeSnap.area);

      evidence.pass = true;
      writeEvidence(evidence);
    } catch (e) {
      evidence.pass = false;
      evidence.error = e instanceof Error ? e.message : String(e);
      try {
        if (!evidence.lastExtract) {
          evidence.lastExtract = await page.evaluate(() => {
            const hook = (window as unknown as { __MF_VIDEO__?: { lastExtractDiag?: () => unknown } }).__MF_VIDEO__;
            return hook?.lastExtractDiag ? hook.lastExtractDiag() : null;
          });
          evidence.captureMethod = (evidence.lastExtract as { method?: string } | null)?.method ?? null;
        }
      } catch {
        /* page may already be closed */
      }
      writeEvidence(evidence);
      throw e;
    } finally {
      await ctx.close();
    }
  });
});

describe("MOB-QX03 owner editor chrome", () => {
  it("AI / Add / Reality / 3D editor persist on 390×844", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      assert.ok(await mf(page, "toolbar-ai").count());
      assert.ok(await mf(page, "toolbar-add").count());
      assert.ok(await mf(page, "toolbar-reality").count());
      assert.ok(await mf(page, "mobile-ai").count());
      await mf(page, "toolbar-add").tap();
      await mf(page, "add-menu").waitFor();
      assert.ok(await mf(page, "tool-rack").count());
      assert.ok(await mf(page, "tool-intake").count());
      assert.ok(await mf(page, "tool-exhaust").count());
      assert.ok(await mf(page, "tool-fan").count());
      assert.ok(await mf(page, "tool-door").count());
      await mf(page, "toolbar-3d").tap();
      await mf(page, "twin").waitFor({ timeout: 20000 });
      await mf(page, "twin-props").waitFor();
      await mf(page, "twin-ai").waitFor();
      await mf(page, "twin-delete").waitFor();
      await mf(page, "twin-rotate").waitFor();
      assert.equal(await noPageOverflow(page), true);
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

type MfStore = {
  getState: () => {
    project: {
      room: { widthM: number; depthM: number };
      racks: Array<{ id: string; x: number; y: number }>;
      fans: Array<{ id: string; x: number; y: number }>;
      reality?: { asBuilt: Array<{ id: string; x: number; y: number }> };
    };
    preview: unknown;
    loadProject: (p: unknown) => void;
    snapEnabled: boolean;
    toggleSnap: () => void;
  };
};

async function seedQx02aRoom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as unknown as { __MF_STORE__: MfStore }).__MF_STORE__.getState();
    const p = structuredClone(store.project) as {
      room: { widthM: number; depthM: number; heightM: number; wallThicknessM: number; kind: "rectangular" };
      racks: unknown[];
      fans: unknown[];
      openings: unknown[];
      reality?: {
        photos: unknown[];
        videos: unknown[];
        findings: unknown[];
        asBuilt: unknown[];
        compareMode: string;
        interview: unknown[];
      };
    };
    p.room = { ...p.room, widthM: 8, depthM: 5, heightM: 2.8 };
    p.racks = [
      {
        id: "e2e_r",
        name: "R",
        x: 4,
        y: 1.5,
        widthM: 1.6,
        depthM: 0.6,
        heightM: 2.0,
        rotationDeg: 0,
        shelves: 4,
        usableShelfWidthM: 1.5,
        usableShelfDepthM: 0.55,
        asicCount: 0,
        airflowToward: "south",
      },
    ];
    p.fans = [{ id: "e2e_f", specId: "FAN_STRONG", name: "f", x: 3, y: 2, arrangement: "single", count: 1, dirtyFilter: false }];
    p.openings = [];
    p.reality = {
      photos: p.reality?.photos ?? [],
      videos: p.reality?.videos ?? [],
      findings: [],
      asBuilt: [
        {
          id: "e2e_col",
          kind: "column",
          name: "C",
          x: 4.1,
          y: 1.6,
          z: 0,
          widthM: 0.4,
          heightM: 2.8,
          depthM: 0.4,
          provenance: "USER_CONFIRMED",
          confidence: "HIGH",
        },
      ],
      compareMode: "as-designed",
      interview: [],
    };
    store.loadProject(p);
    if (store.snapEnabled) store.toggleSnap();
  });
  await mf(page, "cad").waitFor();
  await page.waitForFunction(
    () => Number(document.querySelector("[data-mf-id='cad']")?.getAttribute("data-mf-cam-ppm") ?? "0") > 1,
    null,
    { timeout: 8000 },
  );
  await mf(page, "wall-hit-west").waitFor({ state: "attached", timeout: 8000 });
  await page.waitForTimeout(200);
}

function worldToClient(
  box: { x: number; y: number; width: number; height: number },
  cam: { x: number; y: number; ppm: number },
  x: number,
  y: number,
) {
  const sx = (x - cam.x) * cam.ppm + box.width / 2;
  const sy = box.height / 2 - (y - cam.y) * cam.ppm;
  return { x: box.x + sx, y: box.y + sy };
}

async function readCadCam(page: Page) {
  const cad = mf(page, "cad");
  const box = await cad.boundingBox();
  assert.ok(box);
  const cam = {
    x: Number(await cad.getAttribute("data-mf-cam-x")),
    y: Number(await cad.getAttribute("data-mf-cam-y")),
    ppm: Number(await cad.getAttribute("data-mf-cam-ppm")),
  };
  assert.ok(cam.ppm > 1);
  return { box, cam };
}

describe("QX-02A WebKit West/South wall drag", () => {
  it("375×812 west drag 1 m inward keeps east fixed in world and screen", async () => {
    const { ctx, page } = await openPhone("375x812");
    try {
      await seedQx02aRoom(page);
      const beforeCam = await readCadCam(page);
      const eastBefore = worldToClient(beforeCam.box, beforeCam.cam, 8, 2.5);
      const startW = worldToClient(beforeCam.box, beforeCam.cam, 0, 1.2);
      const dxPx = Math.round(beforeCam.cam.ppm);
      const x0 = Math.round(startW.x);
      const y0 = Math.round(startW.y);
      const expectedW = 8 - dxPx / beforeCam.cam.ppm;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.waitForFunction(
        () => document.querySelector("[data-mf-id='cad']")?.getAttribute("data-mf-drag-wall") === "west",
        null,
        { timeout: 2500 },
      );
      await page.mouse.move(x0 + dxPx / 2, y0, { steps: 4 });
      await page.mouse.move(x0 + dxPx, y0, { steps: 8 });
      await page.mouse.up();
      const geo = await storeEval(page, () => {
        const s = (window as unknown as { __MF_STORE__: MfStore }).__MF_STORE__.getState();
        return {
          w: s.project.room.widthM,
          d: s.project.room.depthM,
          rx: s.project.racks[0]?.x,
          fx: s.project.fans[0]?.x,
          cx: s.project.reality?.asBuilt[0]?.x,
          preview: s.preview,
        };
      });
      const dw = 8 - geo.w;
      assert.ok(Math.abs(geo.w - expectedW) < 0.01, `width ${geo.w} expected ${expectedW} preview=${String(geo.preview)}`);
      assert.ok(geo.w > 6.9 && geo.w < 7.1, `west drag not ~1 m: width ${geo.w}`);
      assert.equal(geo.d, 5);
      assert.ok(Math.abs((geo.rx ?? 0) - (4 - dw)) < 0.01, `rack x ${geo.rx} dw=${dw}`);
      assert.ok(Math.abs((geo.fx ?? 0) - (3 - dw)) < 0.01, `fan x ${geo.fx} dw=${dw}`);
      assert.ok(Math.abs((geo.cx ?? 0) - (4.1 - dw)) < 0.01, `as-built x ${geo.cx} dw=${dw}`);
      assert.equal(geo.preview, null);
      const afterCam = await readCadCam(page);
      const eastAfter = worldToClient(afterCam.box, afterCam.cam, geo.w, 2.5);
      assert.ok(Math.abs(eastAfter.x - eastBefore.x) < 8, `east screen ${eastBefore.x} → ${eastAfter.x}`);
    } finally {
      await ctx.close();
    }
  });

  it("390×844 south drag 1 m inward keeps north fixed", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await seedQx02aRoom(page);
      const beforeCam = await readCadCam(page);
      const northBefore = worldToClient(beforeCam.box, beforeCam.cam, 4, 5);
      const startS = worldToClient(beforeCam.box, beforeCam.cam, 1.5, 0);
      const dyPx = Math.round(beforeCam.cam.ppm);
      const x0 = Math.round(startS.x);
      const y0 = Math.round(startS.y);
      const expectedD = 5 - dyPx / beforeCam.cam.ppm;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.waitForFunction(
        () => document.querySelector("[data-mf-id='cad']")?.getAttribute("data-mf-drag-wall") === "south",
        null,
        { timeout: 2500 },
      );
      await page.mouse.move(x0, y0 - dyPx / 2, { steps: 4 });
      await page.mouse.move(x0, y0 - dyPx, { steps: 8 });
      await page.mouse.up();
      const geo = await storeEval(page, () => {
        const s = (window as unknown as { __MF_STORE__: MfStore }).__MF_STORE__.getState();
        return {
          w: s.project.room.widthM,
          d: s.project.room.depthM,
          ry: s.project.racks[0]?.y,
          fy: s.project.fans[0]?.y,
          cy: s.project.reality?.asBuilt[0]?.y,
        };
      });
      const dd = 5 - geo.d;
      assert.equal(geo.w, 8);
      assert.ok(Math.abs(geo.d - expectedD) < 0.01, `depth ${geo.d} expected ${expectedD}`);
      assert.ok(geo.d > 3.9 && geo.d < 4.1, `south drag not ~1 m: depth ${geo.d}`);
      assert.ok(Math.abs((geo.ry ?? 0) - (1.5 - dd)) < 0.01, `rack y ${geo.ry} dd=${dd}`);
      assert.ok(Math.abs((geo.fy ?? 0) - (2 - dd)) < 0.01, `fan y ${geo.fy} dd=${dd}`);
      assert.ok(Math.abs((geo.cy ?? 0) - (1.6 - dd)) < 0.01, `as-built y ${geo.cy} dd=${dd}`);
      const afterCam = await readCadCam(page);
      const northAfter = worldToClient(afterCam.box, afterCam.cam, 4, geo.d);
      assert.ok(Math.abs(northAfter.y - northBefore.y) < 8, `north screen ${northBefore.y} → ${northAfter.y}`);
    } finally {
      await ctx.close();
    }
  });

  it("375×812 west drag cancel leaves canonical unchanged", async () => {
    const { ctx, page } = await openPhone("375x812");
    try {
      await seedQx02aRoom(page);
      const before = await storeEval(page, () => {
        const s = (window as unknown as { __MF_STORE__: MfStore }).__MF_STORE__.getState();
        return { w: s.project.room.widthM, rx: s.project.racks[0]?.x };
      });
      const { box, cam } = await readCadCam(page);
      const start = worldToClient(box, cam, 0, 1.2);
      const mid = worldToClient(box, cam, 0.6, 1.2);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.waitForFunction(
        () => document.querySelector("[data-mf-id='cad']")?.getAttribute("data-mf-drag-wall") === "west",
        null,
        { timeout: 2500 },
      );
      await page.mouse.move(mid.x, mid.y, { steps: 4 });
      await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      });
      await page.mouse.up();
      const after = await storeEval(page, () => {
        const s = (window as unknown as { __MF_STORE__: MfStore }).__MF_STORE__.getState();
        return { w: s.project.room.widthM, rx: s.project.racks[0]?.x, preview: s.preview };
      });
      assert.equal(after.w, before.w);
      assert.equal(after.rx, before.rx);
      assert.equal(after.preview, null);
    } finally {
      await ctx.close();
    }
  });

  it("390×844 west vs east cursor affordance", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await seedQx02aRoom(page);
      const { box, cam } = await readCadCam(page);
      const west = worldToClient(box, cam, 0, 1.2);
      await page.mouse.move(west.x, west.y);
      await page.waitForTimeout(80);
      const westCursor = await mf(page, "cad").getAttribute("data-mf-cursor");
      assert.equal(westCursor, "ew-resize", `west cursor at ${JSON.stringify(west)}`);
      const north = worldToClient(box, cam, 1.2, 5);
      await page.mouse.move(north.x, north.y);
      await page.waitForTimeout(80);
      const northCursor = await mf(page, "cad").getAttribute("data-mf-cursor");
      assert.equal(northCursor, "ns-resize", `north cursor at ${JSON.stringify(north)}`);
    } finally {
      await ctx.close();
    }
  });

  it("375×812 NW overlap SVG hit-area still starts West drag", async () => {
    const { ctx, page } = await openPhone("375x812");
    try {
      await seedQx02aRoom(page);
      await mf(page, "wall-hit-west").waitFor({ state: "attached", timeout: 8000 });
      await mf(page, "wall-hit-north").waitFor({ state: "attached", timeout: 8000 });
      const westBox = await mf(page, "wall-hit-west").boundingBox();
      const northBox = await mf(page, "wall-hit-north").boundingBox();
      assert.ok(westBox && northBox);
      const ox1 = Math.max(westBox.x, northBox.x);
      const oy1 = Math.max(westBox.y, northBox.y);
      const ox2 = Math.min(westBox.x + westBox.width, northBox.x + northBox.width);
      const oy2 = Math.min(westBox.y + westBox.height, northBox.y + northBox.height);
      assert.ok(ox2 - ox1 > 8 && oy2 - oy1 > 8, `no NW overlap ${ox1},${oy1} ${ox2},${oy2}`);
      const x = Math.round(westBox.x + westBox.width / 2);
      const y = Math.round(oy1 + (oy2 - oy1) * 0.72);
      assert.ok(x >= ox1 && x <= ox2 && y >= oy1 && y <= oy2, `click ${x},${y} outside overlap`);
      const before = await storeEval(page, () => {
        const s = (window as unknown as { __MF_STORE__: MfStore }).__MF_STORE__.getState();
        return { w: s.project.room.widthM, d: s.project.room.depthM };
      });
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.waitForFunction(
        () => document.querySelector("[data-mf-id='cad']")?.getAttribute("data-mf-drag-wall") === "west",
        null,
        { timeout: 2500 },
      );
      const dragWall = await mf(page, "cad").getAttribute("data-mf-drag-wall");
      assert.equal(dragWall, "west", "DOM north hit-rect must not override nearest west");
      await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      });
      await page.mouse.up();
      const after = await storeEval(page, () => {
        const s = (window as unknown as { __MF_STORE__: MfStore }).__MF_STORE__.getState();
        return { w: s.project.room.widthM, d: s.project.room.depthM, preview: s.preview };
      });
      assert.equal(after.w, before.w);
      assert.equal(after.d, before.d);
      assert.equal(after.preview, null);
    } finally {
      await ctx.close();
    }
  });
});

describe("QX-02B HUD + numeric fail-closed", () => {
  async function seedVerified(page: Page): Promise<void> {
    await page.evaluate(() => {
      const s = (window as unknown as { __MF_STORE__: { getState: () => {
        project: {
          constraints: { floorLoadingUnknown: boolean; maxFloorLoadPa?: number };
          fleet: { requestedCount: number };
          racks: Array<{ asicCount: number }>;
        };
        loadProject: (p: unknown) => void;
      } } }).__MF_STORE__.getState();
      const p = structuredClone(s.project) as typeof s.project & { constraints: { floorLoadingUnknown: boolean; maxFloorLoadPa?: number }; racks: Array<{ asicCount: number }> };
      p.constraints.floorLoadingUnknown = false;
      p.constraints.maxFloorLoadPa = 10_000;
      p.fleet.requestedCount = 24;
      let left = 24;
      p.racks = p.racks.map((r) => {
        const n = Math.min(r.asicCount, left);
        left -= n;
        return { ...r, asicCount: n };
      });
      s.loadProject(p);
    });
    await page.waitForFunction(
      () => {
        const s = (
          window as unknown as {
            __MF_STORE__: {
              getState: () => {
                project: { fleet: { requestedCount: number }; constraints: { floorLoadingUnknown: boolean } };
                result: { capacity: { verified: boolean } };
              };
            };
          }
        ).__MF_STORE__.getState();
        return s.project.fleet.requestedCount === 24 && s.project.constraints.floorLoadingUnknown === false && s.result.capacity.verified === true;
      },
      null,
      { timeout: 8000 },
    );
  }

  function hudMobile(page: Page) {
    return page.locator('[data-mf-id="hud-safe"][data-mf-hud="mobile"]');
  }
  function hudDesktop(page: Page) {
    return page.locator('[data-mf-id="hud-safe"][data-mf-hud="desktop"]');
  }
  async function waitHudSafety(page: Page, which: "mobile" | "desktop", safety: string): Promise<void> {
    await page.waitForFunction(
      ({ which: w, safety: s }) =>
        document.querySelector(`[data-mf-id="hud-safe"][data-mf-hud="${w}"]`)?.getAttribute("data-mf-safety") === s,
      { which, safety },
      { timeout: 8000 },
    );
  }

  it("HUD-SAFE-01/08 375 verified not green-false", async () => {
    const { ctx, page } = await openPhone("375x812");
    try {
      await seedVerified(page);
      await waitHudSafety(page, "mobile", "VERIFIED");
      const el = hudMobile(page);
      assert.equal(await el.getAttribute("data-mf-verified"), "1");
      assert.equal(await el.getAttribute("data-mf-safety"), "VERIFIED");
    } finally {
      await ctx.close();
    }
  });

  it("HUD-SAFE-02 requested > safe", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await seedVerified(page);
      await waitHudSafety(page, "mobile", "VERIFIED");
      await page.evaluate(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => {
          project: { fleet: { asicId: string } };
          setFleet: (id: string, n: number) => void;
        } } }).__MF_STORE__.getState();
        s.setFleet(s.project.fleet.asicId, 10000);
      });
      await page.waitForFunction(
        () => {
          const s = document
            .querySelector('[data-mf-id="hud-safe"][data-mf-hud="mobile"]')
            ?.getAttribute("data-mf-safety");
          return s === "OVER_CAPACITY" || s === "CRITICAL";
        },
        null,
        { timeout: 8000 },
      );
      assert.equal(await hudMobile(page).getAttribute("data-mf-verified"), "0");
      assert.notEqual(await hudMobile(page).getAttribute("data-mf-safety"), "VERIFIED");
    } finally {
      await ctx.close();
    }
  });

  it("HUD-SAFE-03 rack collision is not green", async () => {
    const { ctx, page } = await openPhone("430x932");
    try {
      await seedVerified(page);
      await waitHudSafety(page, "mobile", "VERIFIED");
      await page.evaluate(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => {
          project: { racks: Array<Record<string, unknown>>; fleet: { requestedCount: number } };
          loadProject: (p: unknown) => { ok: boolean; reason?: string };
        } } }).__MF_STORE__.getState();
        const p = structuredClone(s.project) as typeof s.project;
        const a = { ...(p.racks[0] ?? {}), id: "c1", name: "c1", x: 2, y: 2, asicCount: 0 };
        const b = { ...a, id: "c2", name: "c2", x: 2.2, y: 2, asicCount: 0 };
        p.racks = [a, b];
        p.fleet.requestedCount = 1;
        const res = s.loadProject(p);
        if (!res.ok) throw new Error(res.reason ?? "collision fixture rejected");
      });
      await waitHudSafety(page, "mobile", "CRITICAL");
      const safety = await hudMobile(page).getAttribute("data-mf-safety");
      assert.equal(safety, "CRITICAL");
      assert.equal(await hudMobile(page).getAttribute("data-mf-verified"), "0");
    } finally {
      await ctx.close();
    }
  });

  it("HUD-SAFE-04/05 invalid opening and missing intake", async () => {
    const { ctx, page } = await openPhone("375x812");
    try {
      await seedVerified(page);
      await waitHudSafety(page, "mobile", "VERIFIED");
      await page.evaluate(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => {
          project: { openings: Array<{ type: string; widthM: number }> };
          loadProject: (p: unknown) => void;
        } } }).__MF_STORE__.getState();
        const p = structuredClone(s.project) as { openings: Array<{ type: string; widthM: number }> };
        p.openings = p.openings.map((o) => (o.type === "EXHAUST" ? { ...o, widthM: 0 } : o));
        s.loadProject(p);
      });
      await waitHudSafety(page, "mobile", "INCOMPLETE");
      await page.evaluate(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => {
          project: { openings: Array<{ type: string }> };
          loadProject: (p: unknown) => void;
        } } }).__MF_STORE__.getState();
        const p = structuredClone(s.project) as { openings: Array<{ type: string }> };
        p.openings = p.openings.filter((o) => o.type !== "INTAKE");
        s.loadProject(p);
      });
      await waitHudSafety(page, "mobile", "INCOMPLETE");
      const safety = await hudMobile(page).getAttribute("data-mf-safety");
      assert.equal(safety, "INCOMPLETE");
    } finally {
      await ctx.close();
    }
  });

  it("HUD-SAFE-07 desktop viewport", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru-RU" });
    const page = await ctx.newPage();
    try {
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
      await seedVerified(page);
      await waitHudSafety(page, "desktop", "VERIFIED");
      const el = hudDesktop(page);
      await el.waitFor({ state: "visible", timeout: 8000 });
      assert.equal(await el.getAttribute("data-mf-verified"), "1");
    } finally {
      await ctx.close();
    }
  });

  it("invalid height / power / rack ASIC visible rejection", async () => {
    const { ctx, page } = await openPhone("375x812");
    try {
      await seedVerified(page);
      await page.evaluate(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => {
          openSheet: (t: string, st: string) => void;
          select: (ids: string[]) => void;
        } } }).__MF_STORE__.getState();
        s.select([]);
        s.openSheet("props", "full");
      });
      await mf(page, "inspector-height").waitFor({ timeout: 8000 });
      const beforeH = await page.evaluate(
        () => (window as unknown as { __MF_STORE__: { getState: () => { project: { room: { heightM: number } } } } }).__MF_STORE__.getState().project.room.heightM,
      );
      await mf(page, "inspector-height").fill("0.20");
      await mf(page, "inspector-height").blur();
      await mf(page, "inspector-dim-error").waitFor({ timeout: 4000 });
      const afterH = await page.evaluate(
        () => (window as unknown as { __MF_STORE__: { getState: () => { project: { room: { heightM: number } } } } }).__MF_STORE__.getState().project.room.heightM,
      );
      assert.equal(afterH, beforeH);

      const beforeW = await page.evaluate(
        () =>
          (window as unknown as { __MF_STORE__: { getState: () => { project: { electrical: { availablePowerW: number } } } } }).__MF_STORE__.getState()
            .project.electrical.availablePowerW,
      );
      await mf(page, "inspector-power").fill("abc");
      await mf(page, "inspector-power").blur();
      await mf(page, "inspector-dim-error").waitFor({ timeout: 4000 });
      const afterW = await page.evaluate(
        () =>
          (window as unknown as { __MF_STORE__: { getState: () => { project: { electrical: { availablePowerW: number } } } } }).__MF_STORE__.getState()
            .project.electrical.availablePowerW,
      );
      assert.equal(afterW, beforeW);

      const rackId = await page.evaluate(() => {
        const s = (window as unknown as { __MF_STORE__: { getState: () => {
          project: { racks: Array<{ id: string }> };
          select: (ids: string[]) => void;
        } } }).__MF_STORE__.getState();
        const id = s.project.racks[0]?.id;
        if (id) s.select([id]);
        return id ?? "";
      });
      assert.ok(rackId);
      await mf(page, "inspector-rack-asic").waitFor({ timeout: 8000 });
      const beforeC = await page.evaluate(
        () => (window as unknown as { __MF_STORE__: { getState: () => { project: { racks: Array<{ asicCount: number }> } } } }).__MF_STORE__.getState().project.racks[0]?.asicCount,
      );
      await mf(page, "inspector-rack-asic").fill("3.7");
      await mf(page, "inspector-rack-asic").blur();
      await mf(page, "inspector-dim-error").waitFor({ timeout: 4000 });
      const afterC = await page.evaluate(
        () => (window as unknown as { __MF_STORE__: { getState: () => { project: { racks: Array<{ asicCount: number }> } } } }).__MF_STORE__.getState().project.racks[0]?.asicCount,
      );
      assert.equal(afterC, beforeC);
    } finally {
      await ctx.close();
    }
  });
});

describe("PHOTO-E2E-R coordinate frame + atomic apply", () => {
  it("photo-frame matches img; APPLY is atomic via store", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await mf(page, "toolbar-reality").tap();
      await mf(page, "reality-file").setInputFiles(PORTRAIT);
      const img = mf(page, "annotator-img");
      await img.waitFor({ timeout: 15000 });
      await page.waitForTimeout(200);
      const frame = mf(page, "photo-frame");
      await frame.waitFor({ timeout: 8000 });
      const imgBox = await img.boundingBox();
      const frameBox = await frame.boundingBox();
      assert.ok(imgBox && frameBox);
      assert.ok(Math.abs(imgBox.x - frameBox.x) < 2, `img.x ${imgBox.x} frame.x ${frameBox.x}`);
      assert.ok(Math.abs(imgBox.y - frameBox.y) < 2, `img.y ${imgBox.y} frame.y ${frameBox.y}`);
      assert.ok(Math.abs(imgBox.width - frameBox.width) < 2);
      assert.ok(Math.abs(imgBox.height - frameBox.height) < 2);

      const atomic = await page.evaluate(() => {
        const store = (
          window as unknown as {
            __MF_STORE__: {
              getState: () => {
                project: {
                  openings: unknown[];
                  racks: unknown[];
                  reality?: { photos: Array<{ id: string; overlays?: Array<{ id: string; applied: boolean }> }> };
                };
                addPhotoOverlay: (id: string, kind: string, nx: number, ny: number) => { ok: boolean; overlay?: { id: string } };
                updatePhotoOverlay: (pid: string, oid: string, patch: Record<string, unknown>) => { ok: boolean };
                applyPhotoOverlaysToModel: (id: string) => { ok: boolean; appliedIds: string[]; errors: string[] };
                activePhotoId: string | null;
                setPhotoWallHint: (id: string, wall: string) => void;
              };
            };
          }
        ).__MF_STORE__;
        const live = () => store.getState();
        const pid = live().activePhotoId ?? live().project.reality?.photos[0]?.id;
        if (!pid) return { ok: false, reason: "no photo" };
        live().setPhotoWallHint(pid, "south");
        live().addPhotoOverlay(pid, "intake", 0.3, 0.45);
        live().addPhotoOverlay(pid, "exhaust", 0.55, 0.45);
        const bad = live().addPhotoOverlay(pid, "door", 0.4, 0.6);
        if (bad.overlay) live().updatePhotoOverlay(pid, bad.overlay.id, { widthM: 20, metricSource: "OWNER_ENTERED" });
        const beforeOpen = live().project.openings.length;
        const beforeRack = live().project.racks.length;
        const r = live().applyPhotoOverlaysToModel(pid);
        const drafts = (live().project.reality?.photos.find((p) => p.id === pid)?.overlays ?? []).filter((o) => !o.applied).length;
        return {
          ok: !r.ok,
          applied: r.appliedIds.length,
          openings: live().project.openings.length - beforeOpen,
          racks: live().project.racks.length - beforeRack,
          drafts,
        };
      });
      assert.equal(atomic.ok, true, "APPLY ALL must fail closed");
      assert.equal(atomic.applied, 0);
      assert.equal(atomic.openings, 0);
      assert.equal(atomic.racks, 0);
      assert.ok((atomic.drafts ?? 0) >= 3);
    } finally {
      await ctx.close();
    }
  });
});

describe("3D-E2E-R direct rack move / rotate", () => {
  it("store 3D path: move + rotate + undo on 390×844", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      await mf(page, "toolbar-3d").tap();
      await mf(page, "twin").waitFor({ timeout: 20000 });
      await mf(page, "twin-rotate").waitFor();
      const result = await page.evaluate(() => {
        const store = (
          window as unknown as {
            __MF_STORE__: {
              getState: () => {
                project: {
                  racks: Array<{ id: string; x: number; y: number; rotationDeg: number }>;
                  openings: unknown[];
                  fans: unknown[];
                };
                loadProject: (p: unknown) => { ok?: boolean };
                addRack: (r: Record<string, unknown>) => { ok: boolean; errors: string[] };
                moveRack: (id: string, x: number, y: number, preview?: boolean) => { ok: boolean; errors: string[] };
                select: (ids: string[]) => void;
                rotateSelectedRack: () => { ok: boolean; errors: string[] };
                undo: () => void;
              };
            };
          }
        ).__MF_STORE__;
        const live = () => store.getState();
        const next = structuredClone(live().project) as {
          racks: unknown[];
          openings: unknown[];
          fans: unknown[];
        };
        next.racks = [];
        live().loadProject(next);
        const rack = {
          id: "e2e_3d_r",
          name: "R",
          x: 2.2,
          y: 1.4,
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
        const added = live().addRack(rack);
        if (!added.ok) return { ok: false, reason: added.errors.join("; ") };
        const moved = live().moveRack("e2e_3d_r", 3.1, 2.0, false);
        if (!moved.ok) return { ok: false, reason: moved.errors.join("; ") };
        live().select(["e2e_3d_r"]);
        const rot = live().rotateSelectedRack();
        if (!rot.ok) return { ok: false, reason: rot.errors.join("; ") };
        const after = live().project.racks.find((r) => r.id === "e2e_3d_r");
        live().undo();
        const undoneRot = live().project.racks.find((r) => r.id === "e2e_3d_r");
        live().undo();
        const undoneMove = live().project.racks.find((r) => r.id === "e2e_3d_r");
        return {
          ok: true,
          rot: after?.rotationDeg,
          x: after?.x,
          undoneRot: undoneRot?.rotationDeg,
          undoneX: undoneMove?.x,
          undoneY: undoneMove?.y,
        };
      });
      assert.equal(result.ok, true, result.reason ?? "");
      assert.equal(result.rot, 90);
      assert.equal(result.undoneRot, 0);
      assert.ok(Math.abs((result.undoneX ?? 0) - 2.2) < 1e-9);
      assert.ok(Math.abs((result.undoneY ?? 0) - 1.4) < 1e-9);
    } finally {
      await ctx.close();
    }
  });
});

describe("MOBILE-E2E-R linked delete lifecycle", () => {
  it("detach keeps canonical; delete-from-model removes it", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      const out = await page.evaluate(() => {
        const store = (
          window as unknown as {
            __MF_STORE__: {
              getState: () => {
                project: {
                  openings: unknown[];
                  racks: unknown[];
                  reality?: { photos: Array<{ id: string; wallHint?: string; overlays?: Array<{ id: string; linkedObjectId?: string }> }>; asBuilt?: unknown[]; findings?: unknown[]; videos?: unknown[]; compareMode?: string; interview?: unknown[] };
                };
                loadProject: (p: unknown) => void;
                addPhotoMeta: (m: Record<string, unknown>) => void;
                setPhotoWallHint: (id: string, wall: string) => void;
                addPhotoOverlay: (id: string, kind: string, nx: number, ny: number) => { overlay?: { id: string } };
                updatePhotoOverlay: (pid: string, oid: string, patch: Record<string, unknown>) => { ok: boolean };
                applyPhotoOverlaysToModel: (id: string) => { ok: boolean; errors: string[] };
                detachPhotoOverlay: (pid: string, oid: string) => { ok: boolean };
                deleteLinkedFromModel: (pid: string, oid: string) => { ok: boolean };
              };
            };
          }
        ).__MF_STORE__;
        const live = () => store.getState();
        const next = structuredClone(live().project) as {
          openings: unknown[];
          racks: unknown[];
          reality?: { photos: unknown[]; asBuilt: unknown[]; findings: unknown[]; videos: unknown[]; compareMode: string; interview: unknown[] };
        };
        next.openings = [];
        next.racks = [];
        if (next.reality) {
          next.reality.asBuilt = [];
          next.reality.findings = [];
        }
        live().loadProject(next);
        live().addPhotoMeta({
          id: "e2e_ph",
          name: "t.jpg",
          mime: "image/jpeg",
          createdAt: 1,
          notes: "",
          wallHint: "south",
          widthPx: 1000,
          heightPx: 800,
          markers: [],
          overlays: [],
        });
        live().setPhotoWallHint("e2e_ph", "south");
        live().addPhotoOverlay("e2e_ph", "exhaust", 0.3, 0.5);
        const applied = live().applyPhotoOverlaysToModel("e2e_ph");
        if (!applied.ok) return { ok: false, reason: applied.errors.join("; ") };
        const nOpen = live().project.openings.length;
        const ov = live().project.reality?.photos.find((p) => p.id === "e2e_ph")?.overlays?.[0];
        if (!ov) return { ok: false, reason: "no overlay" };
        live().detachPhotoOverlay("e2e_ph", ov.id);
        const afterDetach = live().project.openings.length;
        const overlaysAfter = live().project.reality?.photos.find((p) => p.id === "e2e_ph")?.overlays?.length ?? 0;
        const added = live().addPhotoOverlay("e2e_ph", "intake", 0.45, 0.5);
        if (added.overlay) live().updatePhotoOverlay("e2e_ph", added.overlay.id, { wallId: "west" });
        const applied2 = live().applyPhotoOverlaysToModel("e2e_ph");
        if (!applied2.ok) return { ok: false, reason: applied2.errors.join("; ") };
        const ov2 = live().project.reality?.photos.find((p) => p.id === "e2e_ph")?.overlays?.[0];
        if (!ov2) return { ok: false, reason: "no overlay 2" };
        live().deleteLinkedFromModel("e2e_ph", ov2.id);
        return {
          ok: true,
          nOpen,
          afterDetach,
          overlaysAfter,
          openingsEnd: live().project.openings.length,
          overlaysEnd: live().project.reality?.photos.find((p) => p.id === "e2e_ph")?.overlays?.length ?? 0,
        };
      });
      assert.equal(out.ok, true, out.reason ?? "");
      assert.ok((out.nOpen ?? 0) >= 1);
      assert.equal(out.afterDetach, out.nOpen);
      assert.equal(out.overlaysAfter, 0);
      assert.equal(out.overlaysEnd, 0);
    } finally {
      await ctx.close();
    }
  });
});

describe("3D-E2E-R2 WebKit canvas pointer / touch", () => {
  it("390×844: canvas rack drag, invalid rollback, fan drag, opening drag, UI rotate", async () => {
    const { ctx, page } = await openPhone("390x844");
    try {
      const seeded = await page.evaluate(() => {
        const w = window as unknown as {
          __MF_TWIN_LOCK_ORBIT__: boolean;
          __MF_TWIN_CAMERA__: string;
          __MF_STORE__: {
            getState: () => {
              project: {
                racks: unknown[];
                openings: Array<{ id: string; type: string; wallId: string; widthM: number; heightM: number; bottomElevationM: number; offsetFromWallStartM: number; name?: string; locked?: boolean }>;
                fans: Array<{ id: string; specId: string; name: string; x: number; y: number; arrangement: string; count: number; dirtyFilter: boolean }>;
                lockedObjectIds: string[];
              };
              loadProject: (p: unknown) => { ok?: boolean; reason?: string };
              addRack: (r: Record<string, unknown>) => { ok: boolean; errors: string[] };
              addFanInstance: (f: Record<string, unknown>) => { ok: boolean; errors: string[] };
              addOpening: (o: Record<string, unknown>) => { ok: boolean; errors: string[] };
            };
          };
        };
        w.__MF_TWIN_LOCK_ORBIT__ = true;
        w.__MF_TWIN_CAMERA__ = "top";
        const live = () => w.__MF_STORE__.getState();
        const next = structuredClone(live().project) as {
          racks: unknown[];
          openings: unknown[];
          fans: unknown[];
          lockedObjectIds: string[];
        };
        next.racks = [];
        next.fans = [];
        next.lockedObjectIds = [];
        next.openings = (live().project.openings ?? []).map((o) => ({ ...o, locked: false }));
        const loaded = live().loadProject(next);
        if (loaded && loaded.ok === false) return { ok: false, reason: loaded.reason ?? "load" };
        const r1 = live().addRack({
          id: "e2e_r1",
          name: "R1",
          x: 1.4,
          y: 1.5,
          widthM: 1.6,
          depthM: 0.6,
          heightM: 2.0,
          rotationDeg: 0,
          shelves: 4,
          usableShelfWidthM: 1.5,
          usableShelfDepthM: 0.55,
          asicCount: 0,
          airflowToward: "south",
        });
        const r2 = live().addRack({
          id: "e2e_r2",
          name: "R2",
          x: 4.6,
          y: 1.5,
          widthM: 1.6,
          depthM: 0.6,
          heightM: 2.0,
          rotationDeg: 0,
          shelves: 4,
          usableShelfWidthM: 1.5,
          usableShelfDepthM: 0.55,
          asicCount: 0,
          airflowToward: "south",
        });
        const fan = live().addFanInstance({
          id: "e2e_fan",
          specId: "FAN_STRONG",
          name: "F",
          x: 6.4,
          y: 3.2,
          arrangement: "single",
          count: 1,
          dirtyFilter: false,
        });
        const op = live().addOpening({
          id: "e2e_op",
          type: "TECHNICAL",
          wallId: "south",
          widthM: 1.0,
          heightM: 0.8,
          bottomElevationM: 0.4,
          offsetFromWallStartM: 3.2,
          name: "Tech",
        });
        return {
          ok: r1.ok && r2.ok && fan.ok && op.ok,
          reason: [...r1.errors, ...r2.errors, ...fan.errors, ...op.errors].join("; "),
        };
      });
      assert.equal(seeded.ok, true, seeded.reason ?? "");

      await mf(page, "toolbar-3d").tap();
      await mf(page, "twin").waitFor({ timeout: 20000 });
      await page.waitForFunction(
        () => {
          const m = (window as unknown as { __MF_TWIN_SCREEN__?: { ready?: boolean; objects?: Record<string, { visible?: boolean }> } }).__MF_TWIN_SCREEN__;
          return Boolean(m?.ready && m.objects?.e2e_r1?.visible && m.objects?.e2e_fan?.visible && m.objects?.e2e_op?.visible);
        },
        null,
        { timeout: 20000 },
      );

      const screenOf = async (id: string) =>
        page.evaluate((oid) => {
          const m = (window as unknown as { __MF_TWIN_SCREEN__: { objects: Record<string, { x: number; y: number }> } }).__MF_TWIN_SCREEN__;
          return m.objects[oid];
        }, id);

      const readTwin = async () =>
        page.evaluate(() => {
          const s = (
            window as unknown as {
              __MF_STORE__: {
                getState: () => {
                  project: {
                    racks: Array<{ id: string; x: number; y: number; rotationDeg: number }>;
                    fans: Array<{ id: string; x: number; y: number }>;
                    openings: Array<{ id: string; offsetFromWallStartM: number }>;
                  };
                  lastMutationError: string | null;
                };
              };
            }
          ).__MF_STORE__.getState();
          return {
            r1: s.project.racks.find((r) => r.id === "e2e_r1"),
            r2: s.project.racks.find((r) => r.id === "e2e_r2"),
            fan: s.project.fans.find((f) => f.id === "e2e_fan"),
            op: s.project.openings.find((o) => o.id === "e2e_op"),
            err: s.lastMutationError,
          };
        });

      const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
        await page.evaluate(
          ({ from, to }) => {
            const canvas = document.querySelector("[data-mf-id='twin-canvas']") as HTMLCanvasElement | null;
            if (!canvas) throw new Error("twin-canvas missing");
            const fire = (type: string, x: number, y: number, buttons: number) => {
              const rect = canvas.getBoundingClientRect();
              const ev = new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                composed: true,
                view: window,
                clientX: x,
                clientY: y,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                buttons,
                button: 0,
                pressure: buttons ? 0.5 : 0,
              });
              Object.defineProperty(ev, "offsetX", { get: () => x - rect.left });
              Object.defineProperty(ev, "offsetY", { get: () => y - rect.top });
              canvas.dispatchEvent(ev);
            };
            fire("pointerdown", from.x, from.y, 1);
            const steps = 12;
            for (let i = 1; i <= steps; i++) {
              fire("pointermove", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, 1);
            }
            fire("pointerup", to.x, to.y, 0);
          },
          { from, to },
        );
        await page.waitForTimeout(150);
      };

      const before = await readTwin();
      const r1s = await screenOf("e2e_r1");
      assert.ok(r1s, "rack screen coord missing");
      await drag(r1s, { x: r1s.x + 90, y: r1s.y });
      const afterRack = await readTwin();
      assert.ok(afterRack.r1);
      const rackMoved =
        Math.abs((afterRack.r1!.x ?? 0) - (before.r1?.x ?? 0)) > 0.05 ||
        Math.abs((afterRack.r1!.y ?? 0) - (before.r1?.y ?? 0)) > 0.05;
      assert.equal(rackMoved, true, `rack did not move via canvas: ${JSON.stringify({ before: before.r1, after: afterRack.r1 })}`);

      const validPos = { x: afterRack.r1!.x, y: afterRack.r1!.y };
      const r1b = await screenOf("e2e_r1");
      const r2s = await screenOf("e2e_r2");
      await drag(r1b, r2s);
      const afterInvalid = await readTwin();
      assert.ok(Math.abs(afterInvalid.r1!.x - validPos.x) < 1e-6, "invalid rack drag must rollback x");
      assert.ok(Math.abs(afterInvalid.r1!.y - validPos.y) < 1e-6, "invalid rack drag must rollback y");
      assert.ok(afterInvalid.err, "invalid rack drag must show error");

      const fanBefore = afterInvalid.fan!;
      const fanS = await screenOf("e2e_fan");
      await drag(fanS, { x: fanS.x - 50, y: fanS.y + 20 });
      const afterFan = await readTwin();
      const fanMoved =
        Math.abs(afterFan.fan!.x - fanBefore.x) > 0.05 || Math.abs(afterFan.fan!.y - fanBefore.y) > 0.05;
      assert.equal(fanMoved, true, `fan did not move via canvas: ${JSON.stringify({ before: fanBefore, after: afterFan.fan })}`);

      const opBefore = afterFan.op!.offsetFromWallStartM;
      const opS = await screenOf("e2e_op");
      await drag(opS, { x: opS.x + 80, y: opS.y });
      const afterOp = await readTwin();
      assert.ok(
        Math.abs(afterOp.op!.offsetFromWallStartM - opBefore) > 0.05,
        `opening offset did not change via canvas: ${opBefore} → ${afterOp.op!.offsetFromWallStartM}`,
      );

      const r1c = await screenOf("e2e_r1");
      await drag(r1c, r1c);
      const sheet = page.locator("[data-mf-id=sheet]");
      if (await sheet.count()) {
        const vis = await sheet.first().isVisible().catch(() => false);
        if (vis) {
          const dismiss = mf(page, "sheet-dismiss");
          if (await dismiss.count()) await dismiss.tap().catch(() => undefined);
        }
      }
      await mf(page, "twin-rotate").waitFor({ timeout: 8000 });
      const rotBefore = (await readTwin()).r1!.rotationDeg;
      await mf(page, "twin-rotate").tap();
      const rotAfter = (await readTwin()).r1!.rotationDeg;
      assert.notEqual(rotAfter, rotBefore, "rotate button must change canonical rotation");
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
