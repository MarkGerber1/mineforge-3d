import { AIR_DENSITY_KG_M3, DEFAULT_FREE_AREA_RATIO, DEFAULT_MAX_FACE_VELOCITY_MS, DEFAULT_OPENING_CRITERION_SOURCE } from "./constants.ts";
import { dynamicPressurePa, velocityMs } from "./airflow.ts";
import { openingAreaM2, validateOpening } from "./geometry.ts";
import type { OpeningAirflowAssessment, OpeningAirflowCriteria, Project } from "./types.ts";

export const DEFAULT_OPENING_CRITERIA: OpeningAirflowCriteria = {
  maxFaceVelocityMs: DEFAULT_MAX_FACE_VELOCITY_MS,
  freeAreaRatio: DEFAULT_FREE_AREA_RATIO,
  source: DEFAULT_OPENING_CRITERION_SOURCE,
};

function linkedComponent(project: Project, openingId: string) {
  return project.ventilation.components.find((c) => c.openingId === openingId);
}

/**
 * Calculates opening duty independently from the duct pressure network.
 * The criteria are explicit project configuration and are never presented as
 * a regulatory limit. Flow is split evenly between openings of the same role.
 */
export function assessOpeningAirflow(
  project: Project,
  requiredFlowM3h: number,
  criteria: OpeningAirflowCriteria = project.ventilation.openingCriteria ?? DEFAULT_OPENING_CRITERIA,
) {
  const enforced = project.ventilation.openingCriteriaEnabled === true;
  const safeCriteria = Number.isFinite(criteria.maxFaceVelocityMs) && criteria.maxFaceVelocityMs > 0
    && Number.isFinite(criteria.freeAreaRatio) && criteria.freeAreaRatio > 0 && criteria.freeAreaRatio <= 1
    ? criteria
    : DEFAULT_OPENING_CRITERIA;
  const intakeOpenings = project.openings.filter((o) => o.type === "INTAKE");
  const exhaustOpenings = project.openings.filter((o) => o.type === "EXHAUST" || o.type === "SHAFT_CONNECTION");
  const assess = (o: (typeof project.openings)[number], role: "intake" | "exhaust", count: number): OpeningAirflowAssessment => {
    const geometry = validateOpening(project, o);
    const component = linkedComponent(project, o.id);
    const ratio = component?.freeAreaRatio ?? safeCriteria.freeAreaRatio;
    const maxVelocity = component?.maxFaceVelocityMs ?? safeCriteria.maxFaceVelocityMs;
    const q = count > 0 ? Math.max(0, requiredFlowM3h) / count : 0;
    const gross = openingAreaM2(o);
    const effective = gross * ratio;
    const requiredEffective = maxVelocity > 0 ? (q / 3600) / maxVelocity : Infinity;
    const requiredGross = ratio > 0 ? requiredEffective / ratio : Infinity;
    const velocity = velocityMs(q, effective);
    const k = component?.kLocal ?? 0;
    const dynamic = Number.isFinite(velocity) ? dynamicPressurePa(velocity, AIR_DENSITY_KG_M3) : Infinity;
    const errors = [...geometry.errors];
    let status: OpeningAirflowAssessment["status"] = "PASS";
    if (!geometry.ok) status = "GEOMETRY_INVALID";
    else if (effective <= 0 || !Number.isFinite(effective)) status = "INVALID_AIR_PATH";
    else if (gross + 1e-12 < requiredGross) status = "UNDERSIZED";
    else if (velocity > maxVelocity + 1e-9) status = "EXCESSIVE_FACE_VELOCITY";
    if (status !== "PASS") errors.push(status);
    return {
      id: o.id,
      type: o.type,
      role,
      requiredFlowM3h: q,
      grossAreaM2: gross,
      effectiveAreaM2: effective,
      requiredEffectiveAreaM2: requiredEffective,
      requiredGrossAreaM2: requiredGross,
      faceVelocityMs: velocity,
      maxFaceVelocityMs: maxVelocity,
      freeAreaRatio: ratio,
      dynamicPressurePa: dynamic,
      localLossPa: k * dynamic,
      deficitAreaM2: Math.max(0, requiredGross - gross),
      status,
      criterionSource: component?.criterionSource ?? safeCriteria.source,
      errors,
    };
  };
  const intake = intakeOpenings.map((o) => assess(o, "intake", intakeOpenings.length));
  const exhaust = exhaustOpenings.map((o) => assess(o, "exhaust", exhaustOpenings.length));
  const relevant = [...intake, ...exhaust];
  return {
    valid: !enforced || relevant.every((a) => a.status === "PASS"),
    enforced,
    criterion: safeCriteria,
    requiredFlowM3h,
    intake,
    exhaust,
    errors: relevant.flatMap((a) => a.errors.map((e) => `${a.id}: ${e}`)),
  };
}
