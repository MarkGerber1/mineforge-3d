/** SI internally. Rounding is presentation-only. */

export function parseLengthToMeters(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const s = trimmed.toLowerCase().replace(",", ".").replace(/\s+/g, "");
  const m = s.match(/^(-?\d+(?:\.\d+)?)(mm|cm|m)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2];
  if (unit === "mm") return n / 1000;
  if (unit === "cm") return n / 100;
  if (unit === "m") return n;
  if (Math.abs(n) >= 100) return n / 1000;
  return n;
}

export function parsePowerToWatts(raw: string): number | null {
  return parsePowerInputToWatts(raw, "W");
}

/**
 * Parse a power string. Bare numbers use `defaultUnit`.
 * "80" + kW → 80000 W; "80 kW" → 80000 W; "80000 W" → 80000 W.
 */
export function parsePowerInputToWatts(raw: string, defaultUnit: "W" | "kW" = "W"): number | null {
  const s = raw.trim().toLowerCase().replace(",", ".").replace(/\s+/g, "");
  if (!s) return null;
  const m = s.match(/^(-?\d+(?:\.\d+)?)(kw|w|kвт|вт)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2];
  if (unit === "kw" || unit === "kвт") return n * 1000;
  if (unit === "w" || unit === "вт") return n;
  return defaultUnit === "kW" ? n * 1000 : n;
}

export function metersToMm(m: number): number {
  return m * 1000;
}

export function m3sToM3h(q: number): number {
  return q * 3600;
}

export function m3hToM3s(q: number): number {
  return q / 3600;
}

export function m3hToCfm(q: number): number {
  return q / 1.6990107955;
}

export function cfmToM3h(q: number): number {
  return q * 1.6990107955;
}

export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function formatMeters(m: number, decimals = 3): string {
  return `${roundTo(m, decimals).toFixed(decimals)} m`;
}

export function formatMm(m: number): string {
  return `${roundTo(m * 1000, 0)} mm`;
}

export function formatLengthHuman(m: number): string {
  const abs = Math.abs(m);
  if (abs < 0.02) return `${roundTo(m * 1000, 1)} mm`;
  if (abs < 1) return `${roundTo(m * 100, 1)} cm`;
  const meters = Math.floor(abs);
  const cm = roundTo((abs - meters) * 100, 0);
  if (cm === 0) return `${m < 0 ? "-" : ""}${meters} m`;
  if (meters === 0) return `${m < 0 ? "-" : ""}${cm} cm`;
  return `${m < 0 ? "-" : ""}${meters} m ${cm} cm`;
}

export function formatKw(watts: number, decimals = 3): string {
  return `${roundTo(watts / 1000, decimals).toFixed(decimals)} kW`;
}

export function formatWatts(w: number): string {
  if (Math.abs(w) >= 1000) return formatKw(w);
  return `${roundTo(w, 0)} W`;
}

export function formatAmps(i: number): string {
  if (Math.abs(i) >= 100) return `${roundTo(i, 2).toFixed(2)} A`;
  return `${roundTo(i, 3).toFixed(3)} A`;
}

export function formatPa(p: number): string {
  if (Math.abs(p) >= 1000) return `${roundTo(p / 1000, 3)} kPa`;
  return `${roundTo(p, 1)} Pa`;
}

export function formatM3h(q: number): string {
  return `${roundTo(q, 0).toLocaleString("en-US")} m³/h`;
}

export function formatM3s(q: number): string {
  return `${roundTo(q, 3)} m³/s`;
}

export function formatCfm(qM3h: number): string {
  return `${roundTo(m3hToCfm(qM3h), 0).toLocaleString("en-US")} CFM`;
}

export function formatThs(th: number): string {
  if (th >= 1000) return `${roundTo(th / 1000, 3)} PH/s`;
  return `${roundTo(th, 2)} TH/s`;
}

export function snapTo(value: number, stepM: number): number {
  if (stepM <= 0) return value;
  return Math.round(value / stepM) * stepM;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
