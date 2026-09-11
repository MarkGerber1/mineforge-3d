/** GitHub Pages is served at /mineforge-3d/; Grok preview is at /.
 * Pages snapshot rewrite also patches TanStack Start's empty basepath overwrite.
 */
export function resolveBasepath(
  pathname = typeof window !== "undefined" ? window.location.pathname : "/",
  envBase = typeof import.meta !== "undefined" ? String((import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL || "/") : "/",
): string {
  const trimmed = envBase.replace(/\/$/, "");
  if (trimmed && trimmed !== "/" && trimmed !== ".") {
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }
  if (pathname === "/mineforge-3d" || pathname.startsWith("/mineforge-3d/")) return "/mineforge-3d";
  return "/";
}
