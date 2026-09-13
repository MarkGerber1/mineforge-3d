import { AIR_CP_J_KG_K, AIR_DENSITY_KG_M3 } from "./constants.ts";
import { calculateCapacity, theoreticalSpaceCapacity } from "./capacity.ts";
import { calculateElectrical } from "./electrical.ts";
import { evaluateProjectFans } from "./fans.ts";
import { analyzeGeometry, analyzeOpenings } from "./geometry.ts";
import { defaultRackTemplate } from "./layout.ts";
import { calculatePressure, resolvedVentComponents } from "./pressure.ts";
import { analyzeRacks, rackAsicCapacity } from "./racks.ts";
import { calculateThermal, requiredAirflowPerAsicM3h, thermalAirflowM3s } from "./thermal.ts";
import type { AsicSpec, EngineeringResult, FanSpec, Project, Warning } from "./types.ts";
import { m3sToM3h } from "./units.ts";

export interface Catalogs {
  asics: Record<string, AsicSpec>;
  fans: Record<string, FanSpec>;
}

export function resolveAsic(project: Project, catalogs: Catalogs): AsicSpec | null {
  if (project.fleet.imported && project.fleet.imported.id === project.fleet.asicId) {
    return project.fleet.imported;
  }
  return catalogs.asics[project.fleet.asicId] ?? null;
}

export function maxAsicByAirflow(
  asic: AsicSpec,
  operatingM3h: number,
  deltaTK: number,
  auxiliaryW: number,
): number {
  if (operatingM3h <= 0) return 0;
  const thermalCapW = (operatingM3h / 3600) * AIR_DENSITY_KG_M3 * AIR_CP_J_KG_K * deltaTK;
  const heatBudget = thermalCapW - auxiliaryW;
  const byThermal = heatBudget > 0 ? Math.floor(heatBudget / asic.typicalPowerW) : 0;
  const equip = asic.manufacturerAirflowM3h ?? 0;
  const byEquip = equip > 0 ? Math.floor(operatingM3h / equip) : Infinity;
  const n = Math.min(byThermal, byEquip);
  return Number.isFinite(n) ? Math.max(0, n) : Math.max(0, byThermal);
}

export function calculateAll(project: Project, catalogs: Catalogs): EngineeringResult {
  const geometry = analyzeGeometry(project);
  const openings = analyzeOpenings(project);
  const asic = resolveAsic(project, catalogs);
  const electrical = calculateElectrical(project, asic);
  const thermal = calculateThermal(project, asic, electrical.typicalTotalW);
  const components = resolvedVentComponents(project);
  const extraDirty = project.ventilation.dirtyFilter ? project.ventilation.dirtyFilterExtraPa : 0;
  const compsForPressure = components.map((c) =>
    extraDirty && c.kind === "filter" ? { ...c, extraPressurePa: c.extraPressurePa + extraDirty } : c,
  );
  const pressure = calculatePressure(
    { ...project, ventilation: { ...project.ventilation, components: compsForPressure } },
    thermal.designAirflowM3h || 1,
  );
  const fan = evaluateProjectFans(project, catalogs.fans, components, thermal.designAirflowM3h);
  const racks = analyzeRacks(project, asic);

  const exhaustOk = project.openings.some((o) => o.type === "EXHAUST" || o.type === "SHAFT_CONNECTION");
  const warnings: Warning[] = [];

  if (!geometry.valid) {
    warnings.push({
      id: "geom-invalid",
      severity: "BLOCKER",
      title: "Invalid room geometry",
      detail: "Room dimensions must be positive and within engineering limits.",
    });
  }
  for (const item of openings.items) {
    for (const err of item.errors) {
      warnings.push({
        id: `open-${item.id}`,
        severity: "BLOCKER",
        objectId: item.id,
        title: "Invalid opening",
        detail: err,
      });
    }
  }
  if (!asic) {
    warnings.push({
      id: "asic-unknown",
      severity: "BLOCKER",
      title: "ASIC model unknown",
      detail: "Select a verified ASIC model before treating SAFE COUNT as final.",
    });
  }
  if (!exhaustOk) {
    warnings.push({
      id: "no-exhaust",
      severity: "BLOCKER",
      title: "No exhaust path",
      detail: "Add an exhaust opening or shaft connection.",
    });
  }
  if (project.fans.length === 0) {
    warnings.push({
      id: "no-fan",
      severity: "CRITICAL",
      title: "No fan selected",
      detail: "Ventilation capacity cannot be verified without a fan curve.",
    });
  } else if (fan.reason.includes("outside the room")) {
    warnings.push({
      id: "fan-outside",
      severity: "CRITICAL",
      objectId: project.fans[0]?.id,
      title: "Fan outside room",
      detail: fan.reason,
    });
  }
  if (fan.pass === false) {
    warnings.push({
      id: "fan-fail",
      severity: "CRITICAL",
      objectId: project.fans[0]?.id,
      title: "Fan duty FAIL",
      detail: fan.reason,
    });
  }
  if (fan.cleanQ_m3h != null && fan.dirtyPass === false && fan.pass !== false) {
    warnings.push({
      id: "dirty-filter",
      severity: "WARNING",
      title: "Dirty-filter duty fails",
      detail: "The fan meets clean-filter duty but not dirty-filter duty.",
    });
  }
  if (electrical.designPass === false) {
    warnings.push({
      id: "elec-design-fail",
      severity: "CRITICAL",
      title: "Design electrical load exceeds supply",
      detail: "Typical load may pass, but the project policy must not ignore design power.",
    });
  }
  for (const c of racks.collisions) {
    warnings.push({ id: `col-${c.a}-${c.b}`, severity: "CRITICAL", objectId: c.a, title: "Rack collision", detail: c.reason });
  }
  for (const w of racks.wallHits) {
    warnings.push({ id: `wall-${w.id}`, severity: "CRITICAL", objectId: w.id, title: "Rack / wall collision", detail: w.reason });
  }
  for (const w of racks.doorHits) {
    warnings.push({ id: `door-${w.id}`, severity: "CRITICAL", objectId: w.id, title: "Door blocked", detail: w.reason });
  }
  for (const h of racks.asBuiltHits) {
    warnings.push({
      id: `asbuilt-${h.id}-${h.objectId}`,
      severity: "CRITICAL",
      objectId: h.id,
      title: "Rack / as-built XYZ collision",
      detail: h.reason,
    });
  }
  for (const h of racks.ceilingHits) {
    warnings.push({
      id: `ceil-${h.id}`,
      severity: "CRITICAL",
      objectId: h.id,
      title: "Ceiling envelope",
      detail: h.reason,
    });
  }
  for (const r of racks.recirculation) {
    warnings.push({
      id: `recirc-${r.from}-${r.to}`,
      severity: "WARNING",
      objectId: r.from,
      title: "Hot air recirculation risk",
      detail: `Exhaust of ${r.from} faces intake of ${r.to} at ${r.distanceM.toFixed(2)} m. Geometric heuristic, not CFD.`,
    });
  }
  if (project.constraints.floorLoadingUnknown) {
    warnings.push({
      id: "floor-unknown",
      severity: "INFO",
      title: "Floor loading UNKNOWN",
      detail: "Structural capacity is not entered. Safe count confidence is preliminary.",
    });
  }

  const tmpl = defaultRackTemplate();
  const dummyRack = {
    ...tmpl,
    id: "tmpl",
    name: "tmpl",
    x: 0,
    y: 0,
    rotationDeg: 0,
    asicCount: 0,
    airflowToward: "south" as const,
  };
  const perTmpl = asic ? rackAsicCapacity(dummyRack, asic) : 0;
  const spaceN = asic
    ? theoreticalSpaceCapacity(
        geometry.floorAreaM2,
        dummyRack.widthM,
        dummyRack.depthM,
        perTmpl,
        project.constraints.frontServiceClearanceM,
        project.constraints.rearServiceClearanceM,
        project.constraints.minAisleM,
      )
    : null;

  const ventKnown = fan.operatingQ_m3h != null && asic != null;
  const ventN =
    ventKnown && asic && fan.operatingQ_m3h != null
      ? maxAsicByAirflow(
          asic,
          fan.operatingQ_m3h,
          project.thermal.deltaTK,
          project.electrical.auxiliaryW + project.electrical.lightingW + project.electrical.networkW,
        )
      : null;

  const policyMax =
    project.electrical.policy === "design" ? electrical.maxByDesign : electrical.maxByTypical;

  const qPer = asic ? requiredAirflowPerAsicM3h(asic, project.thermal.deltaTK) : 0;

  const capacity = calculateCapacity({
    requested: project.fleet.requestedCount,
    maxByElectrical: policyMax,
    electricalKnown: electrical.maxByDesign != null,
    electricalDetail:
      policyMax == null
        ? "Available power not set."
        : `Policy: ${project.electrical.policy}. Max ${policyMax} ASIC.`,
    electricalTrace: electrical.traces,
    maxByVentilation: ventN,
    ventilationKnown: ventKnown,
    ventilationDetail:
      !asic
        ? "ASIC unknown."
        : fan.operatingQ_m3h == null
          ? "Fan operating point unknown."
          : `Operating ${fan.operatingQ_m3h.toFixed(0)} m³/h / ${qPer.toFixed(0)} m³/h per ASIC.`,
    ventilationTrace: [
      ...thermal.traces,
      {
        id: "q_op",
        label: "Fan operating airflow",
        formula: "intersection(fan curve, system curve)",
        inputs: { Q_req: thermal.designAirflowM3h, Q_op: fan.operatingQ_m3h ?? 0 },
        raw: fan.operatingQ_m3h ?? 0,
        unit: "m³/h",
        display: fan.operatingQ_m3h == null ? "UNKNOWN" : `${fan.operatingQ_m3h.toFixed(3)} m³/h`,
      },
      {
        id: "vent_n",
        label: "Max ASIC by ventilation",
        formula: "floor of thermal & equipment inversion of operating airflow",
        inputs: { N: ventN ?? 0 },
        raw: ventN ?? 0,
        unit: "ASIC",
        display: ventN == null ? "UNKNOWN" : String(ventN),
      },
    ],
    maxBySpace: spaceN,
    spaceKnown: geometry.valid,
    spaceDetail: spaceN == null ? "Geometry invalid." : `Theoretical packing ${spaceN} ASIC.`,
    spaceTrace: [
      {
        id: "area",
        label: "Floor area",
        formula: "W × D",
        inputs: { W: project.room.widthM, D: project.room.depthM },
        raw: geometry.floorAreaM2,
        unit: "m²",
        display: `${geometry.floorAreaM2.toFixed(3)} m²`,
      },
    ],
    maxByRack: project.racks.length ? racks.usableCapacity : spaceN,
    rackKnown: true,
    rackDetail: project.racks.length
      ? `${racks.usableCapacity} usable ASIC on ${project.racks.length} rack(s) (${racks.totalCapacity} shelf capacity, ${racks.totalCapacity - racks.usableCapacity} blocked by 3D conflict).`
      : "No racks placed — using theoretical space packing.",
    rackTrace: racks.perRackCapacity.map((r) => ({
      id: r.id,
      label: `Rack ${r.id}`,
      formula: "floor(usableShelfWidth / asicWidth) × shelves",
      inputs: { perShelf: r.perShelf, total: r.total, blocked: r.blocked ? 1 : 0 },
      raw: r.blocked ? 0 : r.total,
      unit: "ASIC",
      display: r.blocked ? `${r.total} BLOCKED` : String(r.total),
    })),
    maxByUser: null,
    userKnown: false,
    geometryValid: geometry.valid,
    asicKnown: asic != null,
    exhaustKnown: exhaustOk,
    fanKnown: project.fans.length > 0 && fan.operatingQ_m3h != null,
    floorUnknown: project.constraints.floorLoadingUnknown,
  });

  const missing = [
    { key: "ROOM_COMPLETE", complete: geometry.valid, impact: 10, question: "Какие точные размеры помещения?" },
    { key: "ASIC_MODEL", complete: asic != null, impact: 10, question: "Какая модель ASIC?" },
    { key: "ELECTRICAL_POWER", complete: project.electrical.known && project.electrical.availablePowerW > 0, impact: 9, question: "Какая выделенная электрическая мощность?" },
    { key: "EXHAUST_PATH", complete: exhaustOk, impact: 9, question: "Где вытяжной проём и шахта?" },
    { key: "FAN", complete: project.fans.length > 0, impact: 8, question: "Какой вентилятор установлен или планируется?" },
    { key: "DELTA_T", complete: project.thermal.deltaTK > 0, impact: 5, question: "Какой расчётный перепад температуры ΔT?" },
    { key: "FLOOR_LOADING", complete: !project.constraints.floorLoadingUnknown, impact: 4, question: "Какая допустимая нагрузка на перекрытие?" },
  ];

  return {
    geometry,
    openings,
    electrical,
    thermal,
    pressure,
    fan,
    racks,
    capacity,
    warnings,
    missing,
  };
}

export function fastPreview(project: Project, catalogs: Catalogs): Pick<EngineeringResult, "geometry" | "thermal" | "capacity" | "openings"> {
  const full = calculateAll(project, catalogs);
  return {
    geometry: full.geometry,
    thermal: full.thermal,
    capacity: full.capacity,
    openings: full.openings,
  };
}

export { thermalAirflowM3s, m3sToM3h };
