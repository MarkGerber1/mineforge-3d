import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { DoubleSide, Plane, Raycaster, Vector2, Vector3, type Object3D } from "three";
import { useLiveProject, useLiveResult, useProjectStore } from "@/project/store";
import { openingWorldRect, rackAabb } from "@/engineering/geometry";
import { panelWorldBox, segmentAllWalls } from "@/engineering/apertures";
import type { Project, WallId } from "@/engineering/types";

function orbitLocked(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { __MF_TWIN_LOCK_ORBIT__?: boolean; __MF_TWIN_CAMERA__?: string };
  return Boolean(w.__MF_TWIN_LOCK_ORBIT__) || w.__MF_TWIN_CAMERA__ === "top";
}

function topCamera(): boolean {
  if (typeof window === "undefined") return false;
  return (window as unknown as { __MF_TWIN_CAMERA__?: string }).__MF_TWIN_CAMERA__ === "top";
}

type TwinScreenMap = {
  ready: boolean;
  objects: Record<string, { x: number; y: number; visible: boolean }>;
};

/** READ-ONLY projection hook for E2E. Does not mutate Project. */
function TwinScreenProbe({ project }: { project: Project }) {
  const { camera, gl } = useThree();
  const v = useMemo(() => new Vector3(), []);
  useFrame(() => {
    if (typeof window === "undefined") return;
    const rect = gl.domElement.getBoundingClientRect();
    const objects: TwinScreenMap["objects"] = {};
    const put = (id: string, x: number, y: number, z: number) => {
      v.set(x, y, z).project(camera);
      const sx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      objects[id] = {
        x: sx,
        y: sy,
        visible: v.z >= -1 && v.z <= 1 && v.x >= -0.95 && v.x <= 0.95 && v.y >= -0.95 && v.y <= 0.95,
      };
    };
    for (const r of project.racks) {
      const bb = rackAabb(r);
      put(r.id, (bb.x1 + bb.x2) / 2, r.heightM / 2, (bb.y1 + bb.y2) / 2);
    }
    for (const f of project.fans) {
      put(f.id, f.x + 0.4, 0.4, f.y + 0.4);
    }
    for (const o of project.openings) {
      const wr = openingWorldRect(project, o);
      put(o.id, (wr.x1 + wr.x2) / 2, (wr.z1 + wr.z2) / 2, (wr.y1 + wr.y2) / 2);
    }
    (window as unknown as { __MF_TWIN_SCREEN__: TwinScreenMap }).__MF_TWIN_SCREEN__ = {
      ready: Object.keys(objects).length > 0,
      objects,
    };
  });
  return null;
}

function TwinCameraRig({ project }: { project: Project }) {
  const { camera } = useThree();
  useFrame(() => {
    if (!topCamera()) return;
    const w = project.room.widthM;
    const d = project.room.depthM;
    camera.position.set(w / 2, Math.max(16, project.room.heightM * 6), d / 2);
    camera.up.set(0, 0, -1);
    camera.lookAt(w / 2, 0, d / 2);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
  });
  return null;
}

type TwinDrag =
  | { kind: "rack"; id: string; grabX: number; grabZ: number; startX: number; startY: number }
  | { kind: "fan"; id: string; grabX: number; grabZ: number; startX: number; startY: number }
  | { kind: "opening"; id: string; grabAlong: number; startOff: number; wall: Project["openings"][number]["wallId"] };

function alongOf(hit: { x: number; z: number }, wall: WallId): number {
  if (wall === "south" || wall === "north") return hit.x;
  return hit.z;
}

function RoomShell({ project }: { project: Project }) {
  const w = project.room.widthM;
  const d = project.room.depthM;
  const t = 0.08;
  const panels = segmentAllWalls(project);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, 0, d / 2]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#24303c" roughness={0.85} />
      </mesh>
      {panels.map((panel, i) => {
        const box = panelWorldBox(project, panel, t);
        return (
          <mesh key={`${panel.wallId}-${i}`} position={box.position} castShadow>
            <boxGeometry args={box.size} />
            <meshStandardMaterial color="#3a4656" transparent opacity={0.82} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Physical ceiling plane at y = room.heightM. Hide is visual only. */
function Ceiling({ project, visible }: { project: Project; visible: boolean }) {
  const w = project.room.widthM;
  const d = project.room.depthM;
  const h = project.room.heightM;
  if (!visible) return null;
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} position={[w / 2, h, d / 2]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial
        color="#1a222c"
        transparent
        opacity={0.55}
        side={DoubleSide}
        roughness={0.9}
        metalness={0.05}
      />
    </mesh>
  );
}

function Openings({ project }: { project: Project }) {
  const selectedIds = useProjectStore((s) => s.selectedIds);
  return (
    <group>
      {project.openings.map((o) => {
        const r = openingWorldRect(project, o);
        const cx = (r.x1 + r.x2) / 2;
        const cz = (r.y1 + r.y2) / 2;
        const cy = (r.z1 + r.z2) / 2;
        const alongX = Math.abs(r.x2 - r.x1);
        const alongZ = Math.abs(r.y2 - r.y1);
        const color = o.type === "INTAKE" ? "#5aa7c7" : o.type === "EXHAUST" || o.type === "SHAFT_CONNECTION" ? "#c47a52" : "#d9dee6";
        const selected = selectedIds.includes(o.id);
        const jamb = 0.04;
        const isNS = o.wallId === "south" || o.wallId === "north";
        const depth = 0.1;
        const posts = isNS
          ? [
              { pos: [r.x1, cy, cz] as [number, number, number], size: [jamb, o.heightM, depth] as [number, number, number] },
              { pos: [r.x2, cy, cz] as [number, number, number], size: [jamb, o.heightM, depth] as [number, number, number] },
              { pos: [cx, r.z2, cz] as [number, number, number], size: [Math.max(alongX, jamb), jamb, depth] as [number, number, number] },
              ...(o.bottomElevationM > 1e-6
                ? [{ pos: [cx, r.z1, cz] as [number, number, number], size: [Math.max(alongX, jamb), jamb, depth] as [number, number, number] }]
                : []),
            ]
          : [
              { pos: [cx, cy, r.y1] as [number, number, number], size: [depth, o.heightM, jamb] as [number, number, number] },
              { pos: [cx, cy, r.y2] as [number, number, number], size: [depth, o.heightM, jamb] as [number, number, number] },
              { pos: [cx, r.z2, cz] as [number, number, number], size: [depth, jamb, Math.max(alongZ, jamb)] as [number, number, number] },
              ...(o.bottomElevationM > 1e-6
                ? [{ pos: [cx, r.z1, cz] as [number, number, number], size: [depth, jamb, Math.max(alongZ, jamb)] as [number, number, number] }]
                : []),
            ];
        return (
          <group key={o.id}>
            <mesh
              userData={{ mfId: o.id, mfKind: "opening" }}
              position={[cx, cy, cz]}
            >
              <boxGeometry args={isNS ? [Math.max(alongX, 0.35), Math.max(o.heightM, 0.4), 0.35] : [0.35, Math.max(o.heightM, 0.4), Math.max(alongZ, 0.35)]} />
              <meshBasicMaterial transparent opacity={0.001} depthWrite={false} />
            </mesh>
            {posts.map((p, i) => (
              <mesh key={i} position={p.pos} userData={{ mfId: o.id, mfKind: "opening" }}>
                <boxGeometry args={p.size} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 0.4 : 0.15} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

function Racks({ project }: { project: Project }) {
  const xray = useProjectStore((s) => s.xray);
  const selected = useProjectStore((s) => s.selectedIds);
  const result = useLiveResult();
  return (
    <group>
      {project.racks.map((r) => {
        const bb = rackAabb(r);
        const cx = (bb.x1 + bb.x2) / 2;
        const cz = (bb.y1 + bb.y2) / 2;
        const ww = bb.x2 - bb.x1;
        const dd = bb.y2 - bb.y1;
        const warn =
          result.racks.collisions.some((c) => c.a === r.id || c.b === r.id) ||
          result.racks.asBuiltHits.some((h) => h.id === r.id) ||
          result.racks.ceilingHits.some((h) => h.id === r.id);
        const isSel = selected.includes(r.id);
        const cold =
          r.airflowToward === "south"
            ? ([cx, 0.15, bb.y1 - 0.15] as const)
            : r.airflowToward === "north"
              ? ([cx, 0.15, bb.y2 + 0.15] as const)
              : r.airflowToward === "west"
                ? ([bb.x1 - 0.15, 0.15, cz] as const)
                : ([bb.x2 + 0.15, 0.15, cz] as const);
        const hot =
          r.airflowToward === "south"
            ? ([cx, 0.15, bb.y2 + 0.15] as const)
            : r.airflowToward === "north"
              ? ([cx, 0.15, bb.y1 - 0.15] as const)
              : r.airflowToward === "west"
                ? ([bb.x2 + 0.15, 0.15, cz] as const)
                : ([bb.x1 - 0.15, 0.15, cz] as const);
        return (
          <group key={r.id}>
            <mesh position={[cx, r.heightM / 2, cz]} castShadow userData={{ mfId: r.id, mfKind: "rack" }}>
              <boxGeometry args={[ww, r.heightM, dd]} />
              <meshStandardMaterial
                color={warn && xray.warnings ? "#c45c5c" : isSel ? "#c5ced8" : "#5a6878"}
                roughness={0.6}
              />
            </mesh>
            {Array.from({ length: Math.min(r.asicCount, 24) }).map((_, i) => {
              const col = i % 6;
              const shelf = Math.floor(i / 6);
              return (
                <mesh
                  key={i}
                  position={[bb.x1 + 0.15 + col * 0.24, 0.25 + shelf * 0.45, cz]}
                  castShadow
                >
                  <boxGeometry args={[0.2, 0.28, Math.min(0.45, dd * 0.7)]} />
                  <meshStandardMaterial color="#5d6a7a" />
                </mesh>
              );
            })}
            {xray.airflow && (
              <>
                <mesh position={[cold[0], 1.1, cold[2]]}>
                  <coneGeometry args={[0.08, 0.28, 8]} />
                  <meshStandardMaterial color="#5aa7c7" emissive="#5aa7c7" emissiveIntensity={0.4} />
                </mesh>
                <mesh position={[hot[0], 1.1, hot[2]]}>
                  <coneGeometry args={[0.08, 0.28, 8]} />
                  <meshStandardMaterial color="#c47a52" emissive="#c47a52" emissiveIntensity={0.4} />
                </mesh>
              </>
            )}
            {xray.electrical && (
              <mesh position={[cx, r.heightM + 0.12, cz]}>
                <boxGeometry args={[0.4, 0.06, 0.2]} />
                <meshStandardMaterial color="#7b8ca3" emissive="#7b8ca3" emissiveIntensity={0.3} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

function Shaft({ project }: { project: Project }) {
  const exhaust = project.openings.find((o) => o.type === "EXHAUST" || o.type === "SHAFT_CONNECTION");
  const shaft = project.ventilation.components.find((c) => c.kind === "duct" && c.lengthM >= 10);
  if (!exhaust || !shaft) return null;
  const r = openingWorldRect(project, exhaust);
  const cx = (r.x1 + r.x2) / 2;
  const cz = (r.y1 + r.y2) / 2;
  const ww = shaft.widthM ?? exhaust.widthM;
  const hh = shaft.heightM ?? exhaust.heightM;
  const len = Math.min(Math.max(shaft.lengthM, 2), 6);
  return (
    <mesh position={[cx, project.room.heightM + len / 2, cz]}>
      <boxGeometry args={[ww, len, hh]} />
      <meshStandardMaterial color="#c47a52" transparent opacity={0.45} />
    </mesh>
  );
}

function Fans({ project }: { project: Project }) {
  const selectedIds = useProjectStore((s) => s.selectedIds);
  return (
    <group>
      {project.fans.map((f) => {
        const sel = selectedIds.includes(f.id);
        return (
          <group key={f.id}>
            <mesh position={[f.x + 0.4, 0.4, f.y + 0.4]} userData={{ mfId: f.id, mfKind: "fan" }}>
              <boxGeometry args={[0.9, 0.9, 0.9]} />
              <meshBasicMaterial transparent opacity={0.001} depthWrite={false} />
            </mesh>
            <mesh
              position={[f.x, 0.4, f.y]}
              rotation={[Math.PI / 2, 0, 0]}
              userData={{ mfId: f.id, mfKind: "fan" }}
            >
              <cylinderGeometry args={[0.28, 0.28, 0.18, 16]} />
              <meshStandardMaterial
                color={sel ? "#c5ced8" : "#7b8ca3"}
                metalness={0.4}
                roughness={0.4}
                emissive={sel ? "#5aa7c7" : "#000000"}
                emissiveIntensity={sel ? 0.35 : 0}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Board({ project }: { project: Project }) {
  return (
    <mesh position={[0.2, 1.2, project.room.depthM / 2]}>
      <boxGeometry args={[0.15, 1.6, 0.8]} />
      <meshStandardMaterial color="#1d242d" />
    </mesh>
  );
}

function TempEstimate({ project }: { project: Project }) {
  const xray = useProjectStore((s) => s.xray);
  const result = useLiveResult();
  if (!xray.temperature) return null;
  const tIn = project.thermal.intakeTempC;
  const tOut = tIn + project.thermal.deltaTK;
  return (
    <group>
      <mesh position={[project.room.widthM * 0.25, 1.4, project.room.depthM * 0.3]}>
        <sphereGeometry args={[0.18, 12, 12]} />
        <meshStandardMaterial color="#5aa7c7" transparent opacity={0.35} />
      </mesh>
      <mesh position={[project.room.widthM * 0.7, 1.4, project.room.depthM * 0.7]}>
        <sphereGeometry args={[0.22, 12, 12]} />
        <meshStandardMaterial color="#c47a52" transparent opacity={0.4} />
      </mesh>
      <group position={[project.room.widthM / 2, 0.02, project.room.depthM / 2]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <planeGeometry args={[1.6, 0.3]} />
          <meshBasicMaterial color="#c4a35a" transparent opacity={0.35} />
        </mesh>
      </group>
      {void tOut}
      {void result}
    </group>
  );
}

function clientOf(e: Event): { x: number; y: number } | null {
  if ("clientX" in e && typeof (e as PointerEvent).clientX === "number") {
    const p = e as PointerEvent;
    if (Number.isFinite(p.clientX) && Number.isFinite(p.clientY)) return { x: p.clientX, y: p.clientY };
  }
  const t = (e as TouchEvent).touches?.[0] ?? (e as TouchEvent).changedTouches?.[0];
  if (t) return { x: t.clientX, y: t.clientY };
  return null;
}

/**
 * Native canvas pointer bridge. R3F's event manager does not receive
 * Playwright / WebKit synthetic hits reliably; this path uses clientX/Y
 * on the WebGL canvas and is the mutation source for 3D drag.
 */
function TwinPointerBridge({
  project,
  dragRef,
  setDragging,
}: {
  project: Project;
  dragRef: MutableRefObject<TwinDrag | null>;
  setDragging: (v: boolean) => void;
}) {
  const { camera, gl, scene } = useThree();
  const projectRef = useRef(project);
  projectRef.current = project;
  const raycaster = useMemo(() => new Raycaster(), []);
  const ndc = useMemo(() => new Vector2(), []);
  const floorPlane = useMemo(() => new Plane(new Vector3(0, 1, 0), 0), []);
  const hitPoint = useMemo(() => new Vector3(), []);

  useEffect(() => {
    const el = gl.domElement;
    el.style.touchAction = "none";
    el.setAttribute("data-mf-id", "twin-canvas");

    const toNdc = (pt: { x: number; y: number }) => {
      const rect = el.getBoundingClientRect();
      if (!(rect.width > 1) || !(rect.height > 1)) return false;
      ndc.set(((pt.x - rect.left) / rect.width) * 2 - 1, -((pt.y - rect.top) / rect.height) * 2 + 1);
      camera.updateMatrixWorld();
      return true;
    };

    const floorHit = (pt: { x: number; y: number }) => {
      if (!toNdc(pt)) return null;
      raycaster.setFromCamera(ndc, camera);
      const ok = raycaster.ray.intersectPlane(floorPlane, hitPoint);
      if (!ok) return null;
      return { x: hitPoint.x, z: hitPoint.z };
    };

    const pick = (pt: { x: number; y: number }) => {
      if (!toNdc(pt)) return null;
      raycaster.setFromCamera(ndc, camera);
      const targets: Object3D[] = [];
      scene.traverse((obj) => {
        if (obj.userData?.mfId && obj.userData?.mfKind) targets.push(obj);
      });
      const hits = raycaster.intersectObjects(targets, false);
      const first = hits.find((h) => h.object.userData?.mfId);
      if (!first) return null;
      return { id: String(first.object.userData.mfId), kind: String(first.object.userData.mfKind) };
    };

    const onMoveDrag = (d: TwinDrag, floor: { x: number; z: number }) => {
      const store = useProjectStore.getState();
      const src = store.project;
      if (d.kind === "rack") {
        store.moveRack(d.id, floor.x - d.grabX, floor.z - d.grabZ, true);
      } else if (d.kind === "fan") {
        store.moveFan(d.id, floor.x - d.grabX, floor.z - d.grabZ, true);
      } else {
        const along = alongOf(floor, d.wall);
        const nextOff = d.startOff + (along - d.grabAlong);
        const nextOpenings = src.openings.map((o) => (o.id === d.id ? { ...o, offsetFromWallStartM: nextOff } : o));
        store.setPreview({ ...src, openings: nextOpenings });
      }
    };

    const commitDrag = () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      setDragging(false);
      const store = useProjectStore.getState();
      if (d.kind === "rack") {
        const live = store.preview ?? store.project;
        const rack = live.racks.find((r) => r.id === d.id);
        store.setPreview(null);
        if (!rack) return;
        const res = store.moveRack(d.id, rack.x, rack.y, false);
        if (!res.ok) {
          useProjectStore.setState({ lastMutationError: res.errors[0] ?? "Перемещение стойки отклонено." });
        }
        return;
      }
      if (d.kind === "fan") {
        const live = store.preview ?? store.project;
        const fan = live.fans.find((f) => f.id === d.id);
        store.setPreview(null);
        if (!fan) return;
        const res = store.moveFan(d.id, fan.x, fan.y, false);
        if (!res.ok) {
          useProjectStore.setState({ lastMutationError: res.errors[0] ?? "Перемещение вентилятора отклонено." });
        }
        return;
      }
      const live = store.preview ?? store.project;
      const opening = live.openings.find((o) => o.id === d.id);
      store.setPreview(null);
      if (!opening) return;
      const res = store.updateOpening(d.id, { offsetFromWallStartM: opening.offsetFromWallStartM }, false);
      if (!res.ok) {
        useProjectStore.setState({ lastMutationError: res.errors[0] ?? "Перемещение проёма отклонено." });
      }
    };

    const cancelDrag = () => {
      if (!dragRef.current) {
        const store = useProjectStore.getState();
        if (store.preview) store.setPreview(null);
        setDragging(false);
        return;
      }
      dragRef.current = null;
      setDragging(false);
      useProjectStore.getState().setPreview(null);
    };

    let finished = false;
    const finishCommit = () => {
      if (finished) return;
      if (!dragRef.current) return;
      finished = true;
      commitDrag();
    };
    const finishCancel = () => {
      if (finished) return;
      finished = true;
      cancelDrag();
    };

    const onDown = (e: Event) => {
      const pt = clientOf(e);
      if (!pt) return;
      if ("button" in e && (e as PointerEvent).button != null && (e as PointerEvent).button !== 0) return;
      const hit = pick(pt);
      if (!hit) return;
      finished = false;
      const floor = floorHit(pt);
      const src = projectRef.current;
      useProjectStore.getState().select([hit.id]);
      if (hit.kind === "rack") {
        const rack = src.racks.find((r) => r.id === hit.id);
        if (!rack) return;
        const bb = rackAabb(rack);
        const cx = (bb.x1 + bb.x2) / 2;
        const cz = (bb.y1 + bb.y2) / 2;
        dragRef.current = {
          kind: "rack",
          id: hit.id,
          grabX: (floor?.x ?? cx) - rack.x,
          grabZ: (floor?.z ?? cz) - rack.y,
          startX: rack.x,
          startY: rack.y,
        };
      } else if (hit.kind === "fan") {
        const fan = src.fans.find((f) => f.id === hit.id);
        if (!fan) return;
        dragRef.current = {
          kind: "fan",
          id: hit.id,
          grabX: (floor?.x ?? fan.x) - fan.x,
          grabZ: (floor?.z ?? fan.y) - fan.y,
          startX: fan.x,
          startY: fan.y,
        };
      } else {
        const opening = src.openings.find((o) => o.id === hit.id);
        if (!opening) return;
        const along = floor ? alongOf(floor, opening.wallId) : opening.offsetFromWallStartM;
        dragRef.current = {
          kind: "opening",
          id: hit.id,
          grabAlong: along,
          startOff: opening.offsetFromWallStartM,
          wall: opening.wallId,
        };
      }
      setDragging(true);
      try {
        if ("pointerId" in e) el.setPointerCapture((e as PointerEvent).pointerId);
      } catch {
        /* WebKit may refuse capture on synthetic events */
      }
      e.preventDefault();
      e.stopPropagation();
      if (typeof (e as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation === "function") {
        (e as Event).stopImmediatePropagation();
      }
    };

    const onMove = (e: Event) => {
      const d = dragRef.current;
      if (!d) return;
      const pt = clientOf(e);
      if (!pt) return;
      const floor = floorHit(pt);
      if (!floor) return;
      onMoveDrag(d, floor);
      e.preventDefault();
      e.stopPropagation();
    };

    const onUp = (e: Event) => {
      if (!dragRef.current) return;
      finishCommit();
      e.preventDefault();
      e.stopPropagation();
    };

    const onCancel = (e: Event) => {
      if (!dragRef.current) return;
      finishCancel();
      e.preventDefault();
      e.stopPropagation();
    };

    const onLostCapture = () => {
      if (!dragRef.current || finished) return;
      finishCancel();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!dragRef.current) return;
      finishCancel();
      e.preventDefault();
    };

    const opts: AddEventListenerOptions = { capture: true, passive: false };
    el.addEventListener("pointerdown", onDown, opts);
    el.addEventListener("mousedown", onDown, opts);
    el.addEventListener("touchstart", onDown, opts);
    window.addEventListener("pointermove", onMove, opts);
    window.addEventListener("mousemove", onMove, opts);
    window.addEventListener("touchmove", onMove, opts);
    window.addEventListener("pointerup", onUp, opts);
    window.addEventListener("mouseup", onUp, opts);
    window.addEventListener("touchend", onUp, opts);
    window.addEventListener("pointercancel", onCancel, opts);
    window.addEventListener("touchcancel", onCancel, opts);
    el.addEventListener("lostpointercapture", onLostCapture, opts);
    window.addEventListener("keydown", onKey, opts);
    return () => {
      el.removeEventListener("pointerdown", onDown, opts);
      el.removeEventListener("mousedown", onDown, opts);
      el.removeEventListener("touchstart", onDown, opts);
      window.removeEventListener("pointermove", onMove, opts);
      window.removeEventListener("mousemove", onMove, opts);
      window.removeEventListener("touchmove", onMove, opts);
      window.removeEventListener("pointerup", onUp, opts);
      window.removeEventListener("mouseup", onUp, opts);
      window.removeEventListener("touchend", onUp, opts);
      window.removeEventListener("pointercancel", onCancel, opts);
      window.removeEventListener("touchcancel", onCancel, opts);
      el.removeEventListener("lostpointercapture", onLostCapture, opts);
      window.removeEventListener("keydown", onKey, opts);
    };
  }, [camera, gl, scene, dragRef, setDragging, raycaster, ndc, floorPlane, hitPoint]);

  return null;
}

function DragScene({
  project,
  dragRef,
  setDragging,
}: {
  project: Project;
  dragRef: MutableRefObject<TwinDrag | null>;
  setDragging: (v: boolean) => void;
}) {
  return (
    <group>
      <TwinPointerBridge project={project} dragRef={dragRef} setDragging={setDragging} />
      <RoomShell project={project} />
      <Openings project={project} />
      <Racks project={project} />
      <Fans project={project} />
    </group>
  );
}

export function Twin3D() {
  const project = useLiveProject();
  const store = useProjectStore();
  const [mounted, setMounted] = useState(false);
  const [showCeiling, setShowCeiling] = useState(true);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<TwinDrag | null>(null);
  useEffect(() => setMounted(true), []);
  const camPos = useMemo(() => {
    if (topCamera()) {
      return [project.room.widthM / 2, Math.max(16, project.room.heightM * 6), project.room.depthM / 2] as [
        number,
        number,
        number,
      ];
    }
    const span = Math.max(project.room.widthM, project.room.depthM, 6);
    return [project.room.widthM * 0.55 + span * 0.7, Math.max(project.room.heightM * 2.6, 7), project.room.depthM * 0.45 + span * 0.85] as [
      number,
      number,
      number,
    ];
  }, [project.room.widthM, project.room.heightM, project.room.depthM]);

  if (!mounted) {
    return <div className="flex h-full items-center justify-center bg-bg text-[12px] text-muted">Digital Twin…</div>;
  }

  const selectedRack = project.racks.some((r) => store.selectedIds.includes(r.id));
  const lockCam = orbitLocked();

  return (
    <div className="relative h-full w-full bg-bg" data-mf-id="twin" style={{ touchAction: "none" }}>
      <Canvas
        shadows
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.domElement.setAttribute("data-mf-id", "twin-canvas");
          gl.domElement.style.touchAction = "none";
        }}
      >
        <color attach="background" args={["#0b0d10"]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[10, 14, 8]} intensity={1.35} castShadow />
        <PerspectiveCamera makeDefault position={camPos} fov={topCamera() ? 48 : 42} />
        <TwinCameraRig project={project} />
        {!lockCam && (
          <OrbitControls
            makeDefault
            enabled={!dragging}
            target={[project.room.widthM / 2, project.room.heightM * 0.45, project.room.depthM / 2]}
            enableDamping
          />
        )}
        <Grid
          position={[project.room.widthM / 2, 0, project.room.depthM / 2]}
          args={[Math.max(20, project.room.widthM * 2), Math.max(20, project.room.depthM * 2)]}
          cellSize={0.5}
          cellThickness={0.4}
          cellColor="#1d242d"
          sectionSize={1}
          sectionThickness={0.8}
          sectionColor="#2a3340"
          fadeDistance={40}
        />
        <DragScene project={project} dragRef={dragRef} setDragging={setDragging} />
        <TwinScreenProbe project={project} />
        {(project.reality?.asBuilt ?? []).map((obj) => {
          const mode = project.reality?.compareMode ?? "as-designed";
          if (mode === "as-designed") return null;
          const sel = store.selectedIds.includes(obj.id);
          return (
            <mesh
              key={obj.id}
              position={[obj.x + obj.widthM / 2, obj.z + obj.heightM / 2, obj.y + obj.depthM / 2]}
            >
              <boxGeometry args={[obj.widthM, obj.heightM, obj.depthM]} />
              <meshStandardMaterial color={sel ? "#e0c070" : "#c4a35a"} transparent opacity={mode === "as-built" ? 0.65 : 0.45} />
            </mesh>
          );
        })}
        <Shaft project={project} />
        <Board project={project} />
        <TempEstimate project={project} />
        <Ceiling project={project} visible={showCeiling && !topCamera()} />
      </Canvas>
      <div className="pointer-events-none absolute left-3 top-3 rounded-[8px] border border-border bg-panel/90 px-2 py-1 font-mono text-[11px] text-muted">
        1:1 Digital Twin · {project.room.widthM.toFixed(3)} × {project.room.depthM.toFixed(3)} × {project.room.heightM.toFixed(3)} m
      </div>
      {store.lastMutationError && (
        <div className="absolute left-3 top-12 z-10 max-w-[280px] rounded-[8px] border border-border bg-crit/20 px-2 py-1 font-mono text-[11px] text-crit" data-mf-id="twin-error">
          {store.lastMutationError}
        </div>
      )}
      <div className="absolute left-3 bottom-3 z-10 flex flex-wrap gap-1" data-mf-id="twin-editor">
        <button
          type="button"
          data-mf-id="twin-props"
          className="min-h-11 rounded-[8px] border border-border bg-panel/90 px-3 py-2 text-[11px] text-fg"
          onClick={() => {
            store.setInspectorOpen(true);
            store.openSheet("props", "half");
          }}
        >
          Свойства
        </button>
        <button
          type="button"
          data-mf-id="twin-rotate"
          className="min-h-11 rounded-[8px] border border-border bg-panel/90 px-3 py-2 text-[11px] text-fg disabled:opacity-40"
          disabled={!selectedRack}
          onClick={() => {
            const res = store.rotateSelectedRack();
            if (!res.ok) useProjectStore.setState({ lastMutationError: res.errors[0] ?? "Поворот отклонён." });
          }}
        >
          Поворот 90°
        </button>
        <button
          type="button"
          data-mf-id="twin-delete"
          className="min-h-11 rounded-[8px] border border-border bg-panel/90 px-3 py-2 text-[11px] text-fg"
          onClick={() => store.deleteSelected()}
        >
          Удалить
        </button>
        <button
          type="button"
          data-mf-id="twin-ai"
          className="min-h-11 rounded-[8px] border border-border bg-panel/90 px-3 py-2 text-[11px] text-fg"
          onClick={() => store.openSheet("grok", "half")}
        >
          AI
        </button>
      </div>
      <button
        type="button"
        data-mf-id="ceiling-toggle"
        data-mf-ceiling={project.room.heightM.toFixed(3)}
        data-mf-ceiling-visible={showCeiling ? "1" : "0"}
        className="absolute right-3 bottom-3 min-h-11 rounded-[8px] border border-border bg-panel/90 px-3 py-2 font-mono text-[11px] text-muted hover:text-fg"
        onClick={() => setShowCeiling((v) => !v)}
      >
        Потолок {project.room.heightM.toFixed(3)} m · {showCeiling ? "скрыть" : "показать"}
      </button>
    </div>
  );
}
