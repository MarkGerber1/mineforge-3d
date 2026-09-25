import { useRef, useState } from "react";
import type { Project } from "@/engineering/types";
import { useProjectStore } from "@/project/store";
import { commitImportedProject, listProjects, readProjectMedia } from "@/project/persistence";
import { migrateProject } from "@/project/schema";
import {
  PROJECT_IMPORT_ACCEPT,
  attemptImport,
  buildPortableBundle,
  prepareImport,
  safeProjectFilename,
  stringifyPortableBundle,
  type PortableBundle,
} from "@/project/portable";

function downloadJson(filename: string, json: string) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ProjectPortability({ surface }: { surface: "mobile" | "desktop" }) {
  const store = useProjectStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PortableBundle | null>(null);
  const [busy, setBusy] = useState(false);
  const id = (name: string) => `project-${name}-${surface}`;

  async function onExport() {
    if (busy) return;
    setBusy(true);
    setPending(null);
    try {
      migrateProject(structuredClone(store.project));
      const media = await readProjectMedia(store.project);
      const bundle = buildPortableBundle(store.project, media);
      downloadJson(safeProjectFilename(store.project.name), stringifyPortableBundle(bundle));
      setNotice(
        bundle.missingMedia.length > 0
          ? `Проект экспортирован, но ${bundle.missingMedia.length} фото отсутствуют в локальном хранилище.`
          : "Проект экспортирован",
      );
    } catch {
      setNotice("Экспорт не выполнен.");
    } finally {
      setBusy(false);
    }
  }

  async function activate(project: Project, media: Record<string, string>) {
    await commitImportedProject(project, media);
    const loaded = store.loadProject(project, false);
    if (!loaded.ok) {
      setNotice(`Импорт отклонён: ${loaded.reason ?? "проект не активирован"}`);
      return;
    }
    const photoId = project.reality?.photos[0]?.id ?? null;
    store.setActivePhoto(photoId);
    store.setView("2d");
    setPending(null);
    setNotice(`Проект импортирован: ${project.name}`);
  }

  async function onFile(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    const current = store.project;
    try {
      const text = await file.text();
      const existing = new Set((await listProjects()).map((row) => row.id));
      const attempt = attemptImport(current, text, existing);
      if (!attempt.ok && attempt.collision) {
        setPending(attempt.bundle);
        setNotice("Локальный проект с этим id уже есть. Заменить его или импортировать как копию.");
        return;
      }
      if (!attempt.ok) {
        setPending(null);
        setNotice(`Импорт отклонён: ${attempt.error}`);
        return;
      }
      await activate(attempt.project, attempt.media);
    } catch {
      setNotice("Импорт отклонён: не удалось прочитать файл.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
      setBusy(false);
    }
  }

  async function decide(decision: "replace" | "copy") {
    if (!pending || busy) return;
    setBusy(true);
    const current = store.project;
    try {
      const existing = new Set((await listProjects()).map((row) => row.id));
      const prepared = prepareImport(pending, existing, decision);
      if (decision === "copy" && prepared.project.id === current.id) {
        setNotice("Импорт отклонён: копия не создана.");
        return;
      }
      await activate(prepared.project, prepared.media);
    } catch (error) {
      const reason = error instanceof Error && error.message.length < 180 ? error.message : "не удалось записать проект.";
      setNotice(`Импорт отклонён: ${reason}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1" data-mf-id={id("portability")}>
      <button
        type="button"
        data-mf-id={id("export")}
        className="h-11 rounded-[8px] bg-raised px-2 text-[11px] text-fg"
        onClick={() => void onExport()}
        disabled={busy}
      >
        Экспорт проекта
      </button>
      <label
        className="relative flex h-11 items-center justify-center rounded-[8px] bg-raised px-2 text-[11px] text-fg"
        data-mf-id={id("import")}
      >
        Импорт проекта
        <input
          ref={inputRef}
          type="file"
          accept={PROJECT_IMPORT_ACCEPT}
          data-mf-id={id("import-file")}
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
      </label>
      {pending && (
        <div className="grid grid-cols-1 gap-1">
          <button
            type="button"
            data-mf-id={id("import-replace")}
            className="h-11 rounded-[8px] border border-border px-2 text-[11px] text-fg"
            onClick={() => void decide("replace")}
          >
            Заменить локальный проект
          </button>
          <button
            type="button"
            data-mf-id={id("import-copy")}
            className="h-11 rounded-[8px] border border-border px-2 text-[11px] text-fg"
            onClick={() => void decide("copy")}
          >
            Импортировать как копию
          </button>
        </div>
      )}
      {notice && (
        <p className="text-[11px] leading-snug text-muted" data-mf-id={id("portability-notice")}>
          {notice}
        </p>
      )}
    </div>
  );
}
