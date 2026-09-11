import { useEffect, useRef, useState } from "react";
import { grokEngineer } from "@/ai/grok";
import { loadRuntime } from "@/ai/runtime-client";
import { routeIntent } from "@/ai/intent";
import { Button } from "@/components/ui/button";
import { useLiveResult, useProjectStore, type AppEditJob } from "@/project/store";
import type { PartialProjectPatch } from "@/engineering/upgrade";
import { emptyReality, type RealityFinding } from "@/engineering/types";
import { critiqueProject } from "@/ai/critic";
import { cn } from "@/lib/utils";
import { resizeImageFile, saveMedia } from "@/reality/media";
import { nid } from "@/project/factory";

const SCOPE_RU = { PROJECT: "ПРОЕКТ", APPLICATION: "ПРИЛОЖЕНИЕ", REALITY: "ОБЪЕКТ" } as const;

export function GrokPanel({ fill }: { fill?: boolean }) {
  const store = useProjectStore();
  const result = useLiveResult();
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadRuntime().then((s) => store.setRuntime(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = useProjectStore((s) => s.pendingGrok);

  const send = async (msg: string, extraImages?: string[]) => {
    const message = msg.trim();
    if (!message || store.grokBusy) return;
    const images = extraImages ?? store.pendingImages;
    const intent = routeIntent(message, {
      hasPhotos: images.length > 0 || Boolean(store.project.reality?.photos.length),
      pickedUi: Boolean(store.pickedUi),
    });
    store.pushGrok({ id: `u${Date.now()}`, role: "user", text: message });
    setText("");
    if (store.runtime?.mode === "static" || store.runtime?.ai === false || store.grokOffline) {
      store.setGrokOffline(true);
      store.pushGrok({
        id: `a${Date.now()}`,
        role: "assistant",
        text: "AI OFFLINE — нет server runtime / xAI. CAD, REQUESTED/SAFE и Twin работают локально.",
      });
      return;
    }
    store.setGrokBusy(true);
    const summary = JSON.stringify({
      requested: result.capacity.requested,
      safe: result.capacity.safe,
      bottlenecks: result.capacity.bottlenecks,
      confidence: result.capacity.confidence,
      typicalKW: result.electrical.typicalTotalW / 1000,
      designKW: result.electrical.designTotalW / 1000,
      airflowReq: result.thermal.designAirflowM3h,
      airflowOp: result.fan.operatingQ_m3h,
      fanPass: result.fan.pass,
      warnings: result.warnings.map((w) => w.title),
      missing: result.missing.filter((m) => !m.complete).map((m) => m.key),
      critic: critiqueProject(store.live(), result).map((c) => c.title),
    });
    const reality = store.project.reality ?? emptyReality();
    try {
      const res = await grokEngineer({
        data: {
          message: store.pickedUi ? `[UI:${store.pickedUi.id} ${store.pickedUi.file}] ${message}` : message,
          projectJson: JSON.stringify(store.project),
          selectedObjectId: store.selectedIds[0] ?? null,
          resultSummary: summary,
          pickedUi: store.pickedUi ? JSON.stringify(store.pickedUi) : null,
          realitySummary: JSON.stringify({
            photos: reality.photos.map((p) => ({ id: p.id, name: p.name, markers: p.markers.length, wallHint: p.wallHint })),
            asBuilt: reality.asBuilt,
            findings: reality.findings,
            compareMode: reality.compareMode,
          }),
          images: images.slice(0, 3),
        },
      });
      if (!res || typeof res !== "object" || !("ok" in res) || !res.ok) {
        const offline = res && typeof res === "object" && "offline" in res ? Boolean(res.offline) : false;
        const error = res && typeof res === "object" && "error" in res ? String(res.error) : "Grok unavailable";
        store.setGrokOffline(offline);
        store.pushGrok({ id: `a${Date.now()}`, role: "assistant", text: error });
      } else {
        if ("intent" in res && res.intent) {
          useProjectStore.setState({ grokScope: res.intent.scope });
        }
        if (res.proposedJson) {
          try {
            const proposed = JSON.parse(res.proposedJson) as { summary: string; detail: string; patch: PartialProjectPatch };
            store.propose({
              id: `g${Date.now()}`,
              summary: proposed.summary,
              detail: proposed.detail,
              patch: proposed.patch,
              fromGrok: true,
            });
          } catch {
            /* ignore */
          }
        }
        if (res.appEditJson) {
          try {
            const ae = JSON.parse(res.appEditJson) as { summary: string; branch?: string; files: AppEditJob["files"] };
            store.setPendingAppEdit({
              id: `job${Date.now()}`,
              request: ae.summary,
              branch: ae.branch || "ui",
              files: ae.files,
              status: "proposed",
              at: Date.now(),
            });
            store.openSheet("app", "half");
          } catch {
            /* ignore */
          }
        }
        if (res.realityQuestion) {
          const r0 = store.project.reality ?? emptyReality();
          store.commit(
            { ...store.project, reality: { ...r0, interview: [...r0.interview, { id: nid("q"), q: res.realityQuestion }] } },
            "Interview question",
          );
        }
        if (res.findingJson) {
          try {
            const f = JSON.parse(res.findingJson) as {
              kind?: string;
              summary?: string;
              confidence?: string;
              x?: number;
              y?: number;
              z?: number;
              widthM?: number;
              heightM?: number;
              depthM?: number;
            };
            const kind = (["beam", "column", "obstruction", "duct", "other"].includes(String(f.kind))
              ? f.kind
              : "other") as RealityFinding["kind"];
            store.addFinding({
              id: nid("find"),
              kind,
              summary: f.summary || kind,
              confidence: f.confidence === "HIGH" || f.confidence === "MEDIUM" ? f.confidence : "LOW",
              status: "PENDING",
              estimated: {
                kind,
                name: f.summary || kind,
                x: Number(f.x) || 1,
                y: Number(f.y) || 1,
                z: Number(f.z) || 2.2,
                widthM: Number(f.widthM) || 0.3,
                heightM: Number(f.heightM) || 0.3,
                depthM: Number(f.depthM) || 0.4,
                provenance: "PHOTO_ESTIMATE",
                confidence: f.confidence === "HIGH" || f.confidence === "MEDIUM" ? f.confidence : "LOW",
              },
            });
            store.openSheet("reality", "half");
          } catch {
            /* ignore */
          }
        }
        store.pushGrok({ id: `a${Date.now()}`, role: "assistant", text: res.text || "Готово." });
      }
    } catch (e) {
      store.pushGrok({
        id: `a${Date.now()}`,
        role: "assistant",
        text: e instanceof Error ? e.message : "Grok unavailable",
      });
    } finally {
      store.setGrokBusy(false);
      store.setPendingImages([]);
    }
  };

  useEffect(() => {
    if (!pending) return;
    useProjectStore.setState({ pendingGrok: null });
    void send(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const attach = async (files: FileList | null) => {
    if (!files?.length) return;
    const urls: string[] = [];
    for (const file of [...files].slice(0, 3)) {
      if (!file.type.startsWith("image/")) continue;
      const dataUrl = await resizeImageFile(file);
      const id = nid("photo");
      await saveMedia(id, dataUrl);
      store.addPhotoMeta({ id, name: file.name, mime: file.type, createdAt: Date.now(), notes: "", markers: [] });
      urls.push(dataUrl);
    }
    store.setPendingImages(urls);
  };

  return (
    <div className={cn("flex flex-col border-t border-border", fill ? "h-full min-h-0 border-t-0" : "h-[240px]")} data-mf-id="grok">
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted">MINEFORGE AI</div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.12em] text-cold">{SCOPE_RU[store.grokScope]}</span>
          {store.grokOffline && <div className="text-[10px] text-warn">AI OFFLINE</div>}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 text-[12px]">
        {store.grok.map((m) => (
          <div key={m.id} className={m.role === "user" ? "text-fg" : "text-muted"}>
            {m.text}
          </div>
        ))}
        {store.grokBusy && <div className="text-subtle">Считаю по ядру…</div>}
      </div>
      <form
        className="flex flex-col gap-1 border-t border-border p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <div className="flex gap-1">
          <input
            suppressHydrationWarning
            className="h-9 min-w-0 flex-1 rounded-[6px] border border-border bg-bg px-2 text-[12px] outline-none"
            placeholder="Спросить инженера…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            suppressHydrationWarning
            onChange={(e) => void attach(e.target.files)}
          />
          <Button type="button" variant="outline" className="h-9" onClick={() => fileRef.current?.click()}>
            Фото
          </Button>
          <Button type="submit" variant="outline" className="h-9" disabled={store.grokBusy}>
            OK
          </Button>
        </div>
        {store.pendingImages.length > 0 && <div className="text-[10px] text-cold">{store.pendingImages.length} фото к сообщению</div>}
        {store.pickedUi && (
          <div className="text-[10px] text-cold">
            UI: {store.pickedUi.name} · {store.pickedUi.file}
          </div>
        )}
      </form>
    </div>
  );
}
