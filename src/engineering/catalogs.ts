import { ASIC_CATALOG } from "../equipment/asic-catalog.ts";
import { FAN_CATALOG } from "../equipment/fan-catalog.ts";
import type { Catalogs } from "./pipeline.ts";

export function defaultCatalogs(): Catalogs {
  return {
    asics: Object.fromEntries(ASIC_CATALOG.map((a) => [a.id, a])),
    fans: Object.fromEntries(FAN_CATALOG.map((f) => [f.id, f])),
  };
}
