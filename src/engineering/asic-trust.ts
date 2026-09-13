import type { AsicSpec, AsicTrustDecision, TrustLevel } from "./types.ts";

const FINAL_SAFE_ELIGIBLE: ReadonlySet<TrustLevel> = new Set(["OFFICIAL_VERIFIED", "VERIFIED_SECONDARY"]);

export function isFinalSafeTrust(level: TrustLevel | undefined | null): boolean {
  return level != null && FINAL_SAFE_ELIGIBLE.has(level);
}

export function asicTrustDecision(asic: AsicSpec | null): AsicTrustDecision {
  if (!asic) {
    return {
      level: null,
      finalSafeEligible: false,
      reason: "ASIC model unknown.",
    };
  }
  const level = asic.source.trust;
  if (isFinalSafeTrust(level)) {
    return {
      level,
      finalSafeEligible: true,
      reason: `ASIC provenance ${level} is eligible for VERIFIED SAFE.`,
    };
  }
  return {
    level,
    finalSafeEligible: false,
    reason: `ASIC provenance ${level} is not eligible for VERIFIED SAFE.`,
  };
}

/**
 * Grok may propose an imported spec. It must not mint official/secondary trust.
 * Owner-imported official specs use the non-Grok path and keep their provenance.
 */
export function grokImportedAsic(asic: AsicSpec): AsicSpec {
  const claimed = asic.source?.trust;
  if (claimed === "OFFICIAL_VERIFIED" || claimed === "VERIFIED_SECONDARY") {
    return {
      ...asic,
      source: {
        ...asic.source,
        trust: "AI_FOUND_UNVERIFIED",
        label: asic.source.label || "Grok-imported ASIC",
      },
    };
  }
  if (!claimed) {
    return {
      ...asic,
      source: {
        label: asic.source?.label || "Grok-imported ASIC",
        url: asic.source?.url,
        retrieved: asic.source?.retrieved,
        trust: "AI_FOUND_UNVERIFIED",
      },
    };
  }
  return asic;
}
