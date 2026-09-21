import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  message: z.string().min(1).max(4000),
  projectJson: z.string().max(400_000),
  selectedObjectId: z.string().nullable(),
  resultSummary: z.string().max(20_000),
  pickedUi: z.string().nullable(),
  realitySummary: z.string().max(12_000),
  images: z.array(z.string().max(1_500_000)).max(3).optional(),
});

export const grokEngineer = createServerFn({ method: "POST" })
  .validator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data }) => {
    const { executeGrokEngineer } = await import("./grok-engine.server.ts");
    return executeGrokEngineer(data);
  });

export const grokStatus = createServerFn({ method: "POST" }).handler(async () => {
  const { readRequestCookieHeader } = await import("./privilege.server.ts");
  const { runtimeSnapshotWithReadiness } = await import("./runtime-readiness.server.ts");
  const cookieHeader = await readRequestCookieHeader();
  return runtimeSnapshotWithReadiness({ cookieHeader });
});

export const runtimeHealth = grokStatus;
