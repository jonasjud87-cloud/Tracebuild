const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelative(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "Noch nie";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "Unbekannt";
  const diff = Math.max(0, now - t);
  if (diff < MINUTE) return "gerade eben";
  if (diff < HOUR) return `vor ${Math.floor(diff / MINUTE)} Min.`;
  if (diff < DAY) return `vor ${Math.floor(diff / HOUR)} Std.`;
  const days = Math.floor(diff / DAY);
  if (days < 30) return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "vor 1 Monat" : `vor ${months} Monaten`;
  const years = Math.floor(days / 365);
  return years <= 1 ? "vor 1 Jahr" : `vor ${years} Jahren`;
}

export function formatFull(iso: string | null): string {
  if (!iso) return "Keine Aktivität erfasst";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unbekannt";
  return d.toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" });
}

export function fallbackError(status: number): string {
  if (status === 403) return "Keine Berechtigung für diese Aktion.";
  if (status === 404) return "Nutzer wurde nicht gefunden.";
  if (status === 409) return "Die Aktion ist mit dem aktuellen Zustand nicht vereinbar.";
  if (status === 429) return "Zu viele Anfragen. Bitte später erneut versuchen.";
  return "Aktion fehlgeschlagen. Bitte erneut versuchen.";
}
