const ZONE = "Europe/Zurich";

const PARTS_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function zonedParts(ts: number) {
  const out: Record<string, string> = {};
  for (const p of PARTS_FORMAT.formatToParts(new Date(ts))) out[p.type] = p.value;
  return out;
}

export function localInputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  for (const offset of [2 * 3600000, 3600000]) {
    const ts = guess - offset;
    if (isoToLocalInput(new Date(ts).toISOString()) === value) return new Date(ts).toISOString();
  }
  return null;
}

export function isLocalInputChanged(value: string, iso: string | null): boolean {
  return value !== isoToLocalInput(iso);
}

export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const p = zonedParts(ts);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const DISPLAY_FORMAT = new Intl.DateTimeFormat("de-CH", {
  timeZone: ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(iso: string): string {
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? "–" : DISPLAY_FORMAT.format(new Date(ts));
}
