import type { Project } from "../engineering/types.ts";
import { saveProject as persistProject } from "./persistence.ts";

export type PersistState = "idle" | "saving" | "saved" | "error";

export interface PersistUi {
  saveState: PersistState;
  saveError: string | null;
}

export type PersistApply = (partial: PersistUi) => void;
export type SaveFn = (project: Project) => Promise<void>;

export function humanSaveError(): string {
  return "Не удалось сохранить проект.";
}

function shouldForceFail(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { __MF_FORCE_SAVE_ERROR__?: boolean }).__MF_FORCE_SAVE_ERROR__);
}

export function createSaveScheduler(opts?: { save?: SaveFn; debounceMs?: number }) {
  let gen = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastProject: Project | null = null;
  let save: SaveFn = opts?.save ?? ((p) => persistProject(p));
  const debounceMs = opts?.debounceMs ?? 700;

  const run = (project: Project, myGen: number, apply: PersistApply) => {
    const work = shouldForceFail() ? Promise.reject(new Error("forced")) : save(project);
    void work
      .then(() => {
        if (myGen !== gen) return;
        apply({ saveState: "saved", saveError: null });
      })
      .catch(() => {
        if (myGen !== gen) return;
        apply({ saveState: "error", saveError: humanSaveError() });
      });
  };

  return {
    get gen() {
      return gen;
    },
    last(): Project | null {
      return lastProject;
    },
    setSave(fn: SaveFn) {
      save = fn;
    },
    schedule(project: Project, apply: PersistApply) {
      const myGen = ++gen;
      lastProject = project;
      apply({ saveState: "saving", saveError: null });
      if (timer) clearTimeout(timer);
      if (debounceMs <= 0) {
        run(project, myGen, apply);
        return myGen;
      }
      timer = setTimeout(() => {
        timer = null;
        run(project, myGen, apply);
      }, debounceMs);
      return myGen;
    },
    retry(apply: PersistApply) {
      if (!lastProject) return 0;
      return this.schedule(lastProject, apply);
    },
    /** Test helper: flush pending debounce without advancing gen. */
    flushNow(apply: PersistApply) {
      if (!timer || !lastProject) return;
      clearTimeout(timer);
      timer = null;
      run(lastProject, gen, apply);
    },
  };
}

export const saveScheduler = createSaveScheduler();
