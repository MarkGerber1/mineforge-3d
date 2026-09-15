/**
 * ASIC provenance for VERIFIED SAFE is catalog authority, never a JSON claim.
 * fleet.imported.source.trust is DATA. finalSafeEligible is DERIVED.
 */
import { ASIC_CATALOG } from "../equipment/asic-catalog.ts";
import type { AsicSpec, AsicTrustDecision, TrustLevel } from "./types.ts";

const FINAL_SAFE_ELIGIBLE: ReadonlySet<TrustLevel> = new Set(["OFFICIAL_VERIFIED", "VERIFIED_SECONDARY"]);

export function isFinalSafeTrust(level: TrustLevel | undefined | null): boolean {
  return level != null && FINAL_SAFE_ELIGIBLE.has(level);
}

function sameOptionalString(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "") === (b ?? "");
}

function sameOptionalNumber(a: number | undefined, b: number | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a === b;
}

/**
 * Safety-driving fields that must match a trusted catalog entry.
 * id / source / noiseDba are not authority.
 */
export function trustedCatalogMatch(imported: AsicSpec, catalog: AsicSpec): boolean {
  return (
    imported.manufacturer === catalog.manufacturer &&
    imported.model === catalog.model &&
    sameOptionalString(imported.variant, catalog.variant) &&
    imported.algorithm === catalog.algorithm &&
    imported.hashrateThs === catalog.hashrateThs &&
    imported.typicalPowerW === catalog.typicalPowerW &&
    imported.designPowerW === catalog.designPowerW &&
    imported.voltageMin === catalog.voltageMin &&
    imported.voltageMax === catalog.voltageMax &&
    sameOptionalNumber(imported.currentA, catalog.currentA) &&
    sameOptionalNumber(imported.frequencyMinHz, catalog.frequencyMinHz) &&
    sameOptionalNumber(imported.frequencyMaxHz, catalog.frequencyMaxHz) &&
    sameOptionalNumber(imported.inputPhases, catalog.inputPhases) &&
    imported.widthM === catalog.widthM &&
    imported.heightM === catalog.heightM &&
    imported.lengthM === catalog.lengthM &&
    imported.weightKg === catalog.weightKg &&
    imported.airflowDirection === catalog.airflowDirection &&
    sameOptionalNumber(imported.manufacturerAirflowM3h, catalog.manufacturerAirflowM3h)
  );
}

export function catalogAsicsOf(catalogs?: { asics: Record<string, AsicSpec> }): AsicSpec[] {
  if (catalogs) return Object.values(catalogs.asics);
  return ASIC_CATALOG;
}

export function findTrustedCatalogMatch(imported: AsicSpec, catalogAsics: Iterable<AsicSpec> = ASIC_CATALOG): AsicSpec | null {
  for (const c of catalogAsics) {
    if (!isFinalSafeTrust(c.source.trust)) continue;
    if (trustedCatalogMatch(imported, c)) return c;
  }
  return null;
}

/**
 * Owner-imported Project JSON: rebind to catalog provenance on exact spec match,
 * otherwise strip official-looking trust to USER_ENTERED. Does not upgrade
 * already-unverified labels. Does not rewrite the stored Project object.
 */
export function deriveImportedAsic(imported: AsicSpec, catalogAsics: Iterable<AsicSpec> = ASIC_CATALOG): AsicSpec {
  const match = findTrustedCatalogMatch(imported, catalogAsics);
  if (match) return match;
  const claimed = imported.source?.trust;
  if (claimed === "OFFICIAL_VERIFIED" || claimed === "VERIFIED_SECONDARY") {
    return {
      ...imported,
      source: {
        ...imported.source,
        trust: "USER_ENTERED",
        label: imported.source.label || "Imported ASIC",
      },
    };
  }
  if (!claimed) {
    return {
      ...imported,
      source: {
        label: imported.source?.label || "Imported ASIC",
        url: imported.source?.url,
        retrieved: imported.source?.retrieved,
        trust: "USER_ENTERED",
      },
    };
  }
  return imported;
}

export function asicTrustDecision(
  asic: AsicSpec | null,
  catalogAsics: Iterable<AsicSpec> = ASIC_CATALOG,
): AsicTrustDecision {
  if (!asic) {
    return {
      level: null,
      finalSafeEligible: false,
      reason: "ASIC model unknown.",
    };
  }
  const match = findTrustedCatalogMatch(asic, catalogAsics);
  if (match) {
    return {
      level: match.source.trust,
      finalSafeEligible: true,
      reason: `ASIC provenance ${match.source.trust} is eligible for VERIFIED SAFE (catalog authority).`,
    };
  }
  const claimed = asic.source.trust;
  const level: TrustLevel =
    claimed === "OFFICIAL_VERIFIED" || claimed === "VERIFIED_SECONDARY" ? "USER_ENTERED" : claimed;
  return {
    level,
    finalSafeEligible: false,
    reason: `ASIC provenance ${level} is not eligible for VERIFIED SAFE.`,
  };
}

/**
 * Grok may propose an imported spec. It must not mint official/secondary trust.
 * Owner-imported official specs use the non-Grok path; catalog rebind still applies
 * inside resolveAsic / asicTrustDecision.
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
