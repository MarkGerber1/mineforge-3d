/** GitHub Pages is served at /mineforge-3d/; Grok preview is at /. */
export const PAGES_MOUNT = "/mineforge-3d";

export function resolveBasepath(
  pathname = typeof window !== "undefined" ? window.location.pathname : "/",
  envBase = typeof import.meta !== "undefined" ? String((import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL || "/") : "/",
): string {
  const trimmed = envBase.replace(/\/$/, "");
  if (trimmed && trimmed !== "/" && trimmed !== ".") {
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }
  if (pathname === PAGES_MOUNT || pathname.startsWith(`${PAGES_MOUNT}/`)) return PAGES_MOUNT;
  return "/";
}
