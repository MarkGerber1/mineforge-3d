/**
 * ONE photo coordinate frame.
 *
 * Overlay (0,0) = top-left of the visible photo content box.
 * Overlay (1,1) = bottom-right of the visible photo content box.
 *
 * This is the object-contain content rectangle, NOT the letterboxed parent.
 * Pointer mapping, A–B markers, overlay nx/ny/nw/nh and visual boxes
 * all use this frame. Not photogrammetry.
 */

export interface PhotoContentBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PhotoFrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** object-contain content box of an image inside a container. */
export function photoContentBox(
  containerW: number,
  containerH: number,
  imageW: number,
  imageH: number,
): PhotoContentBox {
  if (!(containerW > 0) || !(containerH > 0) || !(imageW > 0) || !(imageH > 0)) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const scale = Math.min(containerW / imageW, containerH / imageH);
  const w = imageW * scale;
  const h = imageH * scale;
  return {
    x: (containerW - w) / 2,
    y: (containerH - h) / 2,
    w,
    h,
  };
}

/** Client pixel → normalized photo frame. Outside the content box → null. */
export function clientToPhotoNorm(
  clientX: number,
  clientY: number,
  frame: PhotoFrameRect,
): { nx: number; ny: number } | null {
  if (!(frame.width > 0) || !(frame.height > 0)) return null;
  const nx = (clientX - frame.left) / frame.width;
  const ny = (clientY - frame.top) / frame.height;
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  return { nx, ny };
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function clampNormSize(n: number, min = 0.02, max = 0.95): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
