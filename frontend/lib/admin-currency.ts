export const DEFAULT_USD_CHF_RATE = 0.8;

const MIN_RATE = 0.1;
const MAX_RATE = 10;

export interface UsdChfRate {
  usdToChf: number;
  source: "env" | "fallback";
}

export function getUsdChf(): UsdChfRate {
  const raw = process.env.USD_CHF_RATE;
  const rate = raw ? Number(raw) : NaN;
  if (Number.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE) return { usdToChf: rate, source: "env" };
  return { usdToChf: DEFAULT_USD_CHF_RATE, source: "fallback" };
}

export function toChf(usd: number, rate: number): number {
  return Math.round((usd * rate + Number.EPSILON) * 100) / 100;
}

export function toChfPrecise(usd: number, rate: number): number {
  return Math.round((usd * rate + Number.EPSILON) * 10000) / 10000;
}
