import type { OverviewCurrency } from "@/lib/admin-overview/types";

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const ZONE = "Europe/Zurich";

export interface DisplayCurrency {
  code: "USD" | "CHF";
  rate: number;
}

export function resolveCurrency(c: OverviewCurrency | null | undefined): DisplayCurrency {
  if (c && c.code === "CHF" && typeof c.usdToChf === "number" && isFinite(c.usdToChf) && c.usdToChf > 0) {
    return { code: "CHF", rate: c.usdToChf };
  }
  return { code: "USD", rate: 1 };
}

export function formatMoney(usd: number, cur: DisplayCurrency): string {
  const v = (Number.isFinite(usd) ? usd : 0) * cur.rate;
  const n = v.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur.code === "CHF" ? `CHF ${n}` : `$${n}`;
}

export function formatInt(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("de-CH");
}

export function formatDayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${parseInt(m[3], 10)}. ${MONTHS[parseInt(m[2], 10) - 1] ?? ""}`.trim();
}

export function formatDayLong(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${formatDayLabel(date)} ${m[1]}`;
}

interface ZurichParts {
  key: string;
  time: string;
  dayNumber: number;
}

function zurichParts(d: Date): ZurichParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "00";
  const y = get("year");
  const mo = get("month");
  const da = get("day");
  return {
    key: `${y}-${mo}-${da}`,
    time: `${get("hour")}:${get("minute")}`,
    dayNumber: Math.floor(Date.UTC(Number(y), Number(mo) - 1, Number(da)) / 86400000),
  };
}

export function formatCreated(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "–";
  const p = zurichParts(d);
  const n = zurichParts(now);
  const diff = n.dayNumber - p.dayNumber;
  if (diff === 0) return `Heute, ${p.time}`;
  if (diff === 1) return `Gestern, ${p.time}`;
  const [y, mo, da] = p.key.split("-");
  return `${da}.${mo}.${y}`;
}

export function niceScale(max: number): { top: number; step: number; ticks: number[] } {
  const m = Math.max(Number.isFinite(max) ? max : 0, 4);
  const exp = Math.pow(10, Math.floor(Math.log10(m / 4)));
  let step = Math.max(exp, 1);
  for (const f of [1, 2, 2.5, 5, 10]) {
    const candidate = f * exp;
    if (!Number.isInteger(candidate)) continue;
    step = candidate;
    if (Math.ceil(m / step) <= 4) break;
  }
  const n = Math.max(Math.ceil(m / step), 1);
  const ticks: number[] = [];
  for (let i = 0; i <= n; i++) ticks.push(i * step);
  return { top: n * step, step, ticks };
}
