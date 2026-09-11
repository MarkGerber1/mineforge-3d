export type RuntimeMode = "unknown" | "server" | "static";
export type RuntimeRole = "anonymous" | "user" | "owner";

export interface RuntimeSnapshot {
  mode: RuntimeMode;
  ai: boolean;
  available: boolean;
  appEditEnabled: boolean;
  role: RuntimeRole;
  sha?: string;
  buildId?: string;
}

export const STATIC_RUNTIME: RuntimeSnapshot = {
  mode: "static",
  ai: false,
  available: false,
  appEditEnabled: false,
  role: "anonymous",
};

export function parseRuntime(raw: unknown): RuntimeSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.mode !== "server") return null;
  return {
    mode: "server",
    ai: Boolean(o.ai ?? o.available),
    available: Boolean(o.available ?? o.ai),
    appEditEnabled: Boolean(o.appEditEnabled),
    role: o.role === "owner" || o.role === "user" ? o.role : "anonymous",
    sha: typeof o.sha === "string" ? o.sha : undefined,
    buildId: typeof o.buildId === "string" ? o.buildId : undefined,
  };
}

export async function loadRuntime(): Promise<RuntimeSnapshot> {
  try {
    const res = await fetch("/api/runtime", { method: "GET", credentials: "same-origin" });
    if (!res.ok) return STATIC_RUNTIME;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return STATIC_RUNTIME;
    const parsed = parseRuntime(await res.json());
    return parsed ?? STATIC_RUNTIME;
  } catch {
    return STATIC_RUNTIME;
  }
}
