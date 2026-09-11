import { create } from "zustand";
import { defaultCatalogs } from "../engineering/catalogs.ts";
import { calculateAll, type Catalogs } from "../engineering/pipeline.ts";
import { generateAutoLayout } from "../engineering/layout.ts";
import { resizeRectangularRoom, validateOpening } from "../engineering/geometry.ts";
import { applyPatch, type PartialProjectPatch } from "../engineering/upgrade.ts";
import type { AppMode, EngineeringResult, Opening, Project, ViewMode, WallId } from "../engineering/types.ts";
import { SNAP_MODES_M, type SnapMode } from "../engineering/constants.ts";
import { undergroundParkingFarm } from "./factory.ts";
import { saveProject } from "./persistence.ts";
import { applyFailure, type FailureKind } from "../ai/failure.ts";
import type { GrokScope } from "../ai/intent.ts";
import { emptyReality, type AsBuiltObject, type RealityFinding } from "../engineering/types.ts";
import type { RuntimeSnapshot } from "../ai/runtime-client.ts";

export type CadTool = "select" | "pan" | "measure" | "door" | "intake" | "exhaust" | "rack" | "fan";
export type SheetState = "closed" | "half" | "full";
export type SheetTab = "props" | "why" | "grok" | "reality" | "app";

export interface AppEditJob {
  id: string;
  request: string;
  branch: string;
  files: Array<{ path: string; instruction: string; oldSnippet?: string; newSnippet?: string }>;
  status: "proposed" | "applied" | "rejected" | "rolled_back" | "failed" | "preview" | "promoted";
  at: number;
  diff?: string;
  jobId?: string;
  previewUrl?: string;
  gates?: { typecheck?: boolean; tests?: boolean; build?: boolean };
  stableSha?: string;
  jobCommitSha?: string;
}

export interface HistoryEntry {
  label: string;
  project: Project;
}

export interface ProposedChange {
  id: string;
  summary: string;
  detail: string;
  patch: PartialProjectPatch;
  fromGrok: boolean;
}

export interface GrokMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  proposed?: ProposedChange;
}

export interface XrayLayers {
  airflow: boolean;
  temperature: boolean;
  electrical: boolean;
  warnings: boolean;
  pressure: boolean;
}

interface ProjectStore {
  project: Project;
  preview: Project | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  catalogs: Catalogs;
  result: EngineeringResult;
  previewResult: EngineeringResult | null;
  selectedIds: string[];
  mode: AppMode;
  view: ViewMode;
  tool: CadTool;
  snapMode: SnapMode;
  snapEnabled: boolean;
  gridEnabled: boolean;
  xray: XrayLayers;
  saveState: "idle" | "saving" | "saved";
  grok: GrokMessage[];
  grokBusy: boolean;
  grokOffline: boolean;
  runtime: RuntimeSnapshot | null;
  proposed: ProposedChange | null;
  scenarios: Array<{ id: string; name: string; project: Project }>;
  command: string;
  firstRun: boolean;
  whyOpen: boolean;
  inspectorOpen: boolean;
  pendingGrok: string | null;
  measure: { a: { x: number; y: number; z?: number } | null; b: { x: number; y: number; z?: number } | null };
  sheet: SheetState;
  sheetTab: SheetTab;
  grokScope: GrokScope;
  uiPick: boolean;
  pickedUi: { id: string; name: string; file: string } | null;
  multiSelect: boolean;
  failureSim: FailureKind;
  appEditJobs: AppEditJob[];
  pendingAppEdit: AppEditJob | null;
  activePhotoId: string | null;
  pendingImages: string[];

  live(): Project;
  liveResult(): EngineeringResult;
  commit(next: Project, label: string): void;
  setPreview(next: Project | null): void;
  undo(): void;
  redo(): void;
  select(ids: string[], additive?: boolean): void;
  setMode(mode: AppMode): void;
  setView(view: ViewMode): void;
  setTool(tool: CadTool): void;
  setSnap(mode: SnapMode): void;
  toggleSnap(): void;
  toggleGrid(): void;
  setXray(partial: Partial<XrayLayers>): void;
  resizeWall(wall: WallId, lengthM: number, preview?: boolean): void;
  addOpening(o: Opening): { ok: boolean; errors: string[] };
  updateOpening(id: string, patch: Partial<Opening>, preview?: boolean): { ok: boolean; errors: string[] };
  moveRack(id: string, x: number, y: number, preview?: boolean): void;
  setFleet(asicId: string, count: number): void;
  setPower(watts: number, reservePct?: number): void;
  setDeltaT(k: number): void;
  setFan(specId: string, count?: number, arrangement?: "single" | "parallel"): void;
  autoLayout(): void;
  applyProposed(): void;
  cancelProposed(): void;
  propose(change: ProposedChange): void;
  duplicateScenario(name: string): void;
  loadProject(p: Project, asFirstRun?: boolean): void;
  pushGrok(msg: GrokMessage): void;
  setGrokBusy(v: boolean): void;
  setGrokOffline(v: boolean): void;
  setRuntime(r: RuntimeSnapshot): void;
  setCommand(v: string): void;
  dismissFirstRun(): void;
  setWhyOpen(v: boolean): void;
  setInspectorOpen(v: boolean): void;
  askGrok(msg: string): void;
  setMeasure(m: ProjectStore["measure"]): void;
  setSheet(s: SheetState): void;
  setSheetTab(t: SheetTab): void;
  openSheet(tab?: SheetTab, state?: SheetState): void;
  setUiPick(v: boolean): void;
  setPickedUi(c: { id: string; name: string; file: string } | null): void;
  setMultiSelect(v: boolean): void;
  setFailureSim(k: FailureKind): void;
  setPendingAppEdit(job: AppEditJob | null): void;
  pushAppEditJob(job: AppEditJob): void;
  setActivePhoto(id: string | null): void;
  setPendingImages(urls: string[]): void;
  addAsBuilt(obj: AsBuiltObject): void;
  addFinding(f: RealityFinding): void;
  resolveFinding(id: string, status: "ADDED" | "IGNORED"): void;
  addPhotoMeta(meta: NonNullable<Project["reality"]>["photos"][number]): void;
  addPhotoMarker(photoId: string, marker: NonNullable<Project["reality"]>["photos"][number]["markers"][number]): void;
}

const catalogs = defaultCatalogs();
const initial = undergroundParkingFarm();
const initialResult = calculateAll(initial, catalogs);

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(p: Project, set: (s: Partial<ProjectStore>) => void) {
  set({ saveState: "saving" });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveProject(p)
      .then(() => set({ saveState: "saved" }))
      .catch(() => set({ saveState: "idle" }));
  }, 700);
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: initial,
  preview: null,
  past: [],
  future: [],
  catalogs,
  result: initialResult,
  previewResult: null,
  selectedIds: [],
  mode: "project",
  view: "2d",
  tool: "select",
  snapMode: "1cm",
  snapEnabled: true,
  gridEnabled: true,
  xray: { airflow: true, temperature: false, electrical: false, warnings: true, pressure: false },
  saveState: "idle",
  grok: [
    {
      id: "sys0",
      role: "assistant",
      text: "MINEFORGE готов. Открыт демо-объект: подземное помещение 8 × 5 × 2.8 м, шахта 75 м, 30 × S21 Pro. Можно тянуть стены, менять проёмы и смотреть, как меняется SAFE COUNT.",
    },
  ],
  grokBusy: false,
  grokOffline: false,
  runtime: null,
  proposed: null,
  scenarios: [],
  command: "",
  firstRun: false,
  whyOpen: false,
  inspectorOpen: false,
  pendingGrok: null,
  measure: { a: null, b: null },
  sheet: "closed",
  sheetTab: "grok",
  grokScope: "PROJECT",
  uiPick: false,
  pickedUi: null,
  multiSelect: false,
  failureSim: "none",
  appEditJobs: [],
  pendingAppEdit: null,
  activePhotoId: null,
  pendingImages: [],

  live() {
    return get().preview ?? get().project;
  },
  liveResult() {
    return get().previewResult ?? get().result;
  },
  commit(next, label) {
    const { project, past } = get();
    const result = calculateAll(next, get().catalogs);
    set({
      past: [...past.slice(-99), { label, project }],
      future: [],
      project: { ...next, updatedAt: Date.now() },
      preview: null,
      previewResult: null,
      result,
    });
    scheduleSave(get().project, (s) => set(s));
  },
  setPreview(next) {
    if (!next) {
      set({ preview: null, previewResult: null });
      return;
    }
    set({ preview: next, previewResult: calculateAll(next, get().catalogs) });
  },
  undo() {
    const { past, project, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    const result = calculateAll(prev.project, get().catalogs);
    set({
      project: prev.project,
      past: past.slice(0, -1),
      future: [{ label: "Redo", project }, ...future],
      result,
      preview: null,
      previewResult: null,
    });
    scheduleSave(prev.project, (s) => set(s));
  },
  redo() {
    const { future, project, past } = get();
    if (!future.length) return;
    const nxt = future[0];
    const result = calculateAll(nxt.project, get().catalogs);
    set({
      project: nxt.project,
      future: future.slice(1),
      past: [...past, { label: "Undo", project }],
      result,
      preview: null,
      previewResult: null,
    });
    scheduleSave(nxt.project, (s) => set(s));
  },
  select(ids, additive) {
    if (additive) {
      const cur = new Set(get().selectedIds);
      for (const id of ids) {
        if (cur.has(id)) cur.delete(id);
        else cur.add(id);
      }
      set({ selectedIds: [...cur] });
    } else set({ selectedIds: ids });
  },
  setMode: (mode) => {
    if (mode === "twin" || mode === "xray") {
      set({
        mode,
        view: "3d",
        xray:
          mode === "xray"
            ? { airflow: true, temperature: true, electrical: true, warnings: true, pressure: true }
            : get().xray,
      });
    } else {
      set({ mode });
    }
  },
  setView: (view) => set({ view }),
  setTool: (tool) => set({ tool, measure: tool === "measure" ? get().measure : { a: null, b: null } }),
  setSnap: (snapMode) => set({ snapMode }),
  toggleSnap: () => set({ snapEnabled: !get().snapEnabled }),
  toggleGrid: () => set({ gridEnabled: !get().gridEnabled }),
  setXray: (partial) => set({ xray: { ...get().xray, ...partial } }),
  resizeWall(wall, lengthM, preview) {
    const src = get().live();
    const next = resizeRectangularRoom(src, wall, lengthM);
    if (preview) get().setPreview(next);
    else get().commit(next, `Resize ${wall} wall`);
  },
  addOpening(o) {
    const src = get().live();
    const v = validateOpening(src, o);
    if (!v.ok) return { ok: false, errors: v.errors };
    get().commit({ ...src, openings: [...src.openings, o], updatedAt: Date.now() }, `Add ${o.type}`);
    set({ selectedIds: [o.id] });
    return { ok: true, errors: [] };
  },
  updateOpening(id, patch, preview) {
    const src = get().live();
    const nextO = src.openings.map((o) => (o.id === id ? { ...o, ...patch } : o));
    const candidate = nextO.find((o) => o.id === id);
    if (!candidate) return { ok: false, errors: ["Missing opening"] };
    const v = validateOpening({ ...src, openings: nextO }, candidate);
    if (!v.ok) return { ok: false, errors: v.errors };
    const next = { ...src, openings: nextO, updatedAt: Date.now() };
    if (preview) get().setPreview(next);
    else get().commit(next, "Update opening");
    return { ok: true, errors: [] };
  },
  moveRack(id, x, y, preview) {
    const src = get().live();
    const next = {
      ...src,
      racks: src.racks.map((r) => (r.id === id ? { ...r, x, y } : r)),
      updatedAt: Date.now(),
    };
    if (preview) get().setPreview(next);
    else get().commit(next, "Move rack");
  },
  setFleet(asicId, count) {
    const src = get().project;
    get().commit({ ...src, fleet: { ...src.fleet, asicId, requestedCount: Math.max(0, Math.floor(count)) } }, "Set ASIC fleet");
  },
  setPower(watts, reservePct) {
    const src = get().project;
    get().commit(
      {
        ...src,
        electrical: {
          ...src.electrical,
          availablePowerW: watts,
          known: watts > 0,
          reservePct: reservePct ?? src.electrical.reservePct,
        },
      },
      "Set electrical supply",
    );
  },
  setDeltaT(k) {
    const src = get().project;
    get().commit({ ...src, thermal: { ...src.thermal, deltaTK: k } }, "Set ΔT");
  },
  setFan(specId, count = 1, arrangement = "single") {
    const src = get().project;
    const fans =
      src.fans.length === 0
        ? [
            {
              id: `fan_${Date.now().toString(36)}`,
              specId,
              name: "Main fan",
              x: src.room.widthM - 0.8,
              y: src.room.depthM / 2,
              arrangement,
              count,
              dirtyFilter: false,
            },
          ]
        : src.fans.map((f, i) => (i === 0 ? { ...f, specId, count, arrangement } : f));
    get().commit({ ...src, fans }, "Set fan");
  },
  autoLayout() {
    const src = get().project;
    const asic = src.fleet.imported ?? get().catalogs.asics[src.fleet.asicId] ?? null;
    const racks = generateAutoLayout(src, asic);
    get().commit({ ...src, racks }, "Auto layout");
  },
  applyProposed() {
    const { proposed, project } = get();
    if (!proposed) return;
    const next = applyPatch(project, proposed.patch);
    get().commit(next, proposed.summary);
    set({ proposed: null });
  },
  cancelProposed() {
    set({ proposed: null });
  },
  propose(change) {
    set({ proposed: change });
  },
  duplicateScenario(name) {
    const { project, scenarios } = get();
    set({
      scenarios: [...scenarios, { id: `sc_${Date.now().toString(36)}`, name, project: structuredClone(project) }],
    });
  },
  loadProject(p, asFirstRun = false) {
    const result = calculateAll(p, get().catalogs);
    set({
      project: p,
      result,
      past: [],
      future: [],
      preview: null,
      previewResult: null,
      firstRun: asFirstRun,
      selectedIds: [],
    });
    scheduleSave(p, (s) => set(s));
  },
  pushGrok(msg) {
    set({ grok: [...get().grok, msg] });
  },
  setGrokBusy: (grokBusy) => set({ grokBusy }),
  setGrokOffline: (grokOffline) => set({ grokOffline }),
  setRuntime: (runtime) => set({ runtime, grokOffline: !runtime.ai }),
  setCommand: (command) => set({ command }),
  dismissFirstRun: () => set({ firstRun: false }),
  setWhyOpen: (whyOpen) => set({ whyOpen }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  askGrok: (msg) => set({ pendingGrok: msg }),
  setMeasure: (measure) => set({ measure }),
  setSheet: (sheet) => set({ sheet }),
  setSheetTab: (sheetTab) => set({ sheetTab }),
  openSheet: (tab, state = "half") => set({ sheet: state, sheetTab: tab ?? get().sheetTab, inspectorOpen: true }),
  setUiPick: (uiPick) => set({ uiPick, pickedUi: uiPick ? get().pickedUi : null }),
  setPickedUi: (pickedUi) => set({ pickedUi, uiPick: false, sheet: "half", sheetTab: "app" }),
  setMultiSelect: (multiSelect) => set({ multiSelect }),
  setFailureSim: (kind) => {
    if (kind === "none") {
      set({ failureSim: "none", preview: null, previewResult: null });
      return;
    }
    const next = applyFailure(get().project, kind);
    set({ failureSim: kind, preview: next, previewResult: calculateAll(next, get().catalogs) });
  },
  setPendingAppEdit: (pendingAppEdit) => set({ pendingAppEdit }),
  pushAppEditJob: (job) => set({ appEditJobs: [job, ...get().appEditJobs].slice(0, 40) }),
  setActivePhoto: (activePhotoId) => set({ activePhotoId }),
  setPendingImages: (pendingImages) => set({ pendingImages }),
  addAsBuilt(obj) {
    const src = get().project;
    const reality = src.reality ?? emptyReality();
    get().commit({ ...src, reality: { ...reality, asBuilt: [...reality.asBuilt, obj] } }, `As-built ${obj.name}`);
  },
  addFinding(f) {
    const src = get().project;
    const reality = src.reality ?? emptyReality();
    get().commit({ ...src, reality: { ...reality, findings: [...reality.findings, f] } }, "Reality finding");
  },
  resolveFinding(id, status) {
    const src = get().project;
    const reality = src.reality ?? emptyReality();
    const f = reality.findings.find((x) => x.id === id);
    let asBuilt = reality.asBuilt;
    if (status === "ADDED" && f?.estimated) {
      asBuilt = [
        ...asBuilt,
        {
          id: `ab_${Date.now().toString(36)}`,
          photoId: f.photoId,
          ...f.estimated,
        },
      ];
    }
    get().commit(
      {
        ...src,
        reality: {
          ...reality,
          asBuilt,
          findings: reality.findings.map((x) => (x.id === id ? { ...x, status } : x)),
        },
      },
      status === "ADDED" ? "Add as-built object" : "Ignore finding",
    );
  },
  addPhotoMeta(meta) {
    const src = get().project;
    const reality = src.reality ?? emptyReality();
    get().commit({ ...src, reality: { ...reality, photos: [...reality.photos, meta] } }, "Add photo");
    set({ activePhotoId: meta.id, sheet: "half", sheetTab: "reality" });
  },
  addPhotoMarker(photoId, marker) {
    const src = get().project;
    const reality = src.reality ?? emptyReality();
    get().commit(
      {
        ...src,
        reality: {
          ...reality,
          photos: reality.photos.map((p) => (p.id === photoId ? { ...p, markers: [...p.markers, marker] } : p)),
        },
      },
      "Photo marker",
    );
  },
}));

export function snapStep(): number {
  const s = useProjectStore.getState();
  return s.snapEnabled ? SNAP_MODES_M[s.snapMode] : 0.0001;
}

export function useLiveProject(): Project {
  return useProjectStore((s) => s.preview ?? s.project);
}

export function useLiveResult(): EngineeringResult {
  return useProjectStore((s) => s.previewResult ?? s.result);
}
