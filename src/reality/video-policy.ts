/**
 * Deterministic video evidence policy. Browser decode lives in video.ts.
 * Extraction never claims FIELD_MEASUREMENT and never mutates geometry.
 */
import type { RealityPhotoMeta, RealityVideoMeta, VideoErrorCode } from "../engineering/types.ts";

export const VIDEO_LIMITS = {
  /** Max uploaded source bytes. Above this → VIDEO_TOO_LARGE. */
  maxBytes: 24 * 1024 * 1024,
  /** Hard cap on extracted stills. */
  maxFrames: 6,
  /** Sampling fractions: start, 25%, 50%, 75%, end. */
  sampleCount: 5,
  /** Longest edge of a stored frame JPEG. */
  maxEdgePx: 960,
  /** Max stills attached to one Grok call. */
  maxAiFrames: 3,
} as const;

export const SAMPLE_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;

export const VIDEO_ERROR_RU: Record<VideoErrorCode, string> = {
  VIDEO_UNSUPPORTED: "VIDEO UNSUPPORTED — браузер не декодирует этот формат.",
  VIDEO_DECODE_FAILED: "VIDEO DECODE FAILED — кадр не прочитан.",
  VIDEO_TOO_LARGE: "VIDEO TOO LARGE — превышен лимит 24 MB.",
  VIDEO_ZERO_DURATION: "VIDEO DECODE FAILED — нулевая длительность.",
  VIDEO_CANCELLED: "Обработка отменена.",
};

export function sampleTimestampsMs(durationMs: number, maxFrames = VIDEO_LIMITS.maxFrames): number[] {
  if (!(durationMs > 0) || !Number.isFinite(durationMs)) return [];
  const raw = SAMPLE_FRACTIONS.map((f) => Math.min(durationMs, Math.max(0, f * durationMs)));
  const uniq: number[] = [];
  for (const t of raw) {
    const ms = Math.round(t);
    if (!uniq.includes(ms)) uniq.push(ms);
  }
  return uniq.slice(0, maxFrames);
}

export function guessVideoMime(file: { type?: string; name?: string }): string {
  if (file.type && file.type.startsWith("video/")) return file.type;
  const n = (file.name ?? "").toLowerCase();
  if (n.endsWith(".webm")) return "video/webm";
  if (n.endsWith(".ogv") || n.endsWith(".ogg")) return "video/ogg";
  if (n.endsWith(".mov")) return "video/quicktime";
  if (n.endsWith(".mp4") || n.endsWith(".m4v")) return "video/mp4";
  return file.type ?? "";
}

/** Bare container MIME plus codec-parameterized strings WebKit often requires. */
export function mimeCandidates(mime: string): string[] {
  const base = mime.split(";")[0]!.trim();
  const out: string[] = [mime, base];
  if (base === "video/webm") {
    out.push('video/webm; codecs="vp8"', 'video/webm; codecs="vp8.0"', 'video/webm; codecs="vp9"');
  } else if (base === "video/mp4") {
    out.push('video/mp4; codecs="avc1.42E01E"', 'video/mp4; codecs="avc1.4D401E"');
  } else if (base === "video/ogg") {
    out.push('video/ogg; codecs="theora"');
  }
  return [...new Set(out.filter(Boolean))];
}

/**
 * Fail-closed before decode. `canPlay` is the browser's canPlayType result
 * ("probably" | "maybe" | ""). Extension alone never claims support.
 */
export function classifyVideoFile(
  file: { size: number; type?: string; name?: string },
  canPlay: (mime: string) => string,
): { ok: true; mime: string } | { ok: false; code: VideoErrorCode } {
  if (file.size > VIDEO_LIMITS.maxBytes) return { ok: false, code: "VIDEO_TOO_LARGE" };
  const mime = guessVideoMime(file);
  if (!mime.startsWith("video/")) return { ok: false, code: "VIDEO_UNSUPPORTED" };
  for (const cand of mimeCandidates(mime)) {
    const play = canPlay(cand);
    if (play === "probably" || play === "maybe") return { ok: true, mime: cand };
  }
  return { ok: false, code: "VIDEO_UNSUPPORTED" };
}

export function framePhotoMeta(args: {
  id: string;
  videoId: string;
  filename: string;
  timestampMs: number;
  widthPx: number;
  heightPx: number;
  createdAt: number;
  extractionMethod?: RealityPhotoMeta["extractionMethod"];
}): RealityPhotoMeta {
  return {
    id: args.id,
    name: `${args.filename} @ ${(args.timestampMs / 1000).toFixed(2)}s`,
    mime: "image/jpeg",
    createdAt: args.createdAt,
    notes: "VIDEO_FRAME_ESTIMATE — visual evidence, not a field measurement.",
    kind: "video-frame",
    sourceVideoId: args.videoId,
    sourceFilename: args.filename,
    timestampMs: args.timestampMs,
    extractionMethod: args.extractionMethod ?? "video-seek-canvas",
    widthPx: args.widthPx,
    heightPx: args.heightPx,
    markers: [],
  };
}

export function videoMetaSkeleton(args: {
  id: string;
  name: string;
  mime: string;
  createdAt: number;
}): RealityVideoMeta {
  return {
    id: args.id,
    name: args.name,
    mime: args.mime,
    createdAt: args.createdAt,
    durationMs: 0,
    widthPx: 0,
    heightPx: 0,
    status: "processing",
    frameIds: [],
    selectedFrameIds: [],
    persistRaw: false,
  };
}
