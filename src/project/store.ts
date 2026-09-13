import { create } from "zustand";
import { defaultCatalogs } from "../engineering/catalogs.ts";
import { calculateAll, type Catalogs } from "../engineering/pipeline.ts";
import { alignRacks, distributeRacks, duplicateRackOffset, generateAutoLayout, rotateRack90, type AlignEdge } from "../engineering/layout.ts";
import { originDeltaForWallResize, resizeRectangularRoom, validateOpening } from "../engineering/geometry.ts";
import { validateCanonicalProjectDomains, validateRequestedCount } from "../engineering/canonical.ts";
import { applyPatchValidated, type PartialProjectPatch } from "../engineering/upgrade.ts";
import type { AppMode, EngineeringResult, Opening, Project, Rack, ViewMode, WallId } from "../engineering/types.ts";
import { SNAP_MODES_M, type SnapMode } from "../engineering/constants.ts";
import { undergroundParkingFarm } from "./factory.ts";
import { applyFailure, type FailureKind } from "../ai/failure.ts";
import type { GrokScope } from "../ai/intent.ts";
import { emptyReality, type AsBuiltObject, type PhotoMarker, type PhotoMarkerKind, type RealityFinding, type RealityPhotoMeta, type RealityVideoMeta, type VideoErrorCode } from "../engineering/types.ts";
import { applyFinding, attachVideoFrames, recordAnnotation } from "../engineering/reality.ts";
import type { RuntimeSnapshot } from "../ai/runtime-client.ts";
import { validateRoomHeightM, validateRoomLengthM } from "../engineering/room-resize.ts";
import { validateAvailablePowerW } from "../engineering/electrical.ts";
import { rackAsicCapacity, validateRackAsicCount } from "../engineering/racks.ts";
import { resolveAsic } from "../engineering/pipeline.ts";
import { validateRackPlacement, validateRacksConfiguration } from "../engineering/placement.ts";
import { saveScheduler, type PersistState } from "./save-scheduler.ts";

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

export type MeasureState = { a: { x: number; y: number; z?: number } | null; b: { x: number; y: number; z?: number } | null };

export interface HistoryEntry {
  label: string;
  project: Project;
  measure: MeasureState;
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
  saveState: PersistState;
  saveError: string | null;
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
  failureVisual: Project | null;
  failureResult: EngineeringResult | null;
  lastMutationError: string | null;
  appEditJobs: AppEditJob[];
  pendingAppEdit: AppEditJob | null;
  activePhotoId: string | null;
  pendingImages: string[];
  videoJob: {
    status: "idle" | "processing" | "failed";
    error?: VideoErrorCode;
    errorText?: string;
    videoId?: string;
  };

  live(): Project;
  liveResult(): EngineeringResult;
  canonical(): Project;
  commit(next: Project, label: string): boolean;
  setPreview(next: Project | null): void;
  commitGeometryPreview(label: string): void;
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
  resizeWall(wall: WallId, lengthM: number, preview?: boolean): { ok: boolean; reason?: string };
  addOpening(o: Opening): { ok: boolean; errors: string[] };
  updateOpening(id: string, patch: Partial<Opening>, preview?: boolean): { ok: boolean; errors: string[] };
  addRack(rack: Rack): { ok: boolean; errors: string[] };
  moveRack(id: string, x: number, y: number, preview?: boolean): { ok: boolean; errors: string[] };
  setFleet(asicId: string, count: number): { ok: boolean; reason?: string };
  setPower(watts: number, reservePct?: number): { ok: boolean; reason?: string };
  setRoomHeight(heightM: number): { ok: boolean; reason?: string };
  setRackAsicCount(id: string, count: number): { ok: boolean; reason?: string };
  setDeltaT(k: number): { ok: boolean; reason?: string };
  setFan(specId: string, count?: number, arrangement?: "single" | "parallel"): { ok: boolean; reason?: string };
  autoLayout(): { ok: boolean; reason?: string };
  applyProposed(): { ok: boolean; errors: string[] };
  cancelProposed(): void;
  propose(change: ProposedChange): void;
  alignSelection(edge: AlignEdge): { ok: boolean; errors: string[] };
  distributeSelection(axis: "x" | "y"): { ok: boolean; errors: string[] };
  rotateSelectedRack(): { ok: boolean; errors: string[] };
  duplicateSelectedRack(): { ok: boolean; errors: string[] };
  duplicateScenario(name: string): void;
  loadProject(p: Project, asFirstRun?: boolean): { ok: boolean; reason?: string };
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
  setPhotoWallHint(photoId: string, wall: WallId | undefined): void;
  annotatePhoto(photoId: string, a: PhotoMarker, b: PhotoMarker, opts: { knownLengthM?: number; kind: PhotoMarkerKind }): void;
  commitVideoEvidence(video: RealityVideoMeta, frames: RealityPhotoMeta[]): void;
  toggleFrameSelect(photoId: string): void;
  removePhoto(photoId: string): void;
  setVideoJob(job: ProjectStore["videoJob"]): void;
  retrySave(): void;
}

const catalogs = defaultCatalogs();
const initial = undergroundParkingFarm();
const initialResult = calculateAll(initial, catalogs);

function scheduleSave(p: Project, set: (s: Partial<ProjectStore>) => void) {
  saveScheduler.schedule(p, (s) => set(s));
}

function visualProject(project: Project, preview: Project | null, failureSim: FailureKind, failureVisual: Project | null): Project {
  if (failureSim === "none") return preview ?? project;
  return failureVisual ?? applyFailure(preview ?? project, failureSim);
}

function overlayFrom(
  project: Project,
  preview: Project | null,
  kind: FailureKind,
  catalogs: Catalogs,
): { failureVisual: Project | null; failureResult: EngineeringResult | null } {
  if (kind === "none") return { failureVisual: null, failureResult: null };
  const vis = applyFailure(preview ?? project, kind);
  return { failureVisual: vis, failureResult: calculateAll(vis, catalogs) };
}

function cloneMeasure(m: MeasureState): MeasureState {
  return {
    a: m.a ? { ...m.a } : null,
    b: m.b ? { ...m.b } : null,
  };
}

function shiftMeasure(measure: MeasureState, dx: number, dy: number): MeasureState {
  if (!dx && !dy) return measure;
  const shift = (p: { x: number; y: number; z?: number } | null) => (p ? { ...p, x: p.x + dx, y: p.y + dy } : p);
  return { a: shift(measure.a), b: shift(measure.b) };
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
  saveError: null,
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
  failureVisual: null,
  failureResult: null,
  lastMutationError: null,
  appEditJobs: [],
  pendingAppEdit: null,
  activePhotoId: null,
  pendingImages: [],
  videoJob: { status: "idle" },

  live() {
    const s = get();
    return visualProject(s.project, s.preview, s.failureSim, s.failureVisual);
  },
  liveResult() {
    const s = get();
    if (s.failureSim !== "none") return s.failureResult ?? s.previewResult ?? s.result;
    return s.previewResult ?? s.result;
  },
  canonical() {
    return get().project;
  },
  commit(next, label) {
    const { project, past, catalogs, failureSim, measure } = get();
    const domains = validateCanonicalProjectDomains(next, catalogs);
    if (!domains.ok) {
      set({ lastMutationError: domains.errors[0] ?? "Каноническая проверка не пройдена." });
      return false;
    }
    const result = calculateAll(next, catalogs);
    const overlay = overlayFrom(next, null, failureSim, catalogs);
    set({
      past: [...past.slice(-99), { label, project, measure: cloneMeasure(measure) }],
      future: [],
      project: { ...next, updatedAt: Date.now() },
      preview: null,
      previewResult: null,
      result,
      lastMutationError: null,
      ...overlay,
    });
    scheduleSave(get().project, (s) => set(s));
    return true;
  },
  setPreview(next) {
    const { catalogs, failureSim, project } = get();
    if (!next) {
      set({ preview: null, previewResult: null, ...overlayFrom(project, null, failureSim, catalogs) });
      return;
    }
    set({
      preview: next,
      previewResult: calculateAll(next, catalogs),
      ...overlayFrom(project, next, failureSim, catalogs),
    });
  },
  commitGeometryPreview(label) {
    const geo = get().preview;
    if (!geo) return;
    get().commit(geo, label);
  },
  undo() {
    const { past, project, future, catalogs, failureSim, measure } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    const result = calculateAll(prev.project, catalogs);
    set({
      project: prev.project,
      measure: cloneMeasure(prev.measure),
      past: past.slice(0, -1),
      future: [{ label: "Redo", project, measure: cloneMeasure(measure) }, ...future],
      result,
      preview: null,
      previewResult: null,
      ...overlayFrom(prev.project, null, failureSim, catalogs),
    });
    scheduleSave(prev.project, (s) => set(s));
  },
  redo() {
    const { future, project, past, catalogs, failureSim, measure } = get();
    if (!future.length) return;
    const nxt = future[0];
    const result = calculateAll(nxt.project, catalogs);
    set({
      project: nxt.project,
      measure: cloneMeasure(nxt.measure),
      future: future.slice(1),
      past: [...past, { label: "Undo", project, measure: cloneMeasure(measure) }],
      result,
      preview: null,
      previewResult: null,
      ...overlayFrom(nxt.project, null, failureSim, catalogs),
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
    const check = validateRoomLengthM(lengthM);
    if (!check.ok) {
      if (!preview) return { ok: false, reason: check.reason };
      get().setPreview(null);
      return { ok: false, reason: check.reason };
    }
    const src = get().project;
    const prevLen = wall === "east" || wall === "west" ? src.room.widthM : src.room.depthM;
    const next = resizeRectangularRoom(src, wall, check.meters);
    if (preview) {
      get().setPreview(next);
      return { ok: true };
    }
    const { dx, dy } = originDeltaForWallResize(wall, prevLen, check.meters);
    get().commit(next, `Resize ${wall} wall`);
    if (dx || dy) set({ measure: shiftMeasure(get().measure, dx, dy) });
    return { ok: true };
  },
  addOpening(o) {
    const src = get().project;
    const v = validateOpening(src, o);
    if (!v.ok) return { ok: false, errors: v.errors };
    get().commit({ ...src, openings: [...src.openings, o], updatedAt: Date.now() }, `Add ${o.type}`);
    set({ selectedIds: [o.id] });
    return { ok: true, errors: [] };
  },
  updateOpening(id, patch, preview) {
    const src = get().project;
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
  addRack(rack) {
    const src = get().project;
    const v = validateRackPlacement(src, rack);
    if (!v.ok) return { ok: false, errors: v.errors };
    get().commit({ ...src, racks: [...src.racks, rack], updatedAt: Date.now() }, "Add rack");
    set({ selectedIds: [rack.id] });
    return { ok: true, errors: [] };
  },
  moveRack(id, x, y, preview) {
    const src = get().project;
    const nextRacks = src.racks.map((r) => (r.id === id ? { ...r, x, y } : r));
    const candidate = nextRacks.find((r) => r.id === id);
    if (!candidate) return { ok: false, errors: ["Missing rack"] };
    const next = { ...src, racks: nextRacks, updatedAt: Date.now() };
    const v = validateRackPlacement(next, candidate, { ignoreIds: [id] });
    if (preview) {
      get().setPreview(next);
      return v.ok ? { ok: true, errors: [] } : { ok: false, errors: v.errors };
    }
    if (!v.ok) return { ok: false, errors: v.errors };
    get().commit(next, "Move rack");
    return { ok: true, errors: [] };
  },
  setFleet(asicId, count) {
    const check = validateRequestedCount(count);
    if (!check.ok) {
      set({ lastMutationError: check.reason });
      return { ok: false, reason: check.reason };
    }
    const src = get().project;
    const next = { ...src, fleet: { ...src.fleet, asicId, requestedCount: check.count } };
    const domains = validateCanonicalProjectDomains(next, get().catalogs);
    if (!domains.ok) {
      set({ lastMutationError: domains.errors[0] ?? "Каноническая проверка не пройдена." });
      return { ok: false, reason: domains.errors[0] };
    }
    const committed = get().commit(next, "Set ASIC fleet");
    if (!committed) return { ok: false, reason: get().lastMutationError ?? "Каноническая проверка не пройдена." };
    return { ok: true };
  },
  setPower(watts, reservePct) {
    const check = validateAvailablePowerW(watts);
    if (!check.ok) {
      set({ lastMutationError: check.reason });
      return { ok: false, reason: check.reason };
    }
    const src = get().project;
    const ok = get().commit(
      {
        ...src,
        electrical: {
          ...src.electrical,
          availablePowerW: check.watts,
          known: true,
          reservePct: reservePct ?? src.electrical.reservePct,
        },
      },
      "Set electrical supply",
    );
    if (!ok) return { ok: false, reason: get().lastMutationError ?? "Каноническая проверка не пройдена." };
    return { ok: true };
  },
  setRoomHeight(heightM) {
    const check = validateRoomHeightM(heightM);
    if (!check.ok) {
      set({ lastMutationError: check.reason });
      return { ok: false, reason: check.reason };
    }
    const src = get().project;
    if (src.room.heightM === check.meters) return { ok: true };
    const ok = get().commit({ ...src, room: { ...src.room, heightM: check.meters } }, "Set height");
    if (!ok) return { ok: false, reason: get().lastMutationError ?? "Каноническая проверка не пройдена." };
    return { ok: true };
  },
  setRackAsicCount(id, count) {
    const src = get().project;
    const rack = src.racks.find((r) => r.id === id);
    if (!rack) {
      set({ lastMutationError: "Стойка не найдена." });
      return { ok: false, reason: "Стойка не найдена." };
    }
    const asic = resolveAsic(src, get().catalogs);
    const cap = asic ? rackAsicCapacity(rack, asic) : 0;
    const check = validateRackAsicCount(count, cap);
    if (!check.ok) {
      set({ lastMutationError: check.reason });
      return { ok: false, reason: check.reason };
    }
    const ok = get().commit(
      {
        ...src,
        racks: src.racks.map((r) => (r.id === id ? { ...r, asicCount: check.count } : r)),
      },
      "Set rack ASIC",
    );
    if (!ok) return { ok: false, reason: get().lastMutationError ?? "Каноническая проверка не пройдена." };
    return { ok: true };
  },
  setDeltaT(k) {
    const src = get().project;
    const ok = get().commit({ ...src, thermal: { ...src.thermal, deltaTK: k } }, "Set ΔT");
    if (!ok) return { ok: false, reason: get().lastMutationError ?? "ΔT вне допустимого диапазона." };
    return { ok: true };
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
    const ok = get().commit({ ...src, fans }, "Set fan");
    if (!ok) return { ok: false, reason: get().lastMutationError ?? "Параметры вентилятора недопустимы." };
    return { ok: true };
  },
  autoLayout() {
    const src = get().project;
    const asic = src.fleet.imported ?? get().catalogs.asics[src.fleet.asicId] ?? null;
    const racks = generateAutoLayout(src, asic);
    const v = validateRacksConfiguration(src, racks, racks.map((r) => r.id));
    if (!v.ok) {
      set({ lastMutationError: v.errors[0] ?? "Авторасстановка недопустима." });
      return { ok: false, reason: v.errors[0] };
    }
    get().commit({ ...src, racks }, "Auto layout");
    return { ok: true };
  },
  applyProposed() {
    const { proposed, project } = get();
    if (!proposed) return { ok: false, errors: ["Нет предложения."] };
    const applied = applyPatchValidated(project, proposed.patch, get().catalogs);
    if (!applied.ok) {
      set({ lastMutationError: applied.errors[0] ?? "Патч отклонён." });
      get().pushGrok({
        id: `rej${Date.now()}`,
        role: "assistant",
        text: `Патч отклонён: ${applied.errors.join("; ")}. Каноническая геометрия не изменена.`,
      });
      return { ok: false, errors: applied.errors };
    }
    get().commit(applied.project, proposed.summary);
    set({ proposed: null, lastMutationError: null });
    return { ok: true, errors: [] };
  },
  cancelProposed() {
    set({ proposed: null });
  },
  propose(change) {
    set({ proposed: change });
  },
  alignSelection(edge) {
    const src = get().project;
    const ids = get().selectedIds.filter((id) => src.racks.some((r) => r.id === id));
    const nextRacks = alignRacks(src.racks, ids, edge);
    const v = validateRacksConfiguration(src, nextRacks, ids);
    if (!v.ok) {
      set({ lastMutationError: v.errors[0] ?? "Выравнивание недопустимо." });
      return { ok: false, errors: v.errors };
    }
    get().commit({ ...src, racks: nextRacks }, `Align ${edge}`);
    return { ok: true, errors: [] };
  },
  distributeSelection(axis) {
    const src = get().project;
    const ids = get().selectedIds.filter((id) => src.racks.some((r) => r.id === id));
    const nextRacks = distributeRacks(src.racks, ids, axis);
    const v = validateRacksConfiguration(src, nextRacks, ids);
    if (!v.ok) {
      set({ lastMutationError: v.errors[0] ?? "Распределение недопустимо." });
      return { ok: false, errors: v.errors };
    }
    get().commit({ ...src, racks: nextRacks }, `Distribute ${axis}`);
    return { ok: true, errors: [] };
  },
  rotateSelectedRack() {
    const src = get().project;
    const id = get().selectedIds.find((i) => src.racks.some((r) => r.id === i));
    if (!id) return { ok: false, errors: ["Стойка не выбрана."] };
    const nextRacks = rotateRack90(src.racks, id);
    const v = validateRacksConfiguration(src, nextRacks, [id]);
    if (!v.ok) {
      set({ lastMutationError: v.errors[0] ?? "Поворот недопустим." });
      return { ok: false, errors: v.errors };
    }
    get().commit({ ...src, racks: nextRacks }, "Rotate rack");
    return { ok: true, errors: [] };
  },
  duplicateSelectedRack() {
    const src = get().project;
    const id = get().selectedIds.find((i) => src.racks.some((r) => r.id === i));
    if (!id) return { ok: false, errors: ["Стойка не выбрана."] };
    const copy = duplicateRackOffset(src.racks, id);
    if (!copy) return { ok: false, errors: ["Стойка не найдена."] };
    const nextRacks = [...src.racks, copy];
    const v = validateRacksConfiguration(src, nextRacks, [copy.id]);
    if (!v.ok) {
      set({ lastMutationError: v.errors[0] ?? "Дублирование недопустимо." });
      return { ok: false, errors: v.errors };
    }
    get().commit({ ...src, racks: nextRacks }, "Duplicate rack");
    set({ selectedIds: [copy.id] });
    return { ok: true, errors: [] };
  },
  duplicateScenario(name) {
    const { project, scenarios } = get();
    set({
      scenarios: [...scenarios, { id: `sc_${Date.now().toString(36)}`, name, project: structuredClone(project) }],
    });
  },
  loadProject(p, asFirstRun = false) {
    const catalogs = get().catalogs;
    const domains = validateCanonicalProjectDomains(p, catalogs);
    if (!domains.ok) {
      set({ lastMutationError: domains.errors[0] ?? "Проект отклонён: недопустимые канонические поля." });
      return { ok: false, reason: domains.errors[0] };
    }
    const result = calculateAll(p, catalogs);
    set({
      project: p,
      result,
      past: [],
      future: [],
      preview: null,
      previewResult: null,
      firstRun: asFirstRun,
      selectedIds: [],
      failureSim: "none",
      failureVisual: null,
      failureResult: null,
      lastMutationError: null,
    });
    scheduleSave(p, (s) => set(s));
    return { ok: true };
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
    const { project, preview, catalogs } = get();
    set({ failureSim: kind, ...overlayFrom(project, preview, kind, catalogs) });
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
    const { project, ok, errors } = applyFinding(src, id, status);
    if (!ok) {
      get().pushGrok({
        id: `rv${Date.now()}`,
        role: "assistant",
        text: `Reality Sync: не удалось применить (${errors.join("; ")}). Геометрия не изменена.`,
      });
      return;
    }
    get().commit(project, status === "ADDED" ? "Reality Sync: в модель" : "Reality Sync: игнор");
  },
  addPhotoMeta(meta) {
    const src = get().project;
    const reality = src.reality ?? emptyReality();
    get().commit({ ...src, reality: { ...reality, photos: [...reality.photos, meta] } }, "Add photo");
    set({ activePhotoId: meta.id, sheet: "full", sheetTab: "reality" });
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
  setPhotoWallHint(photoId, wall) {
    const src = get().project;
    const reality = src.reality ?? emptyReality();
    get().commit(
      {
        ...src,
        reality: {
          ...reality,
          photos: reality.photos.map((p) => (p.id === photoId ? { ...p, wallHint: wall } : p)),
        },
      },
      wall ? `Стена фото: ${wall}` : "Стена фото сброшена",
    );
  },
  annotatePhoto(photoId, a, b, opts) {
    const src = get().project;
    const { project, finding } = recordAnnotation(src, photoId, a, b, opts);
    get().commit(project, finding ? `Аннотация ${finding.kind}` : "Калибровка фото");
  },
  commitVideoEvidence(video, frames) {
    const src = get().project;
    const next = attachVideoFrames(src, video, frames);
    get().commit(next, `Video frames ${video.name}`);
    set({
      activePhotoId: frames[0]?.id ?? video.selectedFrameIds[0] ?? get().activePhotoId,
      sheet: "full",
      sheetTab: "reality",
    });
  },
  toggleFrameSelect(photoId) {
    const src = get().project;
    const reality = src.reality ?? emptyReality();
    const videos = (reality.videos ?? []).map((v) => {
      if (!v.frameIds.includes(photoId)) return v;
      const has = v.selectedFrameIds.includes(photoId);
      const selectedFrameIds = has
        ? v.selectedFrameIds.filter((id) => id !== photoId)
        : [...v.selectedFrameIds, photoId].slice(-3);
      return { ...v, selectedFrameIds };
    });
    get().commit({ ...src, reality: { ...reality, videos } }, "Select video frame");
  },
  removePhoto(photoId) {
    const src = get().project;
    const reality = src.reality ?? emptyReality();
    const photos = reality.photos.filter((p) => p.id !== photoId);
    const videos = (reality.videos ?? []).map((v) => ({
      ...v,
      frameIds: v.frameIds.filter((id) => id !== photoId),
      selectedFrameIds: v.selectedFrameIds.filter((id) => id !== photoId),
    }));
    get().commit({ ...src, reality: { ...reality, photos, videos } }, "Remove evidence");
    if (get().activePhotoId === photoId) set({ activePhotoId: photos[0]?.id ?? null });
    void import("../reality/media.ts").then((m) => m.deleteMedia(photoId)).catch(() => undefined);
  },
  setVideoJob(videoJob) {
    set({ videoJob });
  },
  retrySave() {
    saveScheduler.retry((s) => set(s));
  },
}));

export function snapStep(): number {
  const s = useProjectStore.getState();
  return s.snapEnabled ? SNAP_MODES_M[s.snapMode] : 0.0001;
}

export function useLiveProject(): Project {
  return useProjectStore((s) => (s.failureSim === "none" ? (s.preview ?? s.project) : (s.failureVisual ?? s.preview ?? s.project)));
}

export function useLiveResult(): EngineeringResult {
  return useProjectStore((s) =>
    s.failureSim === "none" ? (s.previewResult ?? s.result) : (s.failureResult ?? s.previewResult ?? s.result),
  );
}

if (typeof window !== "undefined") {
  (window as unknown as { __MF_STORE__: typeof useProjectStore }).__MF_STORE__ = useProjectStore;
}
