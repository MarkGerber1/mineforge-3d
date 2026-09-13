/**
 * Minimal EBML WebM demuxer for VP8 SimpleBlocks.
 * Used by the WebCodecs fallback when <video>+canvas yields no pixels.
 * Does not invent frames — only returns encoded bitstream samples.
 */
export interface Vp8Sample {
  timestampMs: number;
  keyframe: boolean;
  data: Uint8Array;
}

export interface Vp8Webm {
  codec: "vp8";
  width: number;
  height: number;
  durationMs: number;
  samples: Vp8Sample[];
}

const ID = {
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimestampScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Cluster: 0x1f43b675,
  Timestamp: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
} as const;

const CONTAINER = new Set<number>([
  ID.Segment,
  ID.Info,
  ID.Tracks,
  ID.TrackEntry,
  ID.Video,
  ID.Cluster,
  ID.BlockGroup,
]);

function readId(buf: Uint8Array, i: number): { id: number; width: number } | null {
  if (i >= buf.length) return null;
  const b0 = buf[i]!;
  let mask = 0x80;
  let width = 1;
  while (width <= 4 && !(b0 & mask)) {
    mask >>= 1;
    width += 1;
  }
  if (width > 4 || i + width > buf.length) return null;
  let id = 0;
  for (let k = 0; k < width; k++) id = (id << 8) | buf[i + k]!;
  return { id, width };
}

function readVint(buf: Uint8Array, i: number): { value: number; width: number; unknown: boolean } | null {
  if (i >= buf.length) return null;
  const b0 = buf[i]!;
  let mask = 0x80;
  let width = 1;
  while (width <= 8 && !(b0 & mask)) {
    mask >>= 1;
    width += 1;
  }
  if (width > 8 || i + width > buf.length) return null;
  let value = b0 & (mask - 1);
  for (let k = 1; k < width; k++) value = (value << 8) | buf[i + k]!;
  const max = (1 << (7 * width)) - 1;
  return { value, width, unknown: value === max };
}

function readUint(bytes: Uint8Array): number {
  let v = 0;
  for (let i = 0; i < bytes.length; i++) v = (v << 8) | bytes[i]!;
  return v;
}

function readFloat(bytes: Uint8Array): number {
  if (bytes.length === 4) {
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getFloat32(0);
  }
  if (bytes.length === 8) {
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0);
  }
  return 0;
}

function readAscii(bytes: Uint8Array): string {
  return new TextDecoder("ascii").decode(bytes);
}

function signed16(hi: number, lo: number): number {
  const u = (hi << 8) | lo;
  return u > 32767 ? u - 65536 : u;
}

export function demuxVp8Webm(input: ArrayBuffer | Uint8Array): Vp8Webm | null {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length < 16) return null;
  if (buf[0] !== 0x1a || buf[1] !== 0x45 || buf[2] !== 0xdf || buf[3] !== 0xa3) return null;

  let timestampScale = 1_000_000;
  let durationUnits = 0;
  let width = 0;
  let height = 0;
  let codecId = "";
  let videoTrack = 1;
  const samples: Vp8Sample[] = [];
  let clusterTs = 0;

  const walk = (start: number, end: number) => {
    let i = start;
    while (i < end) {
      const idr = readId(buf, i);
      if (!idr) break;
      const sz = readVint(buf, i + idr.width);
      if (!sz) break;
      const payload = i + idr.width + sz.width;
      const payloadEnd = sz.unknown ? end : Math.min(end, payload + sz.value);
      if (payloadEnd < payload) break;
      const slice = buf.subarray(payload, payloadEnd);

      if (idr.id === ID.TimestampScale) timestampScale = readUint(slice) || timestampScale;
      else if (idr.id === ID.Duration) durationUnits = readFloat(slice);
      else if (idr.id === ID.CodecID) codecId = readAscii(slice);
      else if (idr.id === ID.TrackNumber) videoTrack = readUint(slice) || videoTrack;
      else if (idr.id === ID.PixelWidth) width = readUint(slice);
      else if (idr.id === ID.PixelHeight) height = readUint(slice);
      else if (idr.id === ID.Timestamp) clusterTs = readUint(slice);
      else if (idr.id === ID.SimpleBlock || idr.id === ID.Block) {
        parseBlock(slice, idr.id === ID.SimpleBlock);
      }

      if (CONTAINER.has(idr.id)) walk(payload, payloadEnd);
      i = payloadEnd;
    }
  };

  const parseBlock = (block: Uint8Array, simple: boolean) => {
    const tn = readVint(block, 0);
    if (!tn || tn.width + 3 > block.length) return;
    const rel = signed16(block[tn.width]!, block[tn.width + 1]!);
    const flags = block[tn.width + 2]!;
    const payload = block.subarray(tn.width + 3);
    if (!payload.length) return;
    const keyframe = simple ? (flags & 0x80) !== 0 : (payload[0]! & 0x01) === 0;
    const tsUnits = clusterTs + rel;
    const timestampMs = (tsUnits * timestampScale) / 1_000_000;
    samples.push({
      timestampMs,
      keyframe,
      data: payload.slice(),
    });
  };

  walk(0, buf.length);
  if (codecId !== "V_VP8") return null;
  if (!(width > 0) || !(height > 0) || samples.length < 2) return null;
  const lastTs = samples[samples.length - 1]?.timestampMs ?? 0;
  const durationMs =
    durationUnits > 0 ? (durationUnits * timestampScale) / 1_000_000 : lastTs > 0 ? lastTs + 200 : 0;
  if (!(durationMs > 0)) return null;
  return { codec: "vp8", width, height, durationMs, samples };
}
