import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { useLiveProject, useLiveResult, useProjectStore } from "@/project/store";
import { openingWorldRect, rackAabb } from "@/engineering/geometry";
import type { Project } from "@/engineering/types";

function RoomShell({ project }: { project: Project }) {
  const w = project.room.widthM;
  const d = project.room.depthM;
  const h = project.room.heightM;
  const t = 0.08;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, 0, d / 2]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#24303c" roughness={0.85} />
      </mesh>
      {/* walls as thin boxes */}
      <mesh position={[w / 2, h / 2, 0]} castShadow>
        <boxGeometry args={[w, h, t]} />
        <meshStandardMaterial color="#3a4656" transparent opacity={0.82} />
      </mesh>
      <mesh position={[w / 2, h / 2, d]} castShadow>
        <boxGeometry args={[w, h, t]} />
        <meshStandardMaterial color="#3a4656" transparent opacity={0.82} />
      </mesh>
      <mesh position={[0, h / 2, d / 2]} castShadow>
        <boxGeometry args={[t, h, d]} />
        <meshStandardMaterial color="#3a4656" transparent opacity={0.82} />
      </mesh>
      <mesh position={[w, h / 2, d / 2]} castShadow>
        <boxGeometry args={[t, h, d]} />
        <meshStandardMaterial color="#3a4656" transparent opacity={0.82} />
      </mesh>
    </group>
  );
}

function Openings({ project }: { project: Project }) {
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
        const selected = useProjectStore.getState().selectedIds.includes(o.id);
        return (
          <mesh
            key={o.id}
            position={[cx, cy, cz]}
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              useProjectStore.getState().select([o.id]);
            }}
          >
            <boxGeometry args={[Math.max(alongX, 0.08), Math.max(o.heightM, 0.08), Math.max(alongZ, 0.08)]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 0.4 : 0.15} />
          </mesh>
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
        const warn = result.racks.collisions.some((c) => c.a === r.id || c.b === r.id);
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
                useProjectStore.getState().select([r.id]);
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

function Fans({ project }: { project: Project }) {
  return (
    <group>
      {project.fans.map((f) => (
        <mesh key={f.id} position={[f.x, 0.4, f.y]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.28, 0.28, 0.18, 16]} />
          <meshStandardMaterial color="#7b8ca3" metalness={0.4} roughness={0.4} />
        </mesh>
      ))}
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
        {/* ESTIMATE marker via a thin plane */}
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

export function Twin3D() {
  const project = useLiveProject();
  const store = useProjectStore();
  const [mounted, setMounted] = useState(false);
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

  return (
    <div className="relative h-full w-full bg-bg" data-mf-id="twin" style={{ touchAction: "none" }}>
      <Canvas shadows dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }} onPointerMissed={() => store.select([])}>
        <color attach="background" args={["#0b0d10"]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[10, 14, 8]} intensity={1.35} castShadow />
        <PerspectiveCamera makeDefault position={camPos} fov={42} />
        <OrbitControls makeDefault target={[project.room.widthM / 2, project.room.heightM * 0.45, project.room.depthM / 2]} enableDamping />
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
        <RoomShell project={project} />
        <Openings project={project} />
        <Racks project={project} />
        {(project.reality?.asBuilt ?? []).map((obj) => {
          const mode = project.reality?.compareMode ?? "as-designed";
          if (mode === "as-designed") return null;
          const opacity = mode === "as-built" ? 0.65 : 0.45;
          return (
            <mesh key={obj.id} position={[obj.x + obj.widthM / 2, obj.z + obj.heightM / 2, obj.y + obj.depthM / 2]}>
              <boxGeometry args={[obj.widthM, obj.heightM, obj.depthM]} />
              <meshStandardMaterial color="#c4a35a" transparent opacity={opacity} />
            </mesh>
          );
        })}
        <Shaft project={project} />
        <Fans project={project} />
        <Board project={project} />
        <TempEstimate project={project} />
      </Canvas>
      <div className="pointer-events-none absolute left-3 top-3 rounded-[8px] border border-border bg-panel/90 px-2 py-1 font-mono text-[11px] text-muted">
        1:1 Digital Twin · {project.room.widthM.toFixed(3)} × {project.room.depthM.toFixed(3)} × {project.room.heightM.toFixed(3)} m
      </div>
    </div>
  );
}
