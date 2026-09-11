import type { AsicSpec } from "../engineering/types.ts";

/** Frozen verification fixture. Do not "correct" from live manufacturer data. */
export const TEST_ASIC_A: AsicSpec = {
  id: "TEST_ASIC_A",
  manufacturer: "TEST FIXTURE",
  model: "TEST_ASIC_A",
  algorithm: "SHA256",
  hashrateThs: 234,
  typicalPowerW: 3510,
  designPowerW: 3685.5,
  voltageMin: 230,
  voltageMax: 230,
  currentA: 15.260869565,
  widthM: 0.219,
  heightM: 0.293,
  lengthM: 0.45,
  weightKg: 14.2,
  airflowDirection: "FRONT_TO_BACK",
  manufacturerAirflowM3h: 900,
  source: {
    label: "Verification Pack TEST_ASIC_A",
    trust: "TEST_FIXTURE",
  },
};

export const ASIC_S21_PRO: AsicSpec = {
  id: "bitmain-s21-pro",
  manufacturer: "BITMAIN",
  model: "S21 Pro",
  variant: "234T / version 10",
  algorithm: "SHA256",
  hashrateThs: 234,
  typicalPowerW: 3510,
  designPowerW: 4000,
  voltageMin: 220,
  voltageMax: 277,
  currentA: 20,
  widthM: 0.219,
  heightM: 0.293,
  lengthM: 0.45,
  weightKg: 20,
  airflowDirection: "FRONT_TO_BACK",
  manufacturerAirflowM3h: 815.5,
  noiseDba: 76,
  source: {
    label: "BITMAIN Support — S21 Pro Specification",
    url: "https://support.bitmain.com/hc/en-us/articles/31321354157593-S21-Pro-Specification",
    retrieved: "2026-09-11",
    trust: "OFFICIAL_VERIFIED",
  },
};

export const ASIC_S21: AsicSpec = {
  id: "bitmain-s21",
  manufacturer: "BITMAIN",
  model: "S21",
  algorithm: "SHA256",
  hashrateThs: 200,
  typicalPowerW: 3500,
  designPowerW: 3675,
  voltageMin: 220,
  voltageMax: 277,
  currentA: 20,
  widthM: 0.195,
  heightM: 0.29,
  lengthM: 0.4,
  weightKg: 15.4,
  airflowDirection: "FRONT_TO_BACK",
  noiseDba: 75,
  source: {
    label: "BITMAIN Support — S21 Specification",
    url: "https://support.bitmain.com/hc/en-us/articles/23794895251609-S21-Specification",
    retrieved: "2026-09-11",
    trust: "OFFICIAL_VERIFIED",
  },
};

export const ASIC_T21: AsicSpec = {
  id: "bitmain-t21",
  manufacturer: "BITMAIN",
  model: "T21",
  variant: "NEM",
  algorithm: "SHA256",
  hashrateThs: 190,
  typicalPowerW: 3610,
  designPowerW: 5126,
  voltageMin: 380,
  voltageMax: 415,
  currentA: 12,
  widthM: 0.212,
  heightM: 0.29,
  lengthM: 0.4,
  weightKg: 17,
  airflowDirection: "FRONT_TO_BACK",
  noiseDba: 76,
  source: {
    label: "BITMAIN Support — T21 Specifications",
    url: "https://support.bitmain.com/hc/en-us/articles/24967960325785-T21-Specifications",
    retrieved: "2026-09-11",
    trust: "OFFICIAL_VERIFIED",
  },
};

export const ASIC_M60S: AsicSpec = {
  id: "microbt-m60s",
  manufacturer: "MicroBT",
  model: "Whatsminer M60S",
  variant: "186T",
  algorithm: "SHA256",
  hashrateThs: 186,
  typicalPowerW: 3441,
  designPowerW: 3613,
  voltageMin: 200,
  voltageMax: 277,
  widthM: 0.155,
  heightM: 0.226,
  lengthM: 0.43,
  weightKg: 12.8,
  airflowDirection: "FRONT_TO_BACK",
  manufacturerAirflowM3h: 595,
  noiseDba: 75,
  source: {
    label: "MicroBT M60S series manual (Zeus Mining compilation of manufacturer sheet)",
    url: "https://www.zeusbtc.com/articles/information/5973-whatsminer-m6x-series-miner-manual",
    retrieved: "2026-09-11",
    trust: "VERIFIED_SECONDARY",
  },
};

export const ASIC_CATALOG: AsicSpec[] = [ASIC_S21_PRO, ASIC_S21, ASIC_T21, ASIC_M60S, TEST_ASIC_A];

export function findAsic(query: string): AsicSpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return ASIC_CATALOG.filter((a) => a.source.trust !== "TEST_FIXTURE");
  return ASIC_CATALOG.filter((a) => {
    const hay = `${a.manufacturer} ${a.model} ${a.variant ?? ""} ${a.id}`.toLowerCase();
    return hay.includes(q) || q.split(/\s+/).every((p) => hay.includes(p));
  });
}

export function getAsic(id: string): AsicSpec | undefined {
  return ASIC_CATALOG.find((a) => a.id === id);
}
