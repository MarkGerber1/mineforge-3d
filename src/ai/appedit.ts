import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const filesSchema = z.array(z.object({ path: z.string(), content: z.string().max(400_000) })).max(8);

export const inspectRepo = createServerFn({ method: "POST" }).handler(async () => {
  const { requireOwner } = await import("./privilege.server.ts");
  const gate = await requireOwner("inspect_repo");
  if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error };
  const { inspectRepoHandler } = await import("./jobs.server.ts");
  return inspectRepoHandler();
});

export const searchCode = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ query: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { requireOwner } = await import("./privilege.server.ts");
    const gate = await requireOwner("search_code", { body: data });
    if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error, hits: [] as string[] };
    const { git, stableSha } = await import("./jobs.server.ts");
    void stableSha;
    const root = process.env.APP_EDIT_ROOT || process.cwd();
    const r = await git(["grep", "-n", "-I", "-e", data.query, "--", "src"], root);
    return { ok: true as const, hits: r.stdout.split("\n").filter(Boolean).slice(0, 40) };
  });

export const readSourceFile = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ path: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { requireOwner } = await import("./privilege.server.ts");
    const gate = await requireOwner("read_source", { body: data });
    if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error };
    const { readSourceFileHandler } = await import("./jobs.server.ts");
    return readSourceFileHandler(data.path);
  });

export const writeSourceFiles = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ files: filesSchema, message: z.string().min(1).max(200), branch: z.string().min(1).max(80), jobId: z.string().max(80).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireOwner } = await import("./privilege.server.ts");
    const gate = await requireOwner("write_source", { body: data });
    if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error };
    const { writeSourceFilesHandler } = await import("./jobs.server.ts");
    return writeSourceFilesHandler(gate.actor, data);
  });

export const rollbackChange = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ ref: z.string().min(1).max(80).optional() }).parse(d))
  .handler(async ({ data }) => {
    const { requireOwner } = await import("./privilege.server.ts");
    const gate = await requireOwner("rollback_stable", { body: data });
    if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error };
    const { rollbackStableHandler } = await import("./jobs.server.ts");
    return rollbackStableHandler(gate.actor, data.ref);
  });

export const runOracle = createServerFn({ method: "POST" }).handler(async () => {
  const { requireOwner } = await import("./privilege.server.ts");
  const gate = await requireOwner("run_oracle");
  if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error };
  return { ok: false as const, error: "Oracle runs inside isolated job gates." };
});

export const createEditBranch = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ name: z.string().min(3).max(60) }).parse(d))
  .handler(async ({ data }) => {
    const { requireOwner } = await import("./privilege.server.ts");
    const gate = await requireOwner("create_edit_branch", { body: data });
    if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error, branch: "" };
    const { createEditBranchHandler } = await import("./jobs.server.ts");
    const res = await createEditBranchHandler(gate.actor, data.name);
    return { ok: res.ok, branch: res.branch ?? res.job?.branch ?? "", error: res.error ?? "", job: res.job };
  });

export const runTypecheck = createServerFn({ method: "POST" }).handler(async () => {
  const { requireOwner } = await import("./privilege.server.ts");
  const gate = await requireOwner("run_typecheck");
  if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error };
  return { ok: false as const, stdout: "", stderr: "Typecheck runs inside isolated job gates." };
});

export const createAppEditJob = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        request: z.string().min(1).max(400),
        files: filesSchema.optional(),
        name: z.string().max(40).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireOwner } = await import("./privilege.server.ts");
    const gate = await requireOwner("create_edit_job", { body: data });
    if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error };
    const { createIsolatedJob } = await import("./jobs.server.ts");
    return createIsolatedJob(gate.actor, data);
  });

export const promoteAppEditJob = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ jobId: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { requireOwner } = await import("./privilege.server.ts");
    const gate = await requireOwner("promote_job", { body: data });
    if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error };
    const { promoteJobHandler } = await import("./jobs.server.ts");
    return promoteJobHandler(gate.actor, data.jobId);
  });

export const rejectAppEditJob = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ jobId: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { requireOwner } = await import("./privilege.server.ts");
    const gate = await requireOwner("reject_job", { body: data });
    if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error };
    const { rejectJobHandler } = await import("./jobs.server.ts");
    return rejectJobHandler(gate.actor, data.jobId);
  });

export const ownerLogin = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ passphrase: z.string().min(1).max(200), role: z.string().optional(), isOwner: z.boolean().optional() }).parse(d))
  .handler(async ({ data }) => {
    const { loginWithPassphrase, cookieSetHeader } = await import("./privilege.server.ts");
    const gate = loginWithPassphrase(data.passphrase);
    if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error };
    try {
      const { setCookie } = await import("@tanstack/react-start/server");
      setCookie("mf_priv", gate.token!, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 28800 });
    } catch {
      void cookieSetHeader;
    }
    return { ok: true as const, role: gate.actor.role };
  });

export const ownerLogout = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const { setCookie } = await import("@tanstack/react-start/server");
    setCookie("mf_priv", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  } catch {
    /* tests */
  }
  return { ok: true as const };
});
