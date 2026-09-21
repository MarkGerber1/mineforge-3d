import { AIR_CP_J_KG_K, AIR_DENSITY_KG_M3 } from "./constants.ts";
import { asicFrequencyRangeKnown, asicTopologyKnown, validateAsicSpecRelations } from "./asic-spec.ts";
import { asicTrustDecision, deriveImportedAsic } from "./asic-trust.ts";
import { calculateCapacity } from "./capacity.ts";
import { calculateElectrical } from "./electrical.ts";
import { evaluateProjectFans } from "./fans.ts";
import { calculateFloorLoading } from "./floor.ts";
import { analyzeGeometry, analyzeOpenings, validExhaustAvailable, validIntakeAvailable } from "./geometry.ts";
import { engineeringDemandCount, placedAsicCount } from "./inventory.ts";
import { feasibleSpacePacking } from "./space-pack.ts";
import { calculatePressure, resolvedVentComponents } from "./pressure.ts";
import { analyzeRacks } from "./racks.ts";
import { calculateThermal, requiredAirflowPerAsicM3h, thermalAirflowM3s } from "./thermal.ts";
import { assessOpeningAirflow } from "./opening-airflow.ts";
import type { AsicSpec, EngineeringResult, FanSpec, Project, Warning } from "./types.ts";
import { m3sToM3h } from "./units.ts";

export interface Catalogs {
  asics: Record<string, AsicSpec>;
  fans: Record<string, FanSpec>;
}

export function resolveAsic(project: Project, catalogs: Catalogs): AsicSpec | null {
  if (project.fleet.imported && project.fleet.imported.id === project.fleet.asicId) {
    return deriveImportedAsic(project.fleet.imported, Object.values(catalogs.asics));
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
  const asicRel = asic ? validateAsicSpecRelations(asic) : { ok: true as const };
  const asicTrust = asicTrustDecision(asic, Object.values(catalogs.asics));
  const inventory = {
    requestedCount: project.fleet.requestedCount,
    placedAsicCount: placedAsicCount(project),
    engineeringDemandCount: engineeringDemandCount(project),
  };
  const electrical = calculateElectrical(project, asic);
  const thermal = calculateThermal(project, asic, electrical.typicalTotalW);
  const openingAirflow = assessOpeningAirflow(project, thermal.designAirflowM3h);
  const components = resolvedVentComponents(project);
  const pressure = calculatePressure(
    { ...project, ventilation: { ...project.ventilation, components } },
    thermal.designAirflowM3h || 1,
  );
  const fan = evaluateProjectFans(project, catalogs.fans, components, thermal.designAirflowM3h);
  const racks = analyzeRacks(project, asic);

  const exhaustOk = validExhaustAvailable(project, openings);
  const intakeOk = validIntakeAvailable(project, openings);
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
  } else if (!asicRel.ok) {
    warnings.push({
      id: "asic-spec-invalid",
      severity: "BLOCKER",
      title: "Некорректная спецификация ASIC",
      detail: asicRel.errors.join(" "),
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
  if (!intakeOk) {
    warnings.push({
      id: "no-intake",
      severity: "BLOCKER",
      title: "No intake path",
      detail: "Add a valid intake opening. Ventilation SAFE cannot be verified without usable intake.",
    });
  }
  for (const a of openingAirflow.enforced ? [...openingAirflow.intake, ...openingAirflow.exhaust] : []) {
    if (a.status === "UNDERSIZED") {
      warnings.push({
        id: `${a.role.toUpperCase()}_OPENING_UNDERSIZED`,
        severity: "CRITICAL",
        objectId: a.id,
        title: a.role === "intake" ? "INTAKE_OPENING_UNDERSIZED" : "EXHAUST_OPENING_UNDERSIZED",
        detail: `${a.id}: required gross area ${a.requiredGrossAreaM2.toFixed(3)} m², existing ${a.grossAreaM2.toFixed(3)} m²; deficit ${a.deficitAreaM2.toFixed(3)} m². Face velocity ${a.faceVelocityMs.toFixed(2)} m/s > configured ${a.maxFaceVelocityMs.toFixed(2)} m/s. Criterion: ${a.criterionSource}.`,
        formula: "v = Q / (A × freeAreaRatio)",
      });
    } else if (a.status === "EXCESSIVE_FACE_VELOCITY") {
      warnings.push({
        id: "EXCESSIVE_FACE_VELOCITY",
        severity: "CRITICAL",
        objectId: a.id,
        title: "EXCESSIVE_FACE_VELOCITY",
        detail: `${a.id}: ${a.faceVelocityMs.toFixed(2)} m/s > ${a.maxFaceVelocityMs.toFixed(2)} m/s. Effective area ${a.effectiveAreaM2.toFixed(3)} m².`,
        formula: "v = Q / effective area",
      });
    } else if (a.status === "INVALID_AIR_PATH") {
      warnings.push({ id: "INVALID_AIR_PATH", severity: "CRITICAL", objectId: a.id, title: "INVALID_AIR_PATH", detail: a.errors.join(" ") });
    }
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
  if (fan.trust != null && !fan.finalSafeEligible) {
    warnings.push({
      id: "fan-trust-unverified",
      severity: "WARNING",
      objectId: project.fans[0]?.id,
      title: "Fan curve is not verified",
      detail: `Fan curve trust is ${fan.trust}. Duty may be calculated, but SAFE remains PRELIMINARY until an OFFICIAL_VERIFIED or VERIFIED_SECONDARY curve is used.`,
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
  if (electrical.supplyVoltageCompatible === false) {
    warnings.push({
      id: "asic-voltage-mismatch",
      severity: "CRITICAL",
      title: "Напряжение питания несовместимо с ASIC",
      detail: `Supply ${project.electrical.voltageV} V is outside ASIC ${asic?.voltageMin}–${asic?.voltageMax} V.`,
    });
  }
  if (electrical.supplyFrequencyCompatible === false) {
    warnings.push({
      id: "asic-frequency-mismatch",
      severity: "CRITICAL",
      title: "Частота питания несовместима с ASIC",
      detail: `Supply ${project.electrical.frequencyHz} Hz is outside ASIC ${asic?.frequencyMinHz}–${asic?.frequencyMaxHz} Hz.`,
    });
  }
  if (asic && !asicFrequencyRangeKnown(asic)) {
    warnings.push({
      id: "asic-frequency-unknown",
      severity: "INFO",
      title: "ASIC input-frequency range is not verified",
      detail: "Manufacturer frequency capability is unknown. SAFE cannot be VERIFIED.",
    });
  }
  if (asic && !asicTopologyKnown(asic)) {
    warnings.push({
      id: "asic-topology-unknown",
      severity: "INFO",
      title: "ASIC input phase topology is not verified",
      detail: "Phase-current distribution is not fabricated. SAFE cannot be VERIFIED.",
    });
  }
  if (asic && !asicTrust.finalSafeEligible) {
    warnings.push({
      id: "asic-trust-unverified",
      severity: "INFO",
      title: "ASIC provenance is not final-safe",
      detail: asicTrust.reason,
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
  for (const h of racks.clearanceHits) {
    warnings.push({
      id: `clear-${h.id}-${warnings.length}`,
      severity: "CRITICAL",
      objectId: h.id,
      title: "Service / aisle conflict",
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
  } else if (project.constraints.maxFloorLoadPa == null || !(project.constraints.maxFloorLoadPa > 0)) {
    warnings.push({
      id: "floor-known-without-limit",
      severity: "BLOCKER",
      title: "Floor marked known without a limit",
      detail: "A known floor requires a finite net payload pressure > 0 Pa.",
    });
  }

  const tmplPack = feasibleSpacePacking(project, asic);
  const spaceN = asic && asicRel.ok ? tmplPack.asicCount : null;

  const openingAirflowBlocked = openingAirflow.enforced && [...openingAirflow.intake, ...openingAirflow.exhaust].some((a) => a.status !== "PASS");
  const ventKnown = fan.operatingQ_m3h != null && asic != null && asicRel.ok && !openingAirflowBlocked;
  const ventN =
    asic && fan.operatingQ_m3h != null && !openingAirflowBlocked
      ? maxAsicByAirflow(
          asic,
          fan.operatingQ_m3h,
          project.thermal.deltaTK,
          project.electrical.auxiliaryW + project.electrical.lightingW + project.electrical.networkW,
        )
      : openingAirflowBlocked && asic ? 0 : null;

  let policyMax =
    project.electrical.policy === "design" ? electrical.maxByDesign : electrical.maxByTypical;
  if (!asicRel.ok) policyMax = 0;

  const floor = calculateFloorLoading(project, asicRel.ok ? asic : null, racks.perRackCapacity);

  const qPer = asic ? requiredAirflowPerAsicM3h(asic, project.thermal.deltaTK) : 0;

  const hasCriticalConflict = warnings.some((w) => w.severity === "CRITICAL");
  const floorKnownInconsistent =
    !project.constraints.floorLoadingUnknown &&
    (project.constraints.maxFloorLoadPa == null || !(project.constraints.maxFloorLoadPa > 0));
  const hasBlocker =
    !geometry.valid ||
    !openings.valid ||
    !asic ||
    !asicRel.ok ||
    !exhaustOk ||
    !intakeOk ||
    floorKnownInconsistent ||
    openings.items.some((i) => i.errors.length > 0);

  const floorKnown = floor.known && floor.maxByFloor != null;
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
    spaceDetail: spaceN == null ? "Geometry invalid." : `Feasible packing ${spaceN} ASIC.`,
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
      ? `${racks.usableCapacity} usable ASIC on ${project.racks.length} rack(s) (${racks.totalCapacity} shelf capacity, ${racks.totalCapacity - racks.usableCapacity} blocked by 3D/clearance conflict).`
      : "No racks placed — using feasible space packing.",
    rackTrace: racks.perRackCapacity.map((r) => ({
      id: r.id,
      label: `Rack ${r.id}`,
      formula: "floor(usableShelfWidth / asicWidth) × shelves",
      inputs: { perShelf: r.perShelf, total: r.total, blocked: r.blocked ? 1 : 0 },
      raw: r.blocked ? 0 : r.total,
      unit: "ASIC",
      display: r.blocked ? `${r.total} BLOCKED` : String(r.total),
    })),
    maxByFloor: floor.maxByFloor,
    floorKnown,
    floorDetail: floor.reason,
    floorTrace: floor.traces,
    maxByUser: null,
    userKnown: false,
    geometryValid: geometry.valid,
    asicKnown: asic != null,
    exhaustKnown: exhaustOk,
    intakeKnown: intakeOk,
    openingsValid: openings.valid,
    fanKnown: project.fans.length > 0 && fan.operatingQ_m3h != null,
    fanFinalSafeEligible: fan.finalSafeEligible,
    floorUnknown: project.constraints.floorLoadingUnknown || !floorKnown,
    hasBlocker,
    hasCriticalConflict,
    asicFinalSafeEligible: asicTrust.finalSafeEligible,
    frequencyCapabilityKnown: asic ? asicFrequencyRangeKnown(asic) : true,
    topologyKnown: asic ? asicTopologyKnown(asic) : true,
  });

  const missing = [
    { key: "ROOM_COMPLETE", complete: geometry.valid, impact: 10, question: "Какие точные размеры помещения?" },
    { key: "ASIC_MODEL", complete: asic != null, impact: 10, question: "Какая модель ASIC?" },
    { key: "ELECTRICAL_POWER", complete: project.electrical.known && project.electrical.availablePowerW > 0, impact: 9, question: "Какая выделенная электрическая мощность?" },
    { key: "EXHAUST_PATH", complete: exhaustOk, impact: 9, question: "Где вытяжной проём и шахта?" },
    { key: "INTAKE_PATH", complete: intakeOk, impact: 9, question: "Где приточный проём?" },
    { key: "FAN", complete: project.fans.length > 0, impact: 8, question: "Какой вентилятор установлен или планируется?" },
    { key: "DELTA_T", complete: project.thermal.deltaTK > 0, impact: 5, question: "Какой расчётный перепад температуры ΔT?" },
    {
      key: "FLOOR_LOADING",
      complete: !project.constraints.floorLoadingUnknown && floorKnown,
      impact: 4,
      question: "Какая допустимая нагрузка на перекрытие?",
    },
  ];

  return {
    geometry,
    openings: { ...openings, airflow: openingAirflow },
    electrical,
    asicTrust,
    inventory,
    thermal,
    pressure,
    fan,
    racks,
    floor,
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
