import { useEffect, useMemo, useRef, useState } from "react";
import { openingWorldRect, rackAabb, wallLength } from "@/engineering/geometry";
import { formatMeters, formatLengthHuman, snapTo } from "@/engineering/units";
import type { Opening, OpeningType, Rack, WallId } from "@/engineering/types";
import { MAX_ROOM_DIM_M, MIN_ROOM_DIM_M, SNAP_MODES_M } from "@/engineering/constants";
import { useLiveProject, useLiveResult, useProjectStore } from "@/project/store";
import { nid } from "@/project/factory";
import { TEST_RACK_A } from "@/project/factory";
import { validateRacksConfiguration, validateRackPlacement } from "@/engineering/placement";
import { validateRoomLengthInput, wallResizeContract, createWallDragContext, wallDragLengthM, originShiftForResize, wallCursor, pickWallHit, wallIdFromEventTarget, type WallDragContext } from "@/engineering/room-resize";

type Cam = { x: number; y: number; ppm: number };
type Drag =
  | { kind: "pan"; x: number; y: number; cx: number; cy: number }
  | {
      kind: "wall";
      wall: WallId;
      ctx: WallDragContext;
      startCam: Cam;
      lastLengthM: number;
    }
  | { kind: "opening"; id: string; startOff: number; pointer0: number }
  | { kind: "openingWidth"; id: string; edge: "start" | "end" }
  | { kind: "rack"; ids: string[]; dx: number; dy: number; ox: number[]; oy: number[] }
  | { kind: "measure" };

function clientToWorld(el: HTMLElement, cam: Cam, cx: number, cy: number) {
  const r = el.getBoundingClientRect();
  const sx = cx - r.left;
  const sy = cy - r.top;
  const x = cam.x + (sx - r.width / 2) / cam.ppm;
  const y = cam.y - (sy - r.height / 2) / cam.ppm;
  return { x, y };
}

function W({ x, y, cam, w, h }: { x: number; y: number; cam: Cam; w: number; h: number }) {
  return { sx: (x - cam.x) * cam.ppm + w / 2, sy: h / 2 - (y - cam.y) * cam.ppm };
}

export function Cad2D() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const project = useLiveProject();
  const result = useLiveResult();
  const store = useProjectStore();
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cam, setCam] = useState<Cam>({ x: project.room.widthM / 2, y: project.room.depthM / 2, ppm: 70 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [dimEdit, setDimEdit] = useState<{
    wall: WallId;
    value: string;
    error?: string | null;
    startCam: Cam;
    startWidthM: number;
    startDepthM: number;
  } | null>(null);
  const [placeHint, setPlaceHint] = useState<{ x: number; y: number; ok: boolean; reason?: string } | null>(null);
  const [badge, setBadge] = useState<{ x: number; y: number; text: string; sub?: string } | null>(null);
  const [guides, setGuides] = useState<Array<{ x1: number; y1: number; x2: number; y2: number }>>([]);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const space = useRef(false);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; ppm: number; cx: number; cy: number; mx: number; my: number } | null>(null);
  const collisionRef = useRef(false);
  const dragRef = useRef<Drag | null>(null);

  const beginDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const active = dragRef.current;
      if (active?.kind === "wall") {
        store.setPreview(null);
        setCam(active.startCam);
        beginDrag(null);
        setBadge(null);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("keydown", onKey);
    };
  }, [store]);

  const snapM = store.snapEnabled ? SNAP_MODES_M[store.snapMode] : 0.0001;
  const { w, h } = size;
  const toS = (x: number, y: number) => W({ x, y, cam, w, h });

  const walls: { id: WallId; x1: number; y1: number; x2: number; y2: number; length: number }[] = [
    { id: "south", x1: 0, y1: 0, x2: project.room.widthM, y2: 0, length: project.room.widthM },
    { id: "north", x1: 0, y1: project.room.depthM, x2: project.room.widthM, y2: project.room.depthM, length: project.room.widthM },
    { id: "west", x1: 0, y1: 0, x2: 0, y2: project.room.depthM, length: project.room.depthM },
    { id: "east", x1: project.room.widthM, y1: 0, x2: project.room.widthM, y2: project.room.depthM, length: project.room.depthM },
  ];

  const hitWall = (wx: number, wy: number): WallId | null => {
    return pickWallHit(wx, wy, project.room.widthM, project.room.depthM, 22 / cam.ppm);
  };

  const hitOpening = (wx: number, wy: number) => {
    const tol = 18 / cam.ppm;
    for (const o of project.openings) {
      const r = openingWorldRect(project, o);
      const minx = Math.min(r.x1, r.x2) - tol;
      const maxx = Math.max(r.x1, r.x2) + tol;
      const miny = Math.min(r.y1, r.y2) - tol;
      const maxy = Math.max(r.y1, r.y2) + tol;
      if (wx >= minx && wx <= maxx && wy >= miny && wy <= maxy) return o;
    }
    return null;
  };

  const hitRack = (wx: number, wy: number) => {
    const pad = 10 / cam.ppm;
    for (let i = project.racks.length - 1; i >= 0; i--) {
      const r = project.racks[i];
      const b = rackAabb(r);
      if (wx >= b.x1 - pad && wx <= b.x2 + pad && wy >= b.y1 - pad && wy <= b.y2 + pad) return r;
    }
    return null;
  };

  const applySnap = (v: number) => snapTo(v, snapM);

  function nearestWall(wx: number, wy: number): { wall: WallId; offset: number } | null {
    let best: { wall: WallId; offset: number; d: number } | null = null;
    const candidates: Array<{ wall: WallId; d: number; offset: number }> = [
      { wall: "south", d: Math.abs(wy), offset: wx },
      { wall: "north", d: Math.abs(wy - project.room.depthM), offset: wx },
      { wall: "west", d: Math.abs(wx), offset: wy },
      { wall: "east", d: Math.abs(wx - project.room.widthM), offset: wy },
    ];
    for (const c of candidates) {
      if (!best || c.d < best.d) best = c;
    }
    return best && best.d < 0.6 ? { wall: best.wall, offset: best.offset } : null;
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const el = wrapRef.current;
    if (!el) return;
    const world = clientToWorld(el, cam, e.clientX, e.clientY);
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const ppm = Math.min(400, Math.max(12, cam.ppm * factor));
    const r = el.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const nx = world.x - (sx - r.width / 2) / ppm;
    const ny = world.y + (sy - r.height / 2) / ppm;
    setCam({ x: nx, y: ny, ppm });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      pinch.current = { dist, ppm: cam.ppm, cx: cam.x, cy: cam.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      beginDrag(null);
      return;
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = clientToWorld(el, cam, e.clientX, e.clientY);
    if (e.button === 1 || space.current || store.tool === "pan" || (e.pointerType === "touch" && store.tool === "select" && e.altKey)) {
      beginDrag({ kind: "pan", x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y });
      return;
    }
    if (store.tool === "measure") {
      if (!store.measure.a) {
        store.setMeasure({ a: { x: applySnap(p.x), y: applySnap(p.y) }, b: null });
      } else {
        store.setMeasure({ a: store.measure.a, b: { x: applySnap(p.x), y: applySnap(p.y) } });
      }
      return;
    }
    if (store.tool === "door" || store.tool === "intake" || store.tool === "exhaust") {
      const nw = nearestWall(p.x, p.y);
      if (!nw) return;
      const type: OpeningType = store.tool === "door" ? "DOOR" : store.tool === "intake" ? "INTAKE" : "EXHAUST";
      const width = type === "DOOR" ? 1.0 : 1.4;
      const height = type === "DOOR" ? 2.1 : 0.9;
      const L = wallLength(project, nw.wall);
      const off = Math.max(0, Math.min(L - width, applySnap(nw.offset) - width / 2));
      const o: Opening = {
        id: nid("open"),
        type,
        wallId: nw.wall,
        widthM: width,
        heightM: height,
        bottomElevationM: type === "DOOR" ? 0 : 0.4,
        offsetFromWallStartM: off,
        name: type,
      };
      store.addOpening(o);
      store.setTool("select");
      return;
    }
    if (store.tool === "rack") {
      const rack: Rack = {
        id: nid("rack"),
        name: `R${project.racks.length + 1}`,
        ...TEST_RACK_A,
        x: applySnap(p.x),
        y: applySnap(p.y),
        rotationDeg: 0,
        asicCount: 0,
        airflowToward: "south",
      };
      const placed = store.addRack(rack);
      if (!placed.ok) {
        setPlaceHint({ x: rack.x, y: rack.y, ok: false, reason: placed.errors[0] });
        setBadge({
          x: e.clientX,
          y: e.clientY,
          text: "НЕДОПУСТИМО",
          sub: placed.errors[0],
        });
        return;
      }
      store.setTool("select");
      setPlaceHint(null);
      return;
    }

    const opening = hitOpening(p.x, p.y);
    if (opening) {
      store.select([opening.id], e.shiftKey || store.multiSelect);
      const along = opening.wallId === "east" || opening.wallId === "west" ? p.y : p.x;
      const start = opening.offsetFromWallStartM;
      const end = start + opening.widthM;
      const tol = 28 / cam.ppm;
      if (Math.abs(along - start) < tol) {
        beginDrag({ kind: "openingWidth", id: opening.id, edge: "start" });
        return;
      }
      if (Math.abs(along - end) < tol) {
        beginDrag({ kind: "openingWidth", id: opening.id, edge: "end" });
        return;
      }
      beginDrag({ kind: "opening", id: opening.id, startOff: opening.offsetFromWallStartM, pointer0: along });
      return;
    }
    const rack = hitRack(p.x, p.y);
    if (rack) {
      const ids = e.shiftKey || store.multiSelect
        ? store.selectedIds.includes(rack.id)
          ? store.selectedIds
          : [...store.selectedIds, rack.id]
        : store.selectedIds.includes(rack.id) && store.selectedIds.length > 1
          ? store.selectedIds
          : [rack.id];
      store.select(ids);
      const sel = project.racks.filter((r) => ids.includes(r.id));
      beginDrag({ kind: "rack", ids, dx: p.x, dy: p.y, ox: sel.map((r) => r.x), oy: sel.map((r) => r.y) });
      return;
    }
    const wall = wallIdFromEventTarget(e.target) ?? hitWall(p.x, p.y);
    if (wall) {
      store.select([`wall-${wall}`]);
      const src = store.project;
      const ctx = createWallDragContext(wall, src.room.widthM, src.room.depthM, p.x, p.y);
      const startLen = wall === "east" || wall === "west" ? src.room.widthM : src.room.depthM;
      beginDrag({ kind: "wall", wall, ctx, startCam: cam, lastLengthM: startLen });
      return;
    }
    if (!e.shiftKey && !store.multiSelect) store.select([]);
    setMarquee({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const ppm = Math.min(400, Math.max(12, pinch.current.ppm * (dist / (pinch.current.dist || dist))));
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = (mx - pinch.current.mx) / ppm;
      const dy = (my - pinch.current.my) / ppm;
      setCam({ x: pinch.current.cx - dx, y: pinch.current.cy + dy, ppm });
      return;
    }
    const p = clientToWorld(el, cam, e.clientX, e.clientY);
    const wallH = hitWall(p.x, p.y);
    const opH = hitOpening(p.x, p.y);
    const rkH = hitRack(p.x, p.y);
    setHover(opH?.id ?? rkH?.id ?? (wallH ? `wall-${wallH}` : null));

    if (marquee) {
      setMarquee({ ...marquee, x2: p.x, y2: p.y });
      return;
    }
    const drag = dragRef.current;
    if (!drag) {
      if (store.tool === "rack") {
        const x = applySnap(p.x);
        const y = applySnap(p.y);
        const ghost: Rack = {
          id: "__ghost__",
          name: "R",
          ...TEST_RACK_A,
          x,
          y,
          rotationDeg: 0,
          asicCount: 0,
          airflowToward: "south",
        };
        const v = validateRackPlacement(store.project, ghost);
        setPlaceHint({ x, y, ok: v.ok, reason: v.errors[0] });
      } else if (placeHint) {
        setPlaceHint(null);
      }
      setBadge(null);
      return;
    }
    if (drag.kind === "pan") {
      const dx = (e.clientX - drag.x) / cam.ppm;
      const dy = (e.clientY - drag.y) / cam.ppm;
      setCam({ ...cam, x: drag.cx - dx, y: drag.cy + dy });
      return;
    }
    if (drag.kind === "wall") {
      const p0 = clientToWorld(el, drag.startCam, e.clientX, e.clientY);
      let len = wallDragLengthM(drag.ctx, p0.x, p0.y);
      len = applySnap(Math.min(MAX_ROOM_DIM_M, Math.max(MIN_ROOM_DIM_M, len)));
      const res = store.resizeWall(drag.wall, len, true);
      if (!res.ok) {
        setCam(drag.startCam);
        beginDrag({
          ...drag,
          lastLengthM:
            drag.ctx.wall === "east" || drag.ctx.wall === "west" ? drag.ctx.startWidthM : drag.ctx.startDepthM,
        });
        return;
      }
      const shift = originShiftForResize(drag.wall, drag.ctx.startWidthM, drag.ctx.startDepthM, drag.wall === "east" || drag.wall === "west" ? len : drag.ctx.startWidthM, drag.wall === "north" || drag.wall === "south" ? len : drag.ctx.startDepthM);
      setCam({ x: drag.startCam.x + shift.dx, y: drag.startCam.y + shift.dy, ppm: drag.startCam.ppm });
      beginDrag({ ...drag, lastLengthM: len });
      const live = useProjectStore.getState().preview ?? useProjectStore.getState().project;
      const dim = drag.wall === "east" || drag.wall === "west" ? live.room.widthM : live.room.depthM;
      const area = live.room.widthM * live.room.depthM;
      setBadge({
        x: e.clientX,
        y: e.clientY,
        text: formatLengthHuman(dim),
        sub: `${formatMeters(dim)} · ${area.toFixed(3)} m²`,
      });
      return;
    }
    if (drag.kind === "opening") {
      const o = store.project.openings.find((x) => x.id === drag.id);
      if (!o) return;
      const L = wallLength(store.project, o.wallId);
      const along = o.wallId === "east" || o.wallId === "west" ? p.y : p.x;
      let next = applySnap(drag.startOff + (along - drag.pointer0));
      next = Math.max(0, Math.min(L - o.widthM, next));
      const res = store.updateOpening(o.id, { offsetFromWallStartM: next }, true);
      const fromStart = next;
      const fromEnd = L - next - o.widthM;
      setBadge({
        x: e.clientX,
        y: e.clientY,
        text: `${o.widthM.toFixed(3)} m`,
        sub: res.ok ? `от начала ${fromStart.toFixed(3)} · от конца ${fromEnd.toFixed(3)}` : res.errors[0],
      });
      return;
    }
    if (drag.kind === "rack") {
      const dx = applySnap(p.x - drag.dx);
      const dy = applySnap(p.y - drag.dy);
      const src = store.project;
      const nextRacks = src.racks.map((r) => {
        const i = drag.ids.indexOf(r.id);
        if (i < 0) return r;
        return { ...r, x: drag.ox[i] + dx, y: drag.oy[i] + dy };
      });
      const moving = nextRacks.filter((r) => drag.ids.includes(r.id));
      const others = nextRacks.filter((r) => !drag.ids.includes(r.id));
      const g: typeof guides = [];
      const v = validateRacksConfiguration(src, nextRacks, drag.ids);
      const invalid = !v.ok;
      for (const m of moving) {
        for (const o of others) {
          if (Math.abs(m.x - o.x) < 0.02) g.push({ x1: m.x, y1: 0, x2: m.x, y2: src.room.depthM });
          if (Math.abs(m.y - o.y) < 0.02) g.push({ x1: 0, y1: m.y, x2: src.room.widthM, y2: m.y });
        }
      }
      setGuides(g);
      collisionRef.current = invalid;
      store.setPreview({ ...src, racks: nextRacks });
      setBadge({
        x: e.clientX,
        y: e.clientY,
        text: invalid ? "COLLISION" : `${moving[0]?.x.toFixed(3)}, ${moving[0]?.y.toFixed(3)}`,
        sub: invalid ? v.errors[0] ?? "Размещение недопустимо" : undefined,
      });
      return;
    }
    if (drag.kind === "openingWidth") {
      const o = store.project.openings.find((x) => x.id === drag.id);
      if (!o) return;
      const L = wallLength(store.project, o.wallId);
      const along = o.wallId === "east" || o.wallId === "west" ? p.y : p.x;
      if (drag.edge === "end") {
        const w = Math.max(0.2, Math.min(L - o.offsetFromWallStartM, applySnap(along - o.offsetFromWallStartM)));
        const res = store.updateOpening(o.id, { widthM: w }, true);
        const live = useProjectStore.getState().liveResult();
        setBadge({
          x: e.clientX,
          y: e.clientY,
          text: `${w.toFixed(3)} m`,
          sub: res.ok
            ? `S=${(w * o.heightM).toFixed(3)} m² · SAFE ${live.capacity.safe ?? "—"}`
            : res.errors[0],
        });
      } else {
        const end = o.offsetFromWallStartM + o.widthM;
        const off = Math.max(0, Math.min(end - 0.2, applySnap(along)));
        const w = end - off;
        const res = store.updateOpening(o.id, { offsetFromWallStartM: off, widthM: w }, true);
        const live = useProjectStore.getState().liveResult();
        setBadge({
          x: e.clientX,
          y: e.clientY,
          text: `${w.toFixed(3)} m`,
          sub: res.ok ? `S=${(w * o.heightM).toFixed(3)} m² · SAFE ${live.capacity.safe ?? "—"}` : res.errors[0],
        });
      }
      return;
    }
  };

  const onPointerUp = (e?: React.PointerEvent) => {
    if (e) pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (marquee) {
      const x1 = Math.min(marquee.x1, marquee.x2);
      const x2 = Math.max(marquee.x1, marquee.x2);
      const y1 = Math.min(marquee.y1, marquee.y2);
      const y2 = Math.max(marquee.y1, marquee.y2);
      const ids = project.racks.filter((r) => {
        const b = rackAabb(r);
        return b.x1 >= x1 && b.y1 >= y1 && b.x2 <= x2 && b.y2 <= y2;
      }).map((r) => r.id);
      if (ids.length) store.select(ids);
      setMarquee(null);
    }
    const drag = dragRef.current;
    if (drag?.kind === "wall") {
      const startLen = drag.wall === "east" || drag.wall === "west" ? drag.ctx.startWidthM : drag.ctx.startDepthM;
      if (Math.abs(drag.lastLengthM - startLen) > 1e-9) {
        const res = store.resizeWall(drag.wall, drag.lastLengthM, false);
        if (!res.ok) {
          store.setPreview(null);
          setCam(drag.startCam);
        }
      } else {
        store.setPreview(null);
        setCam(drag.startCam);
      }
    } else if (drag?.kind === "opening" || drag?.kind === "openingWidth" || drag?.kind === "rack") {
      if (drag.kind === "rack" && collisionRef.current) {
        store.setPreview(null);
      } else {
        store.commitGeometryPreview(
          drag.kind === "opening" ? "Move opening" : drag.kind === "openingWidth" ? "Resize opening" : "Move rack",
        );
      }
    }
    collisionRef.current = false;
    beginDrag(null);
    setBadge(null);
    setGuides([]);
  };

  const commitDim = () => {
    if (!dimEdit) return;
    const v = validateRoomLengthInput(dimEdit.value);
    if (!v.ok) {
      setDimEdit({ ...dimEdit, error: v.reason });
      store.setPreview(null);
      setCam(dimEdit.startCam);
      return;
    }
    const res = store.resizeWall(dimEdit.wall, v.meters, false);
    if (!res.ok) {
      setDimEdit({ ...dimEdit, error: res.reason ?? "Некорректный размер." });
      setCam(dimEdit.startCam);
      return;
    }
    const newW = dimEdit.wall === "east" || dimEdit.wall === "west" ? v.meters : dimEdit.startWidthM;
    const newD = dimEdit.wall === "north" || dimEdit.wall === "south" ? v.meters : dimEdit.startDepthM;
    const shift = originShiftForResize(dimEdit.wall, dimEdit.startWidthM, dimEdit.startDepthM, newW, newD);
    setCam({ x: dimEdit.startCam.x + shift.dx, y: dimEdit.startCam.y + shift.dy, ppm: dimEdit.startCam.ppm });
    setDimEdit(null);
  };

  const cancelDim = () => {
    store.setPreview(null);
    setCam(dimEdit?.startCam ?? cam);
    setDimEdit(null);
  };

  const fit = () => {
    const ppm = Math.min((size.w - 96) / Math.max(project.room.widthM, 1), (size.h - 96) / Math.max(project.room.depthM, 1));
    setCam({ x: project.room.widthM / 2, y: project.room.depthM / 2, ppm: Math.max(12, Math.min(400, ppm || 20)) });
  };

  useEffect(() => {
    if (size.w < 40 || size.h < 40) return;
    const ppm = Math.min((size.w - 96) / Math.max(project.room.widthM, 1), (size.h - 96) / Math.max(project.room.depthM, 1));
    setCam({ x: project.room.widthM / 2, y: project.room.depthM / 2, ppm: Math.max(12, Math.min(400, ppm || 20)) });
  }, [size.w, size.h, project.id]);

  const gridStep = cam.ppm > 80 ? 0.1 : cam.ppm > 40 ? 0.5 : 1;
  const gridLines = useMemo(() => {
    if (!store.gridEnabled) return [] as Array<{ x1: number; y1: number; x2: number; y2: number; major: boolean }>;
    const lines = [];
    const pad = 2;
    const x0 = Math.floor(-pad / gridStep) * gridStep;
    const x1 = project.room.widthM + pad;
    const y0 = Math.floor(-pad / gridStep) * gridStep;
    const y1 = project.room.depthM + pad;
    for (let x = x0; x <= x1 + 1e-9; x = +(x + gridStep).toFixed(6)) {
      lines.push({ x1: x, y1: y0, x2: x, y2: y1, major: Math.abs(x % 1) < 1e-6 || Math.abs(x % 1 - 1) < 1e-6 });
    }
    for (let y = y0; y <= y1 + 1e-9; y = +(y + gridStep).toFixed(6)) {
      lines.push({ x1: x0, y1: y, x2: x1, y2: y, major: Math.abs(y % 1) < 1e-6 || Math.abs(y % 1 - 1) < 1e-6 });
    }
    return lines;
  }, [store.gridEnabled, gridStep, project.room.widthM, project.room.depthM]);

  const cursor =
    store.tool === "pan" || drag?.kind === "pan"
      ? "grab"
      : store.tool === "measure"
        ? "crosshair"
        : hover?.startsWith("wall-") || drag?.kind === "wall"
          ? wallCursor(
              drag?.kind === "wall" ? drag.wall : ((hover?.replace("wall-", "") ?? "east") as WallId),
            )
          : "default";

  const measureDist =
    store.measure.a && store.measure.b
      ? Math.hypot(store.measure.b.x - store.measure.a.x, store.measure.b.y - store.measure.a.y)
      : null;

  const preview = store.previewResult;
  const liveArea = result.geometry.floorAreaM2;

  return (
    <div
      ref={wrapRef}
      className="relative h-full min-h-0 w-full overflow-hidden bg-bg select-none"
      style={{ touchAction: "none", userSelect: "none" }}
      data-mf-id="cad"
      data-mf-cam-x={cam.x}
      data-mf-cam-y={cam.y}
      data-mf-cam-ppm={cam.ppm}
      data-mf-cursor={cursor}
      data-mf-drag={drag?.kind ?? ""}
      data-mf-drag-wall={drag?.kind === "wall" ? drag.wall : ""}
      data-mf-drag-len={drag?.kind === "wall" ? String(drag.lastLengthM) : ""}
    >
      <svg
        width={w}
        height={h}
        className="block h-full w-full overflow-hidden"
        style={{ cursor, overflow: "hidden" }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") onPointerUp(e);
        }}
        onDoubleClick={(e) => {
          const el = wrapRef.current;
          if (!el) return;
          const p = clientToWorld(el, cam, e.clientX, e.clientY);
          const wall = hitWall(p.x, p.y);
          if (wall) {
            const len = wall === "east" || wall === "west" ? project.room.widthM : project.room.depthM;
            setDimEdit({
              wall,
              value: len.toFixed(3),
              error: null,
              startCam: cam,
              startWidthM: store.project.room.widthM,
              startDepthM: store.project.room.depthM,
            });
          }
        }}
      >
        {gridLines.map((g, i) => {
          const a = toS(g.x1, g.y1);
          const b = toS(g.x2, g.y2);
          return (
            <line
              key={i}
              x1={a.sx}
              y1={a.sy}
              x2={b.sx}
              y2={b.sy}
              stroke={g.major ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)"}
              strokeWidth={1}
            />
          );
        })}

        {guides.map((g, i) => {
          const a = toS(g.x1, g.y1);
          const b = toS(g.x2, g.y2);
          return <line key={`g${i}`} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke="#5aa7c7" strokeDasharray="4 4" strokeWidth={1} />;
        })}

        {(() => {
          const a = toS(0, 0);
          const b = toS(project.room.widthM, project.room.depthM);
          const hit = 22;
          const west = toS(0, project.room.depthM / 2);
          const east = toS(project.room.widthM, project.room.depthM / 2);
          const south = toS(project.room.widthM / 2, 0);
          const north = toS(project.room.widthM / 2, project.room.depthM);
          const wallHits = [
            { id: "west" as const, x: west.sx - hit, y: Math.min(a.sy, b.sy) - hit, w: hit * 2, h: Math.abs(b.sy - a.sy) + hit * 2 },
            { id: "east" as const, x: east.sx - hit, y: Math.min(a.sy, b.sy) - hit, w: hit * 2, h: Math.abs(b.sy - a.sy) + hit * 2 },
            { id: "south" as const, x: Math.min(a.sx, b.sx) - hit, y: south.sy - hit, w: Math.abs(b.sx - a.sx) + hit * 2, h: hit * 2 },
            { id: "north" as const, x: Math.min(a.sx, b.sx) - hit, y: north.sy - hit, w: Math.abs(b.sx - a.sx) + hit * 2, h: hit * 2 },
          ];
          return (
            <>
              <rect
                x={Math.min(a.sx, b.sx)}
                y={Math.min(a.sy, b.sy)}
                width={Math.abs(b.sx - a.sx)}
                height={Math.abs(b.sy - a.sy)}
                fill="rgba(90,167,199,0.04)"
                stroke="#9aa8b8"
                strokeWidth={2}
              />
              {wallHits.map((wh) => (
                <rect
                  key={wh.id}
                  data-mf-id={`wall-hit-${wh.id}`}
                  data-mf-wall={wh.id}
                  x={wh.x}
                  y={wh.y}
                  width={wh.w}
                  height={wh.h}
                  fill="transparent"
                  style={{ cursor: wallCursor(wh.id) }}
                />
              ))}
            </>
          );
        })()}

        {(project.reality?.asBuilt ?? []).map((obj) => {
          const mode = project.reality?.compareMode ?? "as-designed";
          if (mode === "as-designed") return null;
          const a = toS(obj.x, obj.y);
          const b = toS(obj.x + obj.widthM, obj.y + obj.depthM);
          const x = Math.min(a.sx, b.sx);
          const y = Math.min(a.sy, b.sy);
          const ww = Math.abs(b.sx - a.sx);
          const hh = Math.abs(b.sy - a.sy);
          return (
            <g key={obj.id}>
              <rect
                x={x}
                y={y}
                width={ww}
                height={hh}
                fill="rgba(196,163,90,0.35)"
                stroke="#c4a35a"
                strokeDasharray={mode === "deviation" ? "4 3" : undefined}
                strokeWidth={mode === "as-built" ? 2 : 1}
              />
              <text x={x + 4} y={y + 12} fill="#c4a35a" fontSize={10} fontFamily="IBM Plex Mono, monospace">
                {obj.kind} · z {obj.z.toFixed(2)} · {obj.provenance}
              </text>
            </g>
          );
        })}

        {project.openings.map((o) => {
          const wr = openingWorldRect(project, o);
          const a = toS(wr.x1, wr.y1);
          const b = toS(wr.x2, wr.y2);
          const color = o.type === "INTAKE" ? "#5aa7c7" : o.type === "EXHAUST" || o.type === "SHAFT_CONNECTION" ? "#c47a52" : "#e8edf3";
          const selected = store.selectedIds.includes(o.id);
          const x = Math.min(a.sx, b.sx);
          const y = Math.min(a.sy, b.sy);
          const ww = Math.max(6, Math.abs(b.sx - a.sx));
          const hh = Math.max(6, Math.abs(b.sy - a.sy));
          const invalid = result.openings.items.find((i) => i.id === o.id)?.errors.length;
          const alongX = o.wallId === "south" || o.wallId === "north";
          return (
            <g key={o.id}>
              <rect
                x={x - 3}
                y={y - 3}
                width={ww + 6}
                height={hh + 6}
                fill={color}
                opacity={selected ? 0.9 : 0.75}
                stroke={invalid ? "#c45c5c" : selected ? "#e8edf3" : color}
                strokeWidth={selected ? 2 : 1}
              />
              {selected && (
                <>
                  <rect
                    x={alongX ? x - 4 : x + ww / 2 - 4}
                    y={alongX ? y + hh / 2 - 4 : y - 4}
                    width={8}
                    height={8}
                    fill="#e8edf3"
                  />
                  <rect
                    x={alongX ? x + ww - 4 : x + ww / 2 - 4}
                    y={alongX ? y + hh / 2 - 4 : y + hh - 4}
                    width={8}
                    height={8}
                    fill="#e8edf3"
                  />
                </>
              )}
            </g>
          );
        })}

        {project.racks.map((r) => {
          const bb = rackAabb(r);
          const a = toS(bb.x1, bb.y1);
          const b = toS(bb.x2, bb.y2);
          const selected = store.selectedIds.includes(r.id);
          const collide = result.racks.collisions.some((c) => c.a === r.id || c.b === r.id) || result.racks.wallHits.some((c) => c.id === r.id);
          const x = Math.min(a.sx, b.sx);
          const y = Math.min(a.sy, b.sy);
          const ww = Math.abs(b.sx - a.sx);
          const hh = Math.abs(b.sy - a.sy);
          const intake =
            r.airflowToward === "south"
              ? { x: x, y: y + hh - 4, w: ww, h: 4 }
              : r.airflowToward === "north"
                ? { x: x, y: y, w: ww, h: 4 }
                : r.airflowToward === "west"
                  ? { x: x, y: y, w: 4, h: hh }
                  : { x: x + ww - 4, y: y, w: 4, h: hh };
          return (
            <g key={r.id}>
              <rect
                x={x}
                y={y}
                width={ww}
                height={hh}
                fill={collide ? "rgba(196,92,92,0.35)" : "rgba(29,36,45,0.95)"}
                stroke={collide ? "#c45c5c" : selected ? "#e8edf3" : "#3a4656"}
                strokeWidth={selected ? 2 : 1}
              />
              <rect x={intake.x} y={intake.y} width={intake.w} height={intake.h} fill="#5aa7c7" />
              <text x={x + ww / 2} y={y + hh / 2} fill="#8b97a8" fontSize={11} textAnchor="middle" dominantBaseline="middle">
                {r.name}
              </text>
            </g>
          );
        })}

        {placeHint && store.tool === "rack" &&
          (() => {
            const a = toS(placeHint.x, placeHint.y);
            const b = toS(placeHint.x + TEST_RACK_A.widthM, placeHint.y + TEST_RACK_A.depthM);
            const x = Math.min(a.sx, b.sx);
            const y = Math.min(a.sy, b.sy);
            const ww = Math.abs(b.sx - a.sx);
            const hh = Math.abs(b.sy - a.sy);
            return (
              <rect
                data-mf-place-preview={placeHint.ok ? "ok" : "invalid"}
                x={x}
                y={y}
                width={ww}
                height={hh}
                fill={placeHint.ok ? "rgba(90,167,199,0.18)" : "rgba(196,92,92,0.28)"}
                stroke={placeHint.ok ? "#5aa7c7" : "#c45c5c"}
                strokeDasharray="5 3"
                strokeWidth={1.5}
              />
            );
          })()}

        {project.fans.map((f) => {
          const a = toS(f.x, f.y);
          return <circle key={f.id} cx={a.sx} cy={a.sy} r={10} fill="#7b8ca3" stroke="#e8edf3" strokeWidth={1} />;
        })}

        {store.measure.a &&
          (() => {
            const a = toS(store.measure.a.x, store.measure.a.y);
            const bpt = store.measure.b ?? null;
            return (
              <g>
                <circle cx={a.sx} cy={a.sy} r={4} fill="#c4a35a" />
                {bpt &&
                  (() => {
                    const b = toS(bpt.x, bpt.y);
                    return (
                      <>
                        <line x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} stroke="#c4a35a" strokeWidth={1.5} />
                        <circle cx={b.sx} cy={b.sy} r={4} fill="#c4a35a" />
                        <text x={(a.sx + b.sx) / 2} y={(a.sy + b.sy) / 2 - 8} fill="#c4a35a" fontSize={12} textAnchor="middle" fontFamily="IBM Plex Mono, monospace">
                          {measureDist != null ? `${measureDist.toFixed(3)} m` : ""}
                        </text>
                      </>
                    );
                  })()}
              </g>
            );
          })()}

        {marquee &&
          (() => {
            const a = toS(marquee.x1, marquee.y1);
            const b = toS(marquee.x2, marquee.y2);
            return (
              <rect
                x={Math.min(a.sx, b.sx)}
                y={Math.min(a.sy, b.sy)}
                width={Math.abs(b.sx - a.sx)}
                height={Math.abs(b.sy - a.sy)}
                fill="rgba(154,168,184,0.08)"
                stroke="#9aa8b8"
                strokeDasharray="4 3"
              />
            );
          })()}
      </svg>

      {walls.map((wall) => {
        const a = toS((wall.x1 + wall.x2) / 2, (wall.y1 + wall.y2) / 2);
        const contract = wallResizeContract(wall.id);
        const label = contract.dim === "widthM" ? project.room.widthM : project.room.depthM;
        const ox = wall.id === "west" ? -44 : wall.id === "east" ? 44 : 0;
        const oy = wall.id === "south" ? -16 : wall.id === "north" ? -14 : 4;
        return (
          <button
            key={`dimbtn-${wall.id}`}
            type="button"
            data-mf-id={`dim-${wall.id}`}
            className="absolute z-10 flex h-11 min-w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[8px] font-mono text-[11px] text-fg"
            style={{ left: a.sx + ox, top: a.sy + oy }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() =>
              setDimEdit({
                wall: wall.id,
                value: label.toFixed(3),
                error: null,
                startCam: cam,
                startWidthM: store.project.room.widthM,
                startDepthM: store.project.room.depthM,
              })
            }
          >
            {formatMeters(label)}
          </button>
        );
      })}

      {dimEdit && (
        <form
          className="absolute left-1/2 top-16 z-20 w-[min(20rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-[10px] border border-border bg-panel p-2 shadow-panel"
          onSubmit={(e) => {
            e.preventDefault();
            commitDim();
          }}
        >
          <div className="mb-1 px-1 text-[11px] leading-snug text-muted" data-mf-id="dim-contract">
            {wallResizeContract(dimEdit.wall).labelRu}
          </div>
          <input
            autoFocus
            data-mf-id="dim-input"
            className="h-11 w-full rounded-[6px] border border-border bg-bg px-2 font-mono text-[13px] text-fg outline-none"
            value={dimEdit.value}
            onChange={(e) => {
              const value = e.target.value;
              const v = validateRoomLengthInput(value);
              setDimEdit({ ...dimEdit, value, error: v.ok ? null : v.reason });
              if (v.ok) {
                store.resizeWall(dimEdit.wall, v.meters, true);
                const newW = dimEdit.wall === "east" || dimEdit.wall === "west" ? v.meters : dimEdit.startWidthM;
                const newD = dimEdit.wall === "north" || dimEdit.wall === "south" ? v.meters : dimEdit.startDepthM;
                const shift = originShiftForResize(dimEdit.wall, dimEdit.startWidthM, dimEdit.startDepthM, newW, newD);
                setCam({ x: dimEdit.startCam.x + shift.dx, y: dimEdit.startCam.y + shift.dy, ppm: dimEdit.startCam.ppm });
              } else {
                store.setPreview(null);
                setCam(dimEdit.startCam);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancelDim();
            }}
          />
          {dimEdit.error && (
            <div className="mt-1 px-1 text-[12px] text-crit" data-mf-id="dim-error">
              {dimEdit.error}
            </div>
          )}
          <div className="mt-1 flex gap-1">
            <button type="submit" className="h-11 min-w-11 flex-1 rounded-[6px] bg-raised text-[12px]" data-mf-id="dim-ok">
              OK
            </button>
            <button
              type="button"
              className="h-11 min-w-11 rounded-[6px] border border-border px-3 text-[12px]"
              data-mf-id="dim-cancel"
              onClick={cancelDim}
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      {placeHint && !placeHint.ok && store.tool === "rack" && (
        <div
          data-mf-id="place-error"
          className="absolute bottom-14 left-1/2 z-20 max-w-[min(20rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-[8px] border border-crit/40 bg-panel px-3 py-2 text-center text-[12px] text-crit"
        >
          {placeHint.reason ?? "Размещение недопустимо"}
        </div>
      )}

      {badge && (
        <div
          className="pointer-events-none absolute z-20 rounded-[8px] border border-border bg-panel px-2 py-1 text-[12px]"
          style={{ left: badge.x + 14, top: badge.y + 14 }}
        >
          <div className="font-mono tabular text-fg">{badge.text}</div>
          {badge.sub && <div className="text-[11px] text-muted">{badge.sub}</div>}
          {preview && drag?.kind === "opening" && (
            <div className="mt-0.5 font-mono text-[11px] text-cold">
              SAFE {preview.capacity.safe ?? "—"} · {preview.thermal.designAirflowM3h.toFixed(0)} m³/h
            </div>
          )}
        </div>
      )}

      <div className="pointer-events-none absolute left-3 top-3 rounded-[8px] border border-border bg-panel/90 px-2 py-1 font-mono text-[11px] text-muted">
        {project.room.widthM.toFixed(3)} × {project.room.depthM.toFixed(3)} × {project.room.heightM.toFixed(3)} m · {liveArea.toFixed(3)} m²
        {store.preview ? " · LIVE PREVIEW" : ""}
      </div>

      {store.lastMutationError && (
        <div
          data-mf-id="mutation-error"
          className="absolute bottom-14 left-1/2 z-20 max-w-[min(22rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-[8px] border border-crit/40 bg-panel px-3 py-2 text-center text-[12px] text-crit"
        >
          {store.lastMutationError}
        </div>
      )}

      <div className="absolute bottom-3 left-3 hidden gap-1 md:flex">
        <button type="button" className="h-8 rounded-[6px] border border-border bg-panel px-2 text-[12px] text-fg" onClick={fit}>
          Zoom fit
        </button>
        <button
          type="button"
          className="h-8 rounded-[6px] border border-border bg-panel px-2 text-[12px] text-fg"
          onClick={() => store.toggleGrid()}
        >
          Grid {store.gridEnabled ? "on" : "off"}
        </button>
        <button
          type="button"
          className="h-8 rounded-[6px] border border-border bg-panel px-2 text-[12px] text-fg"
          onClick={() => store.toggleSnap()}
        >
          Snap {store.snapEnabled ? store.snapMode : "off"}
        </button>
      </div>
    </div>
  );
}
