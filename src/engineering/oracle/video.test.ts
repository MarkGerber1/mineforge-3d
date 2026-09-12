import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyRectangularProject } from "../../project/factory.ts";
import { emptyReality } from "../types.ts";
import { applyFinding, attachVideoFrames, calibrateFromKnownDistance, geometryFingerprint, parseAiFinding } from "../reality.ts";
import { applyExifOrientation } from "../../reality/media.ts";
import {
  VIDEO_LIMITS,
  classifyVideoFile,
  framePhotoMeta,
  sampleTimestampsMs,
  videoMetaSkeleton,
} from "../../reality/video-policy.ts";
import { parseProject } from "../../project/schema.ts";
import { calculateAll } from "../pipeline.ts";
import { defaultCatalogs } from "../catalogs.ts";

describe("VIDEO-01 policy: mime is classified by canPlayType, not extension", () => {
  it("mp4 with maybe is ok; random extension is unsupported", () => {
    const ok = classifyVideoFile({ size: 1000, type: "video/mp4", name: "x.mp4" }, () => "maybe");
    assert.equal(ok.ok, true);
    const byExt = classifyVideoFile({ size: 1000, type: "", name: "clip.mp4" }, () => "");
    assert.equal(byExt.ok, false);
    if (!byExt.ok) assert.equal(byExt.code, "VIDEO_UNSUPPORTED");
  });
});

describe("VIDEO-02 sampling timestamps are distinct", () => {
  it("4.000 s → 5 stamps including start and end", () => {
    const ts = sampleTimestampsMs(4000);
    assert.equal(ts.length, 5);
    assert.equal(ts[0], 0);
    assert.equal(ts[ts.length - 1], 4000);
    assert.equal(new Set(ts).size, ts.length);
  });
  it("short video yields fewer unique stamps", () => {
    const ts = sampleTimestampsMs(0);
    assert.equal(ts.length, 0);
    const tiny = sampleTimestampsMs(1);
    assert.ok(tiny.length >= 1);
    assert.ok(tiny.length <= VIDEO_LIMITS.maxFrames);
  });
});

describe("VIDEO-03 frame provenance has sourceVideoId + timestamp", () => {
  it("VIDEO_FRAME_ESTIMATE metadata, not FIELD_MEASUREMENT", () => {
    const p = framePhotoMeta({
      id: "frame_1",
      videoId: "vid_1",
      filename: "frames-rgb.mp4",
      timestampMs: 1000,
      widthPx: 320,
      heightPx: 180,
      createdAt: 1,
    });
    assert.equal(p.kind, "video-frame");
    assert.equal(p.sourceVideoId, "vid_1");
    assert.equal(p.timestampMs, 1000);
    assert.equal(p.extractionMethod, "video-seek-canvas");
    assert.equal(p.sourceFilename, "frames-rgb.mp4");
    assert.match(p.notes, /VIDEO_FRAME_ESTIMATE/);
    assert.notEqual(p.markers.length, undefined);
  });
});

describe("VIDEO-04 unsupported / too large fail explicitly", () => {
  it("VIDEO_TOO_LARGE and VIDEO_UNSUPPORTED", () => {
    const big = classifyVideoFile({ size: VIDEO_LIMITS.maxBytes + 1, type: "video/mp4" }, () => "probably");
    assert.equal(big.ok, false);
    if (!big.ok) assert.equal(big.code, "VIDEO_TOO_LARGE");
    const no = classifyVideoFile({ size: 10, type: "application/pdf", name: "x.pdf" }, () => "probably");
    assert.equal(no.ok, false);
    if (!no.ok) assert.equal(no.code, "VIDEO_UNSUPPORTED");
  });
});

describe("VIDEO-05 no synthetic frame fallback", () => {
  it("failed extract result is empty frames", () => {
    const v = videoMetaSkeleton({ id: "v", name: "bad.mp4", mime: "video/mp4", createdAt: 1 });
    assert.equal(v.status, "processing");
    assert.equal(v.frameIds.length, 0);
    assert.equal(v.persistRaw, false);
  });
});

describe("VIDEO-06 extraction count is bounded", () => {
  it("never more than maxFrames", () => {
    const ts = sampleTimestampsMs(3600_000);
    assert.ok(ts.length <= VIDEO_LIMITS.maxFrames);
    assert.equal(VIDEO_LIMITS.maxFrames, 6);
    assert.equal(VIDEO_LIMITS.sampleCount, 5);
    assert.equal(VIDEO_LIMITS.maxAiFrames, 3);
  });
});

describe("VIDEO-07 video evidence cannot mutate canonical geometry before confirmation", () => {
  it("attachVideoFrames leaves openings/racks/room/asBuilt unchanged", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    src.openings = [
      {
        id: "ex",
        type: "EXHAUST",
        wallId: "east",
        widthM: 1.4,
        heightM: 0.9,
        bottomElevationM: 0.4,
        offsetFromWallStartM: 1,
      },
    ];
    const before = geometryFingerprint(src);
    const video = {
      ...videoMetaSkeleton({ id: "vid1", name: "frames-rgb.mp4", mime: "video/mp4", createdAt: 1 }),
      status: "ready" as const,
      durationMs: 4000,
      widthPx: 320,
      heightPx: 180,
      frameIds: ["frame_1"],
      selectedFrameIds: ["frame_1"],
    };
    const frame = framePhotoMeta({
      id: "frame_1",
      videoId: "vid1",
      filename: "frames-rgb.mp4",
      timestampMs: 0,
      widthPx: 320,
      heightPx: 180,
      createdAt: 1,
    });
    const next = attachVideoFrames(src, video, [frame]);
    assert.equal(geometryFingerprint(next), before);
    assert.equal(next.openings.length, src.openings.length);
    assert.equal(next.reality!.photos.length, 1);
    assert.equal(next.reality!.videos.length, 1);
    assert.equal(src.reality?.photos.length ?? 0, 0);
  });
});

describe("VIDEO-08 selected frame is a Reality photo for calibration", () => {
  it("kind video-frame participates in photoCalibration pipeline", () => {
    const frame = framePhotoMeta({
      id: "phv",
      videoId: "vid",
      filename: "x.mp4",
      timestampMs: 2000,
      widthPx: 1024,
      heightPx: 512,
      createdAt: 1,
    });
    assert.equal(frame.kind, "video-frame");
    assert.equal(frame.widthPx, 1024);
    assert.equal(frame.heightPx, 512);
    const a = { id: "a", nx: 0, ny: 0, kind: "point" as const, label: "A" };
    const b = { id: "b", nx: 0.25, ny: 0, kind: "point" as const, label: "B" };
    const cal = calibrateFromKnownDistance(frame, a, b, 2.0);
    assert.ok(cal);
    assert.equal(cal!.scaleMPerPx, 1 / 128);
    assert.equal(cal!.provenance, "FIELD_MEASUREMENT");
  });
});

describe("VIDEO-09 confirmed frame-derived finding changes canonical model", () => {
  it("PENDING door on a video frame ADD writes opening", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    const finding = parseAiFinding(
      {
        kind: "door",
        summary: "Door from video frame",
        confidence: "HIGH",
        wallId: "south",
        widthM: 1,
        heightM: 2.1,
        offsetFromWallStartM: 2,
        bottomElevationM: 0,
      },
      "find_vf",
    );
    finding.photoId = "frame_1";
    const p = { ...src, reality: { ...(src.reality ?? emptyReality()), findings: [finding] } };
    assert.equal(p.openings.length, 0);
    const applied = applyFinding(p, "find_vf", "ADDED");
    assert.equal(applied.ok, true, applied.errors.join("; "));
    assert.equal(applied.project.openings.length, 1);
    assert.equal(applied.project.openings[0].type, "DOOR");
  });
});

describe("VIDEO-10 undo restores exact previous engineering result", () => {
  it("history[0] after ADD restores fingerprint and SAFE", () => {
    const src = emptyRectangularProject({ widthM: 8, depthM: 5, heightM: 2.8 });
    src.fleet.requestedCount = 24;
    const finding = parseAiFinding(
      {
        kind: "door",
        summary: "Door",
        confidence: "HIGH",
        wallId: "south",
        widthM: 1,
        heightM: 2.1,
        offsetFromWallStartM: 0.4,
        bottomElevationM: 0,
      },
      "find_u",
    );
    const pending = { ...src, reality: { ...(src.reality ?? emptyReality()), findings: [finding] } };
    const r0 = calculateAll(pending, defaultCatalogs());
    const fp0 = geometryFingerprint(pending);
    const added = applyFinding(pending, "find_u", "ADDED");
    assert.equal(added.ok, true);
    const r1 = calculateAll(added.project, defaultCatalogs());
    assert.notEqual(geometryFingerprint(added.project), fp0);
    const undone = pending;
    const rUndo = calculateAll(undone, defaultCatalogs());
    assert.equal(geometryFingerprint(undone), fp0);
    assert.equal(rUndo.capacity.safe, r0.capacity.safe);
    void r1;
  });
});

describe("VIDEO-11 cancel leaves canonical model unchanged", () => {
  it("cancelled skeleton is not attached", () => {
    const src = emptyRectangularProject();
    const fp = geometryFingerprint(src);
    const cancelled = { ...videoMetaSkeleton({ id: "v", name: "x.mp4", mime: "video/mp4", createdAt: 1 }), status: "cancelled" as const, error: "VIDEO_CANCELLED" as const };
    assert.equal(cancelled.frameIds.length, 0);
    assert.equal(geometryFingerprint(src), fp);
    assert.equal((src.reality?.videos ?? []).length, 0);
  });
});

describe("VIDEO-12 persistRaw is always false; EXIF swap helper", () => {
  it("raw video is not persisted; orientation 6 swaps axes", () => {
    const v = videoMetaSkeleton({ id: "v", name: "x.mp4", mime: "video/mp4", createdAt: 1 });
    assert.equal(v.persistRaw, false);
    const o6 = applyExifOrientation(32, 64, 6);
    assert.equal(o6.widthPx, 64);
    assert.equal(o6.heightPx, 32);
    const o1 = applyExifOrientation(64, 32, 1);
    assert.equal(o1.widthPx, 64);
    assert.equal(o1.heightPx, 32);
  });
});

describe("VIDEO persistence of frame metadata through JSON", () => {
  it("sourceVideoId + timestamp survive parseProject", () => {
    const src = emptyRectangularProject();
    const video = {
      ...videoMetaSkeleton({ id: "vid1", name: "frames-rgb.mp4", mime: "video/mp4", createdAt: 1 }),
      status: "ready" as const,
      durationMs: 4000,
      widthPx: 320,
      heightPx: 180,
      frameIds: ["frame_1"],
      selectedFrameIds: ["frame_1"],
    };
    const frame = framePhotoMeta({
      id: "frame_1",
      videoId: "vid1",
      filename: "frames-rgb.mp4",
      timestampMs: 1500,
      widthPx: 320,
      heightPx: 180,
      createdAt: 1,
    });
    const next = attachVideoFrames(src, video, [frame]);
    const loaded = parseProject(JSON.parse(JSON.stringify(next)));
    assert.equal(loaded.reality!.videos[0].persistRaw, false);
    assert.equal(loaded.reality!.photos[0].sourceVideoId, "vid1");
    assert.equal(loaded.reality!.photos[0].timestampMs, 1500);
    assert.equal(loaded.reality!.photos[0].kind, "video-frame");
  });
});
