/**
 * Browser video → still frames. Fail-closed. No synthetic frames.
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
import type { RealityPhotoMeta, RealityVideoMeta, VideoErrorCode } from "../engineering/types.ts";

const liveUrls = new Set<string>();

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

if (typeof window !== "undefined") {
  (window as unknown as { __MF_VIDEO__: { liveObjectUrlCount: typeof liveObjectUrlCount; probeCanPlay: typeof probeCanPlay } }).__MF_VIDEO__ = {
    liveObjectUrlCount,
    probeCanPlay,
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

function waitPresented(video: HTMLVideoElement, ms = 350): Promise<void> {
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
    if (typeof rvfc === "function") rvfc.call(video, () => done());
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
    window.setTimeout(done, ms);
  });
}

function captureFrame(
  video: HTMLVideoElement,
): { dataUrl: string; widthPx: number; heightPx: number; luma: number } | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!(vw > 0) || !(vh > 0)) return null;
  const scale = Math.min(1, VIDEO_LIMITS.maxEdgePx / Math.max(vw, vh));
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const pix = ctx.getImageData(Math.max(0, Math.floor(w / 2)), Math.max(0, Math.floor(h / 2)), 1, 1).data;
  const luma = pix[0] + pix[1] + pix[2];
  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  }
  if (!dataUrl.startsWith("data:image/")) return null;
  ctx.clearRect(0, 0, w, h);
  canvas.width = 0;
  canvas.height = 0;
  return { dataUrl, widthPx: w, heightPx: h, luma };
}

async function capturePresented(
  video: HTMLVideoElement,
  signal: AbortSignal,
): Promise<{ dataUrl: string; widthPx: number; heightPx: number; luma: number } | null> {
  let last: { dataUrl: string; widthPx: number; heightPx: number; luma: number } | null = null;
  for (let i = 0; i < 8; i++) {
    if (signal.aborted) return null;
    await waitPresented(video);
    last = captureFrame(video);
    if (last && last.luma > 12) return last;
    try {
      await video.play();
      await waitPresented(video);
      video.pause();
    } catch {
      /* muted play is best-effort */
    }
    await new Promise((r) => window.setTimeout(r, 40));
  }
  return last;
}

export async function extractVideoFrames(
  file: File,
  opts: { signal?: AbortSignal; now?: number } = {},
): Promise<VideoExtractResult> {
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
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "true");
  video.setAttribute("muted", "");
  video.controls = false;
  video.style.cssText = "position:fixed;left:-10000px;top:0;width:80px;height:45px;opacity:0.01;pointer-events:none;";
  document.body.appendChild(video);
  video.src = url;
  video.load();

  try {
    await waitEvent(video, "loadedmetadata", "error", 12000);
    if (signal.aborted) return fail("VIDEO_CANCELLED");
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      await waitEvent(video, "durationchange", "error", 4000).catch(() => undefined);
    }
    const durationMs = (Number.isFinite(video.duration) ? video.duration : 0) * 1000;
    if (!(durationMs > 0)) return fail("VIDEO_ZERO_DURATION");
    if (!(video.videoWidth > 0) || !(video.videoHeight > 0)) return fail("VIDEO_DECODE_FAILED");

    try {
      await video.play();
      await waitPresented(video);
      video.pause();
    } catch {
      /* decoder prime is best-effort */
    }

    const stamps = sampleTimestampsMs(durationMs);
    if (!stamps.length) return fail("VIDEO_DECODE_FAILED");

    const frames: ExtractedFrame[] = [];
    const seen = new Set<string>();
    for (const ts of stamps) {
      if (signal.aborted) return fail("VIDEO_CANCELLED");
      await seekVideo(video, ts / 1000, signal);
      if (signal.aborted) return fail("VIDEO_CANCELLED");
      const cap = await capturePresented(video, signal);
      if (!cap || cap.luma <= 12) continue;
      if (seen.has(cap.dataUrl)) continue;
      seen.add(cap.dataUrl);
      const id = nid("frame");
      frames.push({
        dataUrl: cap.dataUrl,
        photo: framePhotoMeta({
          id,
          videoId,
          filename: file.name || "video",
          timestampMs: ts,
          widthPx: cap.widthPx,
          heightPx: cap.heightPx,
          createdAt: now,
        }),
      });
    }

    if (frames.length < 2) return fail("VIDEO_DECODE_FAILED");

    const videoMeta: RealityVideoMeta = {
      ...base,
      mime: classified.mime,
      durationMs,
      widthPx: video.videoWidth,
      heightPx: video.videoHeight,
      status: "ready",
      frameIds: frames.map((f) => f.photo.id),
      selectedFrameIds: frames.slice(0, 1).map((f) => f.photo.id),
      persistRaw: false,
    };
    return { ok: true, video: videoMeta, frames };
  } catch (e) {
    if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return fail("VIDEO_CANCELLED");
    return fail("VIDEO_DECODE_FAILED");
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    revokeTracked(url);
  }
}
