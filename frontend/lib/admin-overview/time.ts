const ZONE = "Europe/Zurich";

function zurichOffsetMs(at: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((x) => x.type === type)?.value ?? 0);
  const localAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return localAsUtc - Math.floor(at / 1000) * 1000;
}

export interface YmdParts {
  y: number;
  m: number;
  d: number;
}

export function zurichYmd(at: number): YmdParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((x) => x.type === type)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

export function zurichMidnight(y: number, m: number, d: number): number {
  const localAsUtc = Date.UTC(y, m - 1, d);
  const firstGuess = localAsUtc - zurichOffsetMs(localAsUtc);
  return localAsUtc - zurichOffsetMs(firstGuess);
}

export function dateKey(at: number): string {
  const { y, m, d } = zurichYmd(at);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function lastDayKeys(now: number, count: number): string[] {
  const { y, m, d } = zurichYmd(now);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - 1, d - i));
    keys.push(dt.toISOString().slice(0, 10));
  }
  return keys;
}

export function startOfDayKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return zurichMidnight(y, m, d);
}

export interface MonthWindows {
  monthStart: number;
  prevStart: number;
  prevEnd: number;
}

export function monthWindows(now: number): MonthWindows {
  const { y, m, d } = zurichYmd(now);
  const monthStart = zurichMidnight(y, m, 1);
  const prevStart = zurichMidnight(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, 1);
  const daysInPrev = Math.round((monthStart - prevStart) / 86_400_000);
  const prevEnd = d >= daysInPrev ? monthStart : zurichMidnight(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1, d + 1);
  return { monthStart, prevStart, prevEnd };
}

export function monthLabel(now: number): string {
  return new Intl.DateTimeFormat("de-CH", { timeZone: ZONE, month: "long", year: "numeric" }).format(new Date(now));
}
