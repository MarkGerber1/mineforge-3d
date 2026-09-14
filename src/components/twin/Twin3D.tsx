import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { DoubleSide, Vector3, type Ray } from "three";
import { useLiveProject, useLiveResult, useProjectStore } from "@/project/store";
import { openingWorldRect, rackAabb } from "@/engineering/geometry";
import { panelWorldBox, segmentAllWalls } from "@/engineering/apertures";
import type { Project, WallId } from "@/engineering/types";

function orbitLocked(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { __MF_TWIN_LOCK_ORBIT__?: boolean }).__MF_TWIN_LOCK_ORBIT__);
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
      objects[id] = { x: sx, y: sy, visible: v.z >= -1 && v.z <= 1 };
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

function floorFromRay(ray: Ray): { x: number; z: number } | null {
  if (Math.abs(ray.direction.y) < 1e-8) return null;
  const t = -ray.origin.y / ray.direction.y;
  if (t < 0) return null;
  return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
}

type TwinDrag =
  | { kind: "rack"; id: string; grabX: number; grabZ: number; startX: number; startY: number }
  | { kind: "fan"; id: string; grabX: number; grabZ: number; startX: number; startY: number }
  | { kind: "opening"; id: string; grabAlong: number; startOff: number; wall: Project["openings"][number]["wallId"] };

function alongOf(hit: { x: number; z: number }, wall: WallId): number {
  if (wall === "south" || wall === "north") return hit.x;
  return hit.z;
}

function selectObject(id: string) {
  const store = useProjectStore.getState();
  store.select([id]);
  if (typeof window !== "undefined" && window.innerWidth < 768) {
    store.openSheet("props", "half");
  }
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

function Openings({
  project,
  onDragStart,
}: {
  project: Project;
  onDragStart: (d: TwinDrag, e: ThreeEvent<PointerEvent>) => void;
}) {
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
          <group
            key={o.id}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              selectObject(o.id);
            }}
            onPointerDown={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              useProjectStore.getState().select([o.id]);
              const hit = floorFromRay(e.ray);
              const along = hit ? alongOf(hit, o.wallId) : o.offsetFromWallStartM;
              onDragStart({ kind: "opening", id: o.id, grabAlong: along, startOff: o.offsetFromWallStartM, wall: o.wallId }, e);
            }}
          >
            {posts.map((p, i) => (
              <mesh key={i} position={p.pos}>
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

function Racks({
  project,
  onDragStart,
}: {
  project: Project;
  onDragStart: (d: TwinDrag, e: ThreeEvent<PointerEvent>) => void;
}) {
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
            <mesh
              position={[cx, r.heightM / 2, cz]}
              castShadow
              onClick={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                selectObject(r.id);
              }}
              onPointerDown={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                useProjectStore.getState().select([r.id]);
                const hit = floorFromRay(e.ray);
                onDragStart(
                  {
                    kind: "rack",
                    id: r.id,
                    grabX: (hit?.x ?? cx) - r.x,
                    grabZ: (hit?.z ?? cz) - r.y,
                    startX: r.x,
                    startY: r.y,
                  },
                  e,
                );
              }}
            >
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

function Fans({
  project,
  onDragStart,
}: {
  project: Project;
  onDragStart: (d: TwinDrag, e: ThreeEvent<PointerEvent>) => void;
}) {
  const selectedIds = useProjectStore((s) => s.selectedIds);
  return (
    <group>
      {project.fans.map((f) => {
        const sel = selectedIds.includes(f.id);
        return (
          <mesh
            key={f.id}
            position={[f.x, 0.4, f.y]}
            rotation={[Math.PI / 2, 0, 0]}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              selectObject(f.id);
            }}
            onPointerDown={(e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              useProjectStore.getState().select([f.id]);
              const hit = floorFromRay(e.ray);
              onDragStart(
                {
                  kind: "fan",
                  id: f.id,
                  grabX: (hit?.x ?? f.x) - f.x,
                  grabZ: (hit?.z ?? f.y) - f.y,
                  startX: f.x,
                  startY: f.y,
                },
                e,
              );
            }}
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

function DragScene({
  project,
  dragRef,
  dragging,
  setDragging,
}: {
  project: Project;
  dragRef: React.MutableRefObject<TwinDrag | null>;
  dragging: boolean;
  setDragging: (v: boolean) => void;
}) {
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current;
    if (!d) return;
    const hit = floorFromRay(e.ray);
    if (!hit) return;
    const store = useProjectStore.getState();
    const src = store.project;
    if (d.kind === "rack") {
      const x = hit.x - d.grabX;
      const y = hit.z - d.grabZ;
      store.moveRack(d.id, x, y, true);
    } else if (d.kind === "fan") {
      const x = hit.x - d.grabX;
      const y = hit.z - d.grabZ;
      store.moveFan(d.id, x, y, true);
    } else {
      const along = alongOf(hit, d.wall);
      const nextOff = d.startOff + (along - d.grabAlong);
      const opening = src.openings.find((o) => o.id === d.id);
      if (!opening) return;
      const nextOpenings = src.openings.map((o) => (o.id === d.id ? { ...o, offsetFromWallStartM: nextOff } : o));
      store.setPreview({ ...src, openings: nextOpenings });
    }
  };

  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    const store = useProjectStore.getState();
    if (!d) {
      store.setPreview(null);
      return;
    }
    if (d.kind === "rack") {
      const live = store.preview ?? store.project;
      const rack = live.racks.find((r) => r.id === d.id);
      store.setPreview(null);
      if (!rack) return;
      const res = store.moveRack(d.id, rack.x, rack.y, false);
      if (!res.ok) {
        store.setPreview(null);
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

  const start = (d: TwinDrag, e: ThreeEvent<PointerEvent>) => {
    dragRef.current = d;
    setDragging(true);
    (e.target as HTMLElement | undefined)?.setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  };

  return (
    <group
      onPointerMove={(e) => {
        if (dragRef.current) {
          e.stopPropagation();
          onMove(e);
        }
      }}
      onPointerUp={() => {
        if (dragRef.current) onUp();
      }}
    >
      <RoomShell project={project} />
      <Openings project={project} onDragStart={start} />
      <Racks project={project} onDragStart={start} />
      <Fans project={project} onDragStart={start} />
      {dragging && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[project.room.widthM / 2, 0.01, project.room.depthM / 2]}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          <planeGeometry args={[Math.max(40, project.room.widthM * 4), Math.max(40, project.room.depthM * 4)]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
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

  return (
    <div className="relative h-full w-full bg-bg" data-mf-id="twin" style={{ touchAction: "none" }}>
      <Canvas
        shadows
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onPointerMissed={() => store.select([])}
        onCreated={({ gl }) => {
          gl.domElement.setAttribute("data-mf-id", "twin-canvas");
        }}
      >
        <color attach="background" args={["#0b0d10"]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[10, 14, 8]} intensity={1.35} castShadow />
        <PerspectiveCamera makeDefault position={camPos} fov={42} />
        <OrbitControls
          makeDefault
          enabled={!dragging && !orbitLocked()}
          target={[project.room.widthM / 2, project.room.heightM * 0.45, project.room.depthM / 2]}
          enableDamping
        />
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
        <DragScene project={project} dragRef={dragRef} dragging={dragging} setDragging={setDragging} />
        <TwinScreenProbe project={project} />
        {(project.reality?.asBuilt ?? []).map((obj) => {
          const mode = project.reality?.compareMode ?? "as-designed";
          if (mode === "as-designed") return null;
          const opacity = mode === "as-built" ? 0.65 : 0.45;
          const sel = store.selectedIds.includes(obj.id);
          return (
            <mesh
              key={obj.id}
              position={[obj.x + obj.widthM / 2, obj.z + obj.heightM / 2, obj.y + obj.depthM / 2]}
              onClick={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                selectObject(obj.id);
              }}
            >
              <boxGeometry args={[obj.widthM, obj.heightM, obj.depthM]} />
              <meshStandardMaterial color={sel ? "#e0c070" : "#c4a35a"} transparent opacity={opacity} />
            </mesh>
          );
        })}
        <Shaft project={project} />
        <Board project={project} />
        <TempEstimate project={project} />
        <Ceiling project={project} visible={showCeiling} />
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
