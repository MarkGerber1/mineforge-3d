import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { routeIntent } from "./intent.ts";

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
    const apiKey = process.env.XAI_API_KEY;
    const intent = routeIntent(data.message, {
      hasPhotos: Boolean(data.images?.length) || data.realitySummary.includes("photos:"),
      pickedUi: Boolean(data.pickedUi),
    });

    if (!apiKey) {
      return {
        ok: false as const,
        offline: true,
        intent,
        error: "AI OFFLINE — инженерное ядро, CAD и локальный Git работают без сети.",
      };
    }

    const tools = [
      {
        type: "function",
        function: {
          name: "get_project_state",
          description: "Canonical project snapshot already provided. Do not invent numbers.",
          parameters: { type: "object", properties: {} },
        },
      },
      {
        type: "function",
        function: {
          name: "identify_bottleneck",
          description: "Return Engineering Core bottleneck / SAFE from result summary.",
          parameters: { type: "object", properties: {} },
        },
      },
      {
        type: "function",
        function: {
          name: "propose_patch",
          description: "Propose a project patch. Never claim it is applied.",
          parameters: {
            type: "object",
            properties: {
              summary: { type: "string" },
              detail: { type: "string" },
              patch: { type: "object" },
            },
            required: ["summary", "patch"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "propose_app_edit",
          description:
            "Propose a source change to MINEFORGE UI. Must name files under src/components. Engineering core is forbidden. Never claim applied.",
          parameters: {
            type: "object",
            properties: {
              summary: { type: "string" },
              branch: { type: "string" },
              files: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    path: { type: "string" },
                    instruction: { type: "string" },
                    oldSnippet: { type: "string" },
                    newSnippet: { type: "string" },
                  },
                  required: ["path", "instruction"],
                },
              },
            },
            required: ["summary", "files"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "ask_reality_question",
          description: "Ask ONE short site-interview question. Do not claim geometry is verified.",
          parameters: {
            type: "object",
            properties: { question: { type: "string" } },
            required: ["question"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "propose_finding",
          description: "Propose a detected as-built object. User must ADD / ADJUST / IGNORE.",
          parameters: {
            type: "object",
            properties: {
              kind: { type: "string" },
              summary: { type: "string" },
              confidence: { type: "string" },
              x: { type: "number" },
              y: { type: "number" },
              z: { type: "number" },
              widthM: { type: "number" },
              heightM: { type: "number" },
              depthM: { type: "number" },
            },
            required: ["kind", "summary", "confidence"],
          },
        },
      },
    ];

    const system = `You are the single Grok Assistant inside MINEFORGE 3D.
Intent: ${intent.type}  Scope: ${intent.scope}
You are NOT the source of engineering numbers. Quote the Deterministic Engineering Core.
Rules:
- Never invent airflow, pressure, SAFE COUNT, electrical numbers.
- Project edits: call propose_patch. User must APPLY.
- Application edits: call propose_app_edit. Do not write that you already changed the app. If you cannot produce a real snippet, say APP EDIT needs a concrete file change.
- Reality: never claim centimetre accuracy from one photo. Ask one necessary question. Findings are PHOTO_ESTIMATE until the user confirms. Visual realism never overrides geometry.
- Answer in the user's language (Russian unless they write English).
- Be concise, engineering, no marketing.
Selected object: ${data.selectedObjectId ?? "none"}
Picked UI: ${data.pickedUi ?? "none"}
ENGINEERING CORE:
${data.resultSummary}
REALITY:
${data.realitySummary}
PROJECT JSON:
${data.projectJson.slice(0, 24000)}`;

    type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
    const userContent: ContentPart[] = [{ type: "text", text: data.message }];
    for (const url of data.images ?? []) {
      if (url.startsWith("data:image/")) userContent.push({ type: "image_url", image_url: { url } });
    }

    type Msg = { role: string; content: string | ContentPart[] | null; tool_calls?: unknown; tool_call_id?: string };
    const messages: Msg[] = [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ];

    let proposed: { summary: string; detail: string; patch: unknown } | null = null;
    let appEdit: unknown = null;
    let realityQuestion: string | null = null;
    let finding: unknown = null;
    let text = "";

    for (let round = 0; round < 5; round++) {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "grok-4.5",
          messages,
          tools,
          temperature: 0.2,
          max_tokens: 1100,
        }),
      });
      if (!res.ok) {
        return { ok: false as const, offline: false, intent, error: `xAI API error ${res.status}` };
      }
      const body = (await res.json()) as {
        choices: Array<{
          message: {
            content?: string | null;
            tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
          };
        }>;
      };
      const msg = body.choices[0]?.message;
      if (!msg) break;
      if (msg.tool_calls?.length) {
        messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
        for (const call of msg.tool_calls) {
          let toolResult = "";
          try {
            if (call.function.name === "get_project_state") toolResult = data.projectJson.slice(0, 20000);
            else if (call.function.name === "identify_bottleneck") toolResult = data.resultSummary;
            else if (call.function.name === "propose_patch") {
              const args = JSON.parse(call.function.arguments) as { summary: string; detail?: string; patch: unknown };
              proposed = { summary: args.summary, detail: args.detail ?? "", patch: args.patch };
              toolResult = "Proposal recorded. User must APPLY.";
            } else if (call.function.name === "propose_app_edit") {
              appEdit = JSON.parse(call.function.arguments);
              toolResult = "App-edit proposal recorded. User must APPLY. Not written to disk.";
            } else if (call.function.name === "ask_reality_question") {
              const args = JSON.parse(call.function.arguments) as { question: string };
              realityQuestion = args.question;
              toolResult = "Question queued.";
            } else if (call.function.name === "propose_finding") {
              finding = JSON.parse(call.function.arguments);
              toolResult = "Finding queued as PHOTO_ESTIMATE. User must ADD / IGNORE.";
            } else toolResult = "Unknown tool.";
          } catch {
            toolResult = "Invalid tool JSON.";
          }
          messages.push({ role: "tool", content: toolResult, tool_call_id: call.id });
        }
        continue;
      }
      text = msg.content ?? "";
      break;
    }

    return {
      ok: true as const,
      offline: false,
      intent,
      text,
      proposedJson: proposed ? JSON.stringify(proposed) : "",
      appEditJson: appEdit ? JSON.stringify(appEdit) : "",
      realityQuestion: realityQuestion ?? "",
      findingJson: finding ? JSON.stringify(finding) : "",
    };
  });

export const grokStatus = createServerFn({ method: "POST" }).handler(async () => {
  return { available: Boolean(process.env.XAI_API_KEY) };
});
