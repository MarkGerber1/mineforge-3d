/**
 * Browser video → still frames. Fail-closed. No synthetic frames.
 * 1) visible <video> play-through + canvas / ImageBitmap / VideoFrame
 * 2) seek+canvas retry
 * 3) WebCodecs VP8 (WebM) when the element presents no pixels
 * Object URLs are tracked and always revoked.
 */
import { nid } from "../project/factory.ts";
import {
  VIDEO_ERROR_RU,
  VIDEO_LIMITS,
  classifyVideoFile,
  framePhotoMeta,
  sampleTimestampsMs,
  videoMetaSkeleton,
} from "./video-policy.ts";
import { demuxVp8Webm } from "./webm.ts";
import type { RealityPhotoMeta, RealityVideoMeta, VideoErrorCode } from "../engineering/types.ts";

const liveUrls = new Set<string>();
const LUMA_MIN = 12;

export interface ExtractDiag {
  method: string;
  lumas: number[];
  uniqueCount: number;
  rVfcFired: boolean;
  playError: string | null;
  webCodecsSupported: boolean | null;
  webCodecsError: string | null;
  durationMs: number;
  width: number;
  height: number;
}

const diag: ExtractDiag = {
  method: "",
  lumas: [],
  uniqueCount: 0,
  rVfcFired: false,
  playError: null,
  webCodecsSupported: null,
  webCodecsError: null,
  durationMs: 0,
  width: 0,
  height: 0,
};

function resetDiag(): void {
  diag.method = "";
  diag.lumas = [];
  diag.uniqueCount = 0;
  diag.rVfcFired = false;
  diag.playError = null;
  diag.webCodecsSupported = null;
  diag.webCodecsError = null;
  diag.durationMs = 0;
  diag.width = 0;
  diag.height = 0;
}

export function lastExtractDiag(): ExtractDiag {
  return { ...diag, lumas: [...diag.lumas] };
}

export function liveObjectUrlCount(): number {
  return liveUrls.size;
}

function trackedObjectUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  liveUrls.add(url);
  return url;
}

function revokeTracked(url: string): void {
  if (!liveUrls.has(url)) return;
  URL.revokeObjectURL(url);
  liveUrls.delete(url);
}

export interface ExtractedFrame {
  photo: RealityPhotoMeta;
  dataUrl: string;
}

export interface VideoExtractResult {
  ok: boolean;
  video: RealityVideoMeta;
  frames: ExtractedFrame[];
  error?: VideoErrorCode;
  errorText?: string;
}

type Capture = { dataUrl: string; widthPx: number; heightPx: number; luma: number };

function canPlayMime(mime: string): string {
  if (typeof document === "undefined") return "";
  const el = document.createElement("video");
  try {
    return el.canPlayType(mime);
  } catch {
    return "";
  }
}

export function probeCanPlay(): Record<string, string> {
  const mimes = [
    "video/webm",
    'video/webm; codecs="vp8"',
    'video/webm; codecs="vp8.0"',
    "video/mp4",
    'video/mp4; codecs="avc1.42E01E"',
    "video/ogg",
    'video/ogg; codecs="theora"',
    "video/quicktime",
  ];
  const out: Record<string, string> = {};
  for (const m of mimes) out[m] = canPlayMime(m);
  return out;
}

export async function probeWebCodecs(): Promise<{ vp8: boolean; avc1: boolean }> {
  if (typeof VideoDecoder === "undefined" || typeof VideoDecoder.isConfigSupported !== "function") {
    return { vp8: false, avc1: false };
  }
  try {
    const vp8 = await VideoDecoder.isConfigSupported({ codec: "vp8", codedWidth: 320, codedHeight: 180 });
    const avc1 = await VideoDecoder.isConfigSupported({
      codec: "avc1.42E01E",
      codedWidth: 320,
      codedHeight: 180,
    });
    return { vp8: Boolean(vp8.supported), avc1: Boolean(avc1.supported) };
  } catch {
    return { vp8: false, avc1: false };
  }
}

if (typeof window !== "undefined") {
  (window as unknown as { __MF_VIDEO__: Record<string, unknown> }).__MF_VIDEO__ = {
    liveObjectUrlCount,
    probeCanPlay,
    probeWebCodecs,
    lastExtractDiag,
  };
}

function waitEvent(target: EventTarget, ok: string, err: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("timeout")), ms);
    const done = () => {
      window.clearTimeout(t);
      target.removeEventListener(ok, onOk);
      target.removeEventListener(err, onErr);
    };
    const onOk = () => {
      done();
      resolve();
    };
    const onErr = () => {
      done();
      reject(new Error(err));
    };
    target.addEventListener(ok, onOk);
    target.addEventListener(err, onErr);
  });
}

function seekVideo(video: HTMLVideoElement, timeSec: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error("seek"));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("aborted", "AbortError"));
    };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onErr);
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onErr);
    const dur = Number.isFinite(video.duration) ? video.duration : timeSec;
    const t = Math.min(Math.max(0, timeSec), Math.max(0, dur - 1e-3));
    if (Math.abs(video.currentTime - t) < 1e-3) {
      cleanup();
      resolve();
      return;
    }
    try {
      video.currentTime = t;
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

function waitPresented(video: HTMLVideoElement, ms = 400): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const rvfc = (
      video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void }
    ).requestVideoFrameCallback;
    if (typeof rvfc === "function") {
      rvfc.call(video, () => {
        diag.rVfcFired = true;
        done();
      });
    }
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
    window.setTimeout(done, ms);
  });
}

function jpegFromCanvas(canvas: HTMLCanvasElement): Capture | null {
  const w = canvas.width;
  const h = canvas.height;
  if (!(w > 0) || !(h > 0)) return null;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const pix = ctx.getImageData(Math.max(0, Math.floor(w / 2)), Math.max(0, Math.floor(h / 2)), 1, 1).data;
  const luma = pix[0]! + pix[1]! + pix[2]!;
  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  }
  if (!dataUrl.startsWith("data:image/")) return null;
  return { dataUrl, widthPx: w, heightPx: h, luma };
}

function drawSource(
  source: CanvasImageSource,
  vw: number,
  vh: number,
): Capture | null {
  if (!(vw > 0) || !(vh > 0)) return null;
  const scale = Math.min(1, VIDEO_LIMITS.maxEdgePx / Math.max(vw, vh));
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(source, 0, 0, w, h);
  } catch {
    canvas.width = 0;
    canvas.height = 0;
    return null;
  }
  const cap = jpegFromCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  canvas.width = 0;
  canvas.height = 0;
  return cap;
}

async function grabPixels(video: HTMLVideoElement): Promise<Capture | null> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  let cap = drawSource(video, vw, vh);
  if (cap && cap.luma > LUMA_MIN) return cap;

  try {
    const bmp = await createImageBitmap(video);
    const fromBmp = drawSource(bmp, bmp.width, bmp.height);
    bmp.close();
    if (fromBmp && fromBmp.luma > LUMA_MIN) return fromBmp;
    if (fromBmp) cap = fromBmp;
  } catch {
    /* ImageBitmap of a video is optional */
  }

  if (typeof VideoFrame === "function") {
    try {
      const vf = new VideoFrame(video);
      const fromVf = await videoFrameToJpeg(vf);
      vf.close();
      if (fromVf && fromVf.luma > LUMA_MIN) return fromVf;
      if (fromVf) cap = fromVf;
    } catch {
      /* VideoFrame(HTMLVideoElement) is optional */
    }
  }
  return cap;
}

async function videoFrameToJpeg(frame: VideoFrame): Promise<Capture | null> {
  const vw = frame.displayWidth || frame.codedWidth;
  const vh = frame.displayHeight || frame.codedHeight;
  const drawn = drawSource(frame as unknown as CanvasImageSource, vw, vh);
  if (drawn && drawn.luma > LUMA_MIN) return drawn;

  try {
    const scale = Math.min(1, VIDEO_LIMITS.maxEdgePx / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return drawn;
    const imageData = ctx.createImageData(w, h);
    try {
      await frame.copyTo(imageData.data, { format: "RGBA" });
      ctx.putImageData(imageData, 0, 0);
      const cap = jpegFromCanvas(canvas);
      canvas.width = 0;
      canvas.height = 0;
      if (cap) return cap;
    } catch {
      /* RGBA copyTo unsupported — try default layout */
    }
    const needed = frame.allocationSize();
    const buf = new Uint8Array(needed);
    const layout = await frame.copyTo(buf);
    i420ToRgba(buf, layout, vw, vh, imageData.data, w, h);
    ctx.putImageData(imageData, 0, 0);
    const cap = jpegFromCanvas(canvas);
    canvas.width = 0;
    canvas.height = 0;
    return cap ?? drawn;
  } catch {
    return drawn;
  }
}

function i420ToRgba(
  buf: Uint8Array,
  layout: readonly { offset: number; stride: number }[] | undefined,
  srcW: number,
  srcH: number,
  out: Uint8ClampedArray,
  dstW: number,
  dstH: number,
): void {
  const yPlane = layout?.[0];
  const uPlane = layout?.[1];
  const vPlane = layout?.[2];
  const yOff = yPlane?.offset ?? 0;
  const yStride = yPlane?.stride ?? srcW;
  const uOff = uPlane?.offset ?? srcW * srcH;
  const vOff = vPlane?.offset ?? uOff + Math.floor((srcW * srcH) / 4);
  const uStride = uPlane?.stride ?? Math.floor(srcW / 2);
  const vStride = vPlane?.stride ?? Math.floor(srcW / 2);
  for (let dy = 0; dy < dstH; dy++) {
    const sy = Math.min(srcH - 1, Math.floor((dy * srcH) / dstH));
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.min(srcW - 1, Math.floor((dx * srcW) / dstW));
      const y = buf[yOff + sy * yStride + sx] ?? 0;
      const uvRow = Math.floor(sy / 2);
      const uvCol = Math.floor(sx / 2);
      const u = buf[uOff + uvRow * uStride + uvCol] ?? 128;
      const v = buf[vOff + uvRow * vStride + uvCol] ?? 128;
      const c = y - 16;
      const d = u - 128;
      const e = v - 128;
      const r = Math.max(0, Math.min(255, Math.round((298 * c + 409 * e + 128) >> 8)));
      const g = Math.max(0, Math.min(255, Math.round((298 * c - 100 * d - 208 * e + 128) >> 8)));
      const b = Math.max(0, Math.min(255, Math.round((298 * c + 516 * d + 128) >> 8)));
      const i = (dy * dstW + dx) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
}

function acceptCapture(
  cap: Capture | null,
  tsMs: number,
  seen: Set<string>,
  slots: Array<{ ts: number; cap: Capture } | null>,
  targets: number[],
): void {
  if (!cap) return;
  diag.lumas.push(cap.luma);
  if (cap.luma <= LUMA_MIN) return;
  if (seen.has(cap.dataUrl)) return;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < targets.length; i++) {
    if (slots[i]) continue;
    const d = Math.abs(targets[i]! - tsMs);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  if (best < 0) return;
  if (bestDist > 550) return;
  seen.add(cap.dataUrl);
  slots[best] = { ts: tsMs, cap };
}

function slotsToFrames(
  slots: Array<{ ts: number; cap: Capture } | null>,
  args: { videoId: string; filename: string; now: number; method: RealityPhotoMeta["extractionMethod"] },
): ExtractedFrame[] {
  const frames: ExtractedFrame[] = [];
  for (const slot of slots) {
    if (!slot) continue;
    const id = nid("frame");
    frames.push({
      dataUrl: slot.cap.dataUrl,
      photo: framePhotoMeta({
        id,
        videoId: args.videoId,
        filename: args.filename,
        timestampMs: Math.round(slot.ts),
        widthPx: slot.cap.widthPx,
        heightPx: slot.cap.heightPx,
        createdAt: args.now,
        extractionMethod: args.method,
      }),
    });
  }
  diag.uniqueCount = frames.length;
  return frames;
}

function mountVisibleVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "true");
  video.setAttribute("muted", "");
  video.setAttribute("data-mf-id", "video-decode-el");
  video.controls = false;
  video.autoplay = false;
  video.disablePictureInPicture = true;
  video.style.cssText =
    "position:fixed;left:0;top:0;width:320px;height:180px;opacity:1;z-index:2147483646;background:#111;pointer-events:none;";
  document.body.appendChild(video);
  return video;
}

async function playThroughCapture(
  video: HTMLVideoElement,
  targets: number[],
  signal: AbortSignal,
): Promise<Array<{ ts: number; cap: Capture } | null>> {
  const slots: Array<{ ts: number; cap: Capture } | null> = targets.map(() => null);
  const seen = new Set<string>();
  const consider = async (mediaSec: number) => {
    if (signal.aborted) return;
    const cap = await grabPixels(video);
    acceptCapture(cap, mediaSec * 1000, seen, slots, targets);
  };

  try {
    const playP = video.play();
    await playP;
  } catch (e) {
    diag.playError = e instanceof Error ? e.message : String(e);
    return slots;
  }

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("ended", onEnded);
      resolve();
    };
    const onTime = () => {
      void consider(video.currentTime);
      if (slots.every(Boolean)) finish();
    };
    const onEnded = () => {
      void consider(video.currentTime).finally(() => finish());
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("ended", onEnded);
    const rvfc = (
      video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
      }
    ).requestVideoFrameCallback;
    const loop = (_now: number, meta: { mediaTime: number }) => {
      if (done) return;
      diag.rVfcFired = true;
      void consider(meta?.mediaTime ?? video.currentTime);
      if (slots.every(Boolean)) {
        finish();
        return;
      }
      if (typeof rvfc === "function") rvfc.call(video, loop);
    };
    if (typeof rvfc === "function") rvfc.call(video, loop);
    const ms = Math.max(8000, (Number.isFinite(video.duration) ? video.duration : 4) * 1000 + 4000);
    window.setTimeout(finish, ms);
  });

  try {
    video.pause();
  } catch {
    /* ignore */
  }
  return slots;
}

async function seekCapture(
  video: HTMLVideoElement,
  targets: number[],
  signal: AbortSignal,
  slots: Array<{ ts: number; cap: Capture } | null>,
): Promise<void> {
  const seen = new Set(slots.filter(Boolean).map((s) => s!.cap.dataUrl));
  for (const ts of targets) {
    if (signal.aborted) return;
    if (slots.every(Boolean)) return;
    try {
      await seekVideo(video, ts / 1000, signal);
      try {
        await video.play();
      } catch {
        /* muted play best-effort */
      }
      await waitPresented(video);
      const cap = await grabPixels(video);
      acceptCapture(cap, ts, seen, slots, targets);
    } catch {
      /* keep going */
    }
  }
}

async function webCodecsVp8(
  file: File,
  targets: number[],
): Promise<{
  slots: Array<{ ts: number; cap: Capture } | null>;
  width: number;
  height: number;
  durationMs: number;
} | null> {
  if (typeof VideoDecoder === "undefined") {
    diag.webCodecsSupported = false;
    return null;
  }
  let supported = false;
  try {
    const cfg = await VideoDecoder.isConfigSupported({ codec: "vp8", codedWidth: 320, codedHeight: 180 });
    supported = Boolean(cfg.supported);
  } catch (e) {
    diag.webCodecsError = e instanceof Error ? e.message : String(e);
    diag.webCodecsSupported = false;
    return null;
  }
  diag.webCodecsSupported = supported;
  if (!supported) return null;

  const buf = await file.arrayBuffer();
  const demuxed = demuxVp8Webm(buf);
  if (!demuxed) {
    diag.webCodecsError = "not-vp8-webm";
    return null;
  }
  const slots: Array<{ ts: number; cap: Capture } | null> = targets.map(() => null);
  const seen = new Set<string>();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let pending = 0;
    let flushed = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const maybeFinish = () => {
      if (flushed && pending === 0) finish();
    };
    const decoder = new VideoDecoder({
      output: (frame) => {
        const tsMs = frame.timestamp / 1000;
        const vw = frame.displayWidth || frame.codedWidth;
        const vh = frame.displayHeight || frame.codedHeight;
        const sync = drawSource(frame as unknown as CanvasImageSource, vw, vh);
        if (sync && sync.luma > LUMA_MIN) {
          acceptCapture(sync, tsMs, seen, slots, targets);
          try {
            frame.close();
          } catch {
            /* ignore */
          }
          return;
        }
        pending += 1;
        const copy = typeof frame.clone === "function" ? frame.clone() : frame;
        if (copy !== frame) {
          try {
            frame.close();
          } catch {
            /* ignore */
          }
        }
        void videoFrameToJpeg(copy)
          .then((cap) => acceptCapture(cap, tsMs, seen, slots, targets))
          .finally(() => {
            try {
              copy.close();
            } catch {
              /* ignore */
            }
            pending -= 1;
            maybeFinish();
          });
      },
      error: (e) => {
        diag.webCodecsError = e.message;
        if (!settled) {
          settled = true;
          reject(e);
        }
      },
    });
    try {
      try {
        decoder.configure({
          codec: "vp8",
          codedWidth: demuxed.width,
          codedHeight: demuxed.height,
          hardwareAcceleration: "prefer-software",
        });
      } catch {
        decoder.configure({
          codec: "vp8",
          codedWidth: demuxed.width,
          codedHeight: demuxed.height,
        });
      }
      for (const sample of demuxed.samples) {
        decoder.decode(
          new EncodedVideoChunk({
            type: sample.keyframe ? "key" : "delta",
            timestamp: Math.round(sample.timestampMs * 1000),
            data: sample.data,
          }),
        );
      }
      void decoder.flush().then(() => {
        try {
          decoder.close();
        } catch {
          /* ignore */
        }
        flushed = true;
        maybeFinish();
        window.setTimeout(finish, 4000);
      });
    } catch (e) {
      diag.webCodecsError = e instanceof Error ? e.message : String(e);
      try {
        decoder.close();
      } catch {
        /* ignore */
      }
      finish();
    }
  }).catch((e) => {
    diag.webCodecsError = e instanceof Error ? e.message : String(e);
  });

  return { slots, width: demuxed.width, height: demuxed.height, durationMs: demuxed.durationMs };
}

export async function extractVideoFrames(
  file: File,
  opts: { signal?: AbortSignal; now?: number } = {},
): Promise<VideoExtractResult> {
  resetDiag();
  const now = opts.now ?? Date.now();
  const videoId = nid("vid");
  const classified = classifyVideoFile(file, canPlayMime);
  const base = videoMetaSkeleton({
    id: videoId,
    name: file.name || "video",
    mime: file.type || "application/octet-stream",
    createdAt: now,
  });

  const fail = (code: VideoErrorCode): VideoExtractResult => ({
    ok: false,
    video: { ...base, status: code === "VIDEO_CANCELLED" ? "cancelled" : "failed", error: code, persistRaw: false },
    frames: [],
    error: code,
    errorText: VIDEO_ERROR_RU[code],
  });

  if (!classified.ok) return fail(classified.code);

  const signal = opts.signal ?? new AbortController().signal;
  if (signal.aborted) return fail("VIDEO_CANCELLED");

  const url = trackedObjectUrl(file);
  const video = mountVisibleVideo();
  video.src = url;
  video.load();

  let durationMs = 0;
  let widthPx = 0;
  let heightPx = 0;
  let frames: ExtractedFrame[] = [];
  let method: RealityPhotoMeta["extractionMethod"] = "video-play-canvas";

  try {
    try {
      await waitEvent(video, "loadedmetadata", "error", 12000);
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        await waitEvent(video, "durationchange", "error", 4000).catch(() => undefined);
      }
      durationMs = (Number.isFinite(video.duration) ? video.duration : 0) * 1000;
      widthPx = video.videoWidth;
      heightPx = video.videoHeight;
    } catch {
      /* metadata best-effort — WebCodecs may still decode */
    }
    diag.durationMs = durationMs;
    diag.width = widthPx;
    diag.height = heightPx;
    if (signal.aborted) return fail("VIDEO_CANCELLED");

    const stamps = durationMs > 0 ? sampleTimestampsMs(durationMs) : sampleTimestampsMs(4000);
    if (!stamps.length) return fail("VIDEO_DECODE_FAILED");

    let slots: Array<{ ts: number; cap: Capture } | null> = stamps.map(() => null);
    if (durationMs > 0 && widthPx > 0 && heightPx > 0) {
      slots = await playThroughCapture(video, stamps, signal);
      diag.method = "video-play-canvas";
      if (slots.filter(Boolean).length < 2) {
        await seekCapture(video, stamps, signal, slots);
        if (slots.filter(Boolean).length >= 2) diag.method = "video-seek-canvas";
      }
    }

    if (slots.filter(Boolean).length < 2) {
      const wc = await webCodecsVp8(file, stamps);
      if (wc && wc.slots.filter(Boolean).length >= 2) {
        slots = wc.slots;
        method = "video-webcodecs";
        diag.method = "video-webcodecs";
        if (!(durationMs > 0)) durationMs = wc.durationMs;
        if (!(widthPx > 0)) widthPx = wc.width;
        if (!(heightPx > 0)) heightPx = wc.height;
        diag.durationMs = durationMs;
        diag.width = widthPx;
        diag.height = heightPx;
      }
    } else {
      method = diag.method === "video-seek-canvas" ? "video-seek-canvas" : "video-play-canvas";
    }

    frames = slotsToFrames(slots, { videoId, filename: file.name || "video", now, method });
    if (frames.length < 2) return fail("VIDEO_DECODE_FAILED");
    if (!(durationMs > 0)) return fail("VIDEO_ZERO_DURATION");
    if (!(widthPx > 0) || !(heightPx > 0)) return fail("VIDEO_DECODE_FAILED");

    const videoMeta: RealityVideoMeta = {
      ...base,
      mime: classified.mime,
      durationMs,
      widthPx,
      heightPx,
      status: "ready",
      frameIds: frames.map((f) => f.photo.id),
      selectedFrameIds: frames.slice(0, 1).map((f) => f.photo.id),
      persistRaw: false,
    };
    return { ok: true, video: videoMeta, frames };
  } catch (e) {
    if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return fail("VIDEO_CANCELLED");
    diag.playError = diag.playError ?? (e instanceof Error ? e.message : String(e));
    return fail("VIDEO_DECODE_FAILED");
  } finally {
    try {
      video.pause();
    } catch {
      /* ignore */
    }
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      /* ignore */
    }
    video.remove();
    revokeTracked(url);
  }
}
