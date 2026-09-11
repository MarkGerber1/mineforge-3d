import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Actor } from "./privilege.server.ts";

export interface AuditRecord {
  ts: string;
  actor: string;
  role: string;
  action: string;
  jobId?: string;
  branch?: string;
  files?: string[];
  success: boolean;
  status?: number;
  error?: string;
}

const memory: AuditRecord[] = [];

function auditPath(root: string): string {
  return join(resolve(root), ".grok", "app-edit-audit.jsonl");
}

export async function writeAudit(root: string, rec: AuditRecord): Promise<void> {
  memory.push(rec);
  if (memory.length > 500) memory.shift();
  const line = JSON.stringify(rec) + "\n";
  const p = auditPath(root);
  try {
    await mkdir(dirname(p), { recursive: true });
    await appendFile(p, line, "utf8");
  } catch {
    /* Vercel / read-only FS — in-memory ring still holds the record. */
  }
}

export function auditFromActor(
  actor: Actor,
  action: string,
  extra: Omit<AuditRecord, "ts" | "actor" | "role" | "action">,
): AuditRecord {
  return {
    ts: new Date().toISOString(),
    actor: actor.sub,
    role: actor.role,
    action,
    ...extra,
  };
}

export function recentAudit(): AuditRecord[] {
  return [...memory].slice(-80);
}
